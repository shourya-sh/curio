"""Context Agent — the brain/router that sees the full graph and decides what to do.

Tools: think, delete_nodes, expand_node, create_nodes, create_root, reorganize, done.
Max 8 iterations (router; each iteration may batch multiple tool calls).
"""

import asyncio
import json
from collections.abc import AsyncGenerator
from typing import Any

from google.genai import types as genai_types
from sqlalchemy.orm import Session

from ai import _generate_gemini
from logger import get_logger
from models.session_models import NodeOut, LinkOut, MessageOut
from models.tables import NodeLinkTable
from services import graph_service, layout_engine, message_service
from services.agents import expand_agent, research_agent, plan_agent
from services.agents.tool_defs import CONTEXT_TOOLS, CONTEXT_TOOL_CONFIG
from services.graph_palette import node_color

logger = get_logger("context_agent")

MAX_ITERATIONS = 8

SYSTEM_PROMPT = """You are Curio's Context Agent — the brain of the mind-map tool.
You see the full graph and the user's message, then decide what to do.

ALWAYS call think() FIRST to reason about the situation before taking action.

CRITICAL invariant: every map has exactly ONE root node. Everything traces back
to it. Never create a second root. The current root id (if any) is in the
context payload as `root_id`. Use it.

Your available tools:
- think: Reason about what's needed. Always call first.
- create_root: ONLY call when `root_id` is null (empty graph). If a root already
  exists this tool returns the existing root id and refuses to create another.
- expand_node: Expand a specific node with subtopics (delegates to Expand Agent).
- create_nodes: Create specific nodes under parents (delegates to Research/Plan
  worker). Every group MUST set parent_id to a real node id from the graph; for
  brand-new top-level concepts use `parent_id = root_id`.
- delete_nodes: Remove nodes that are wrong, redundant, or user asked to remove.
  You can NOT delete the root.
- reorganize: Recompute layout positions for the whole graph in the session's
  current layout mode. Only when user explicitly asks.
- set_layout_mode: Switch the visual layout pattern (radial / tree / grid / web)
  when the new shape of the map clearly fits a different pattern better than
  the current one. See the tool description for guidance on each mode. Pick
  ONCE per run — preferably right after you've decided what nodes to add but
  BEFORE create_nodes / expand_node, so the relayout that follows uses the new
  mode. Do not switch unnecessarily.
- done: Signal completion. Always call as your last tool.

Typical flows:
1. First prompt (empty graph): think → (optional set_layout_mode) → create_root → expand_node on root → done
2. User asks to explore topic X: think → expand_node on the X node → done
3. User says "remove the Y branch": think → delete_nodes → done
4. User says "add Z under X": think → create_nodes(parent_id=X) → done
5. User says "add a new top-level area Q": think → create_nodes(parent_id=root_id) → done
6. User says "reorganize": think → reorganize → done

Layout-mode selection (when to call set_layout_mode):
- Strongly hierarchical / step-by-step / prerequisites / workflows / "how to" → tree
- Many cross-linked or interconnected concepts (systems, networks, ecosystems,
  relationships across branches) → web
- Flat checklist / glossary / many near-peer items at depth ≤ 2 → grid
- General hierarchical knowledge maps / overviews / branching exploration → radial
Use the current `layout_mode` in the context payload. If it already fits the
shape of the map you're about to produce, do NOT call set_layout_mode — just
proceed. Switch when the **new** graph shape or the user's follow-up clearly
fits a different pattern better (e.g. they pivot to a workflow → tree; they add
cross-cutting concerns → web; many peer buckets → grid). Follow-up prompts can
justify a layout change even if the earlier map used a different mode.

Coverage and breadth (research mode especially):
- Prefer giving the user enough structure to **fully** understand the topic over
  a minimal node count. Broad questions ("how does X work", industries,
  processes, ecosystems) usually need **many** first-level branches from the
  root — the Expand Agent is instructed to scale up; your job is to expand the
  right node(s) with rich `prompt` hints when useful.
- You MAY use multiple tool rounds across iterations (e.g. expand several
  important nodes, or create_nodes then expand_node) when the user clearly wants
  depth. Avoid redundant expands on the same node in one run.

Quality bar — keep generating until it **makes sense**, not until the token budget:
- **Anchor everything** to the user's guiding intent (`user_prompt` in the
  context payload and `root_topic`). If a branch does not help answer what they
  actually asked (under their constraints), do not add it. No "interesting but
  off-mission" digressions.
- **Anti-slop:** No padded lists, no near-duplicate labels, no vague corporate
  filler, no motivational noise. Prefer fewer precise nodes over many mushy
  ones. If the graph picked up junk earlier, use delete_nodes when appropriate.
- **Know what you don't know:** It is good when downstream content (expand /
  create_nodes) **honestly** flags uncertainty, limits of evidence, regional or
  domain variance, or open questions — but only when that honesty **serves the
  guiding topic** (e.g. "where estimates are shaky for this supply chain"), not
  generic philosophy. Optional focused children like "Open questions / limits"
  are fine when they clarify the main question.
- **When to call done:** After you have covered what their wording reasonably
  requires (or you hit diminishing returns without adding slop). If something
  material is still missing, expand or create_nodes first. In `done.summary`,
  you may add **one short clause** naming important gaps or caveats tied to
  their question — never vague "more research needed" with no substance.

Rules:
- Always pass the user's constraints, tone, scope, and emphasis inside
  `expand_node.prompt` when calling expand_node (the system also attaches their
  full latest message, but your explicit focus string helps).
- Don't create content yourself — delegate to expand_node or create_nodes.
- create_nodes groups format: [{"parent_id": 42, "children": ["Topic A", "Topic B"]}, ...]
"""


def _friendly_error(exc: BaseException) -> str:
    """Turn a Gemini/SQL/etc. exception into a single user-readable line."""
    s = str(exc)
    up = s.upper()
    if "UNAVAILABLE" in up or "503" in up:
        return (
            "The AI model is temporarily overloaded (Google 503). "
            "It auto-retried and exhausted fallbacks. Please try the prompt again in a few seconds."
        )
    if "RESOURCE_EXHAUSTED" in up or "429" in up or "QUOTA" in up:
        return "Daily AI quota exhausted on every key. Add another GEMINI_API_KEY or wait for the quota window."
    if "API_KEY_INVALID" in up or "API KEY EXPIRED" in up:
        return "All Gemini API keys were rejected as invalid/expired. Renew at https://aistudio.google.com/apikey."
    if "DEADLINE_EXCEEDED" in up or "TIMEOUT" in up:
        return "AI model timed out. Try the prompt again — usually transient."
    # Keep the raw message short so the toast stays readable.
    return f"Generation failed: {s[:240]}"


def _root_node(db: Session, session_id: int):
    """The single root: the lowest-id node with no incoming link. None if empty."""
    nodes = graph_service.list_nodes(db, session_id)
    if not nodes:
        return None
    links = graph_service.list_links(db, session_id)
    children_with_parent = {lnk.child_id for lnk in links}
    candidates = [n for n in nodes if n.id not in children_with_parent]
    if not candidates:
        candidates = nodes
    return min(candidates, key=lambda n: n.id)


def _attach_orphans_to_root(db: Session, session_id: int) -> list[NodeLinkTable]:
    """Auto-link any non-root node that has no parent into the root. Returns the
    new links so the caller can emit `link_created` SSE events. Idempotent."""
    root = _root_node(db, session_id)
    if root is None:
        return []
    nodes = graph_service.list_nodes(db, session_id)
    links = graph_service.list_links(db, session_id)
    has_parent = {lnk.child_id for lnk in links}
    created: list[NodeLinkTable] = []
    for n in nodes:
        if n.id == root.id or n.id in has_parent:
            continue
        link = graph_service.create_link(
            db,
            session_id=session_id,
            parent_id=root.id,
            child_id=n.id,
        )
        created.append(link)
        logger.info("    auto-attached orphan %d (%s) to root %d", n.id, n.topic[:40], root.id)
    return created


def _build_context(db: Session, session_id: int, prompt: str, mode: str) -> str:
    """Assemble graph context for the context agent. Lightweight — just IDs, topics, structure."""
    graph = graph_service.get_full_graph(db, session_id)
    nodes_data = [
        {"id": n.id, "topic": n.topic, "summary": n.summary or "", "depth": n.depth}
        for n in graph["nodes"]
    ]
    links_data = [
        {"parent_id": lnk.parent_id, "child_id": lnk.child_id}
        for lnk in graph["links"]
    ]
    root = _root_node(db, session_id)
    sess = message_service.get_session_row(db, session_id)
    layout_mode = getattr(sess, "layout_mode", None) or layout_engine.DEFAULT_LAYOUT
    return json.dumps({
        "mode": mode,
        "layout_mode": layout_mode,
        "user_prompt": prompt,
        "graph": {"nodes": nodes_data, "links": links_data},
        "node_count": len(nodes_data),
        "root_id": root.id if root else None,
        "root_topic": root.topic if root else None,
    })


def _extract_function_calls(response: Any) -> list[genai_types.FunctionCall]:
    calls: list[genai_types.FunctionCall] = []
    if not response.candidates:
        return calls
    content = response.candidates[0].content
    if not content or not content.parts:
        return calls
    for part in content.parts:
        if part.function_call:
            calls.append(part.function_call)
    return calls


async def _execute_tool(
    name: str,
    args: dict[str, Any],
    *,
    db: Session,
    session_id: int,
    mode: str,
    session_user_prompt: str = "",
    api_keys: list[str] | None = None,
) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    """Execute a context agent tool. Returns (result_for_llm, sse_events)."""
    events: list[dict[str, Any]] = []

    if name == "think":
        reasoning = args.get("reasoning", "")
        logger.info("  🧠 THINK: %s", reasoning[:300])
        events.append({"type": "status", "data": {"message": "Thinking..."}})
        return {"status": "ok", "reasoning_logged": True}, events

    elif name == "create_root":
        # Single-root invariant: never create a second root. If one exists,
        # return its id so the agent can attach to it via create_nodes instead.
        existing_root = _root_node(db, session_id)
        if existing_root is not None:
            logger.info("  🌱 CREATE_ROOT skipped — root %d already exists", existing_root.id)
            return {
                "node_id": existing_root.id,
                "topic": existing_root.topic,
                "already_exists": True,
                "note": "Root already exists. Use create_nodes(parent_id=root_id) to add top-level branches.",
            }, events

        topic = str(args.get("topic", "Root"))[:255]
        summary = str(args.get("summary", ""))
        logger.info("  🌱 CREATE_ROOT: topic=%s", topic)
        color = node_color(mode, "root", 0, 0)
        node_type = "task" if mode == "plan" else "topic"

        created = graph_service.create_node(
            db,
            session_id=session_id,
            topic=topic,
            summary=summary,
            details="",
            position_x=layout_engine.CANVAS_CX,
            position_y=layout_engine.CANVAS_CY,
            node_type=node_type,
            color=color,
            depth=0,
        )
        events.append({"type": "node_created", "data": NodeOut.model_validate(created).model_dump(mode="json")})
        return {"node_id": created.id, "topic": topic}, events

    elif name == "delete_nodes":
        node_ids = [int(nid) for nid in (args.get("node_ids") or [])]
        logger.info("  🗑️  DELETE_NODES: ids=%s", node_ids)
        root = _root_node(db, session_id)
        protected = {root.id} if root else set()
        deleted_count = 0
        for nid in node_ids:
            if nid in protected:
                logger.info("    refused to delete root node %d", nid)
                continue
            if graph_service.delete_node(db, session_id, nid):
                deleted_count += 1
                events.append({"type": "node_deleted", "data": {"id": nid, "session_id": session_id}})

        if deleted_count:
            # Reconnect any node that lost its only parent so the graph stays
            # rooted, then recompute layout.
            for link in _attach_orphans_to_root(db, session_id):
                events.append({"type": "link_created", "data": LinkOut.model_validate(link).model_dump(mode="json")})
            logger.info("    deleted %d nodes, recomputing layout", deleted_count)
            for mid, x, y in layout_engine.apply_layout(db, session_id):
                events.append({"type": "node_updated", "data": {"id": mid, "session_id": session_id, "position_x": x, "position_y": y}})

        return {"deleted_count": deleted_count, "root_protected": list(protected)}, events

    elif name == "expand_node":
        node_id = int(args.get("node_id", 0))
        node_prompt = str(args.get("prompt", "") or "").strip()
        base = (session_user_prompt or "").strip()
        log_hint = node_prompt or base
        logger.info("  🔀 EXPAND_NODE: node_id=%d prompt=%s", node_id, log_hint[:120])

        # Delegate to expand agent — collect its events
        expand_events: list[dict] = []
        async for ev in expand_agent.run(
            session_id=session_id,
            anchor_node_id=node_id,
            prompt=node_prompt or None,
            session_user_prompt=base or None,
            mode=mode,
            db=db,
            api_keys=api_keys,
        ):
            expand_events.append(ev)

        events.extend(expand_events)
        # Count created nodes from events
        created_count = sum(1 for e in expand_events if e["type"] == "node_created")
        return {"expanded_node_id": node_id, "children_created": created_count}, events

    elif name == "create_nodes":
        raw_groups = args.get("groups") or []
        logger.info("  ➕ CREATE_NODES: %d groups", len(raw_groups))
        worker_groups = []
        parent_ids: set[int] = set()

        for g in raw_groups:
            pid = int(g.get("parent_id", 0))
            parent = graph_service.get_node(db, session_id, pid)
            if not parent:
                continue
            children = g.get("children") or []
            if not children:
                continue
            parent_ids.add(pid)
            worker_groups.append({
                "parent_id": pid,
                "parent_topic": parent.topic,
                "parent_summary": parent.summary or "",
                "children": [str(c) for c in children],
            })

        if not worker_groups:
            logger.warning("    no valid groups to create")
            return {"error": "No valid groups to create"}, events

        total_children = sum(len(g['children']) for g in worker_groups)
        for wg in worker_groups:
            logger.info("    parent=%d (%s) → children=%s", wg["parent_id"], wg["parent_topic"], wg["children"])
        events.append({"type": "status", "data": {"message": f"Filling details for {total_children} nodes..."}})

        # Delegate to worker
        worker = plan_agent if mode == "plan" else research_agent
        logger.info("    → delegating to %s AGENT", "PLAN" if mode == "plan" else "RESEARCH")
        worker_result = await worker.run(
            worker_groups,
            mode=mode,
            session_id=session_id,
            api_keys=api_keys,
        )

        # Persist nodes
        created_count = 0
        topic_to_node_id: dict[str, int] = {}

        for group in worker_result.groups:
            parent = graph_service.get_node(db, session_id, group.parent_id)
            if not parent:
                continue
            for i, child in enumerate(group.children):
                depth = (parent.depth or 0) + 1
                color = node_color(mode, child.palette_role, depth, i)
                node_type = "task" if mode == "plan" else "topic"

                created = graph_service.create_node(
                    db,
                    session_id=session_id,
                    topic=child.topic[:255],
                    summary=child.summary,
                    details=child.details,
                    parent_id=parent.id,
                    position_x=0,
                    position_y=0,
                    node_type=node_type,
                    color=color,
                    subtopics=child.subtopics,
                    depth=depth,
                )
                created_count += 1
                topic_to_node_id[child.topic] = created.id
                events.append({"type": "node_created", "data": NodeOut.model_validate(created).model_dump(mode="json")})

                link = (
                    db.query(NodeLinkTable)
                    .filter_by(session_id=session_id, parent_id=parent.id, child_id=created.id)
                    .first()
                )
                if link:
                    events.append({"type": "link_created", "data": LinkOut.model_validate(link).model_dump(mode="json")})

        # Persist sources
        if worker_result.sources:
            sources_payload = []
            for src in worker_result.sources:
                node_ids = []
                node_topics = []
                for t in src.node_topics:
                    nid = topic_to_node_id.get(t)
                    if nid:
                        node_ids.append(nid)
                        node_topics.append(t)
                sources_payload.append({
                    "title": src.title, "url": src.url, "publisher": src.publisher,
                    "year": src.year, "summary": src.summary, "excerpt": src.excerpt,
                    "relevance": src.relevance, "node_ids": node_ids, "node_topics": node_topics,
                })
            if sources_payload:
                src_msg = message_service.create_sources_message(db, session_id, {"sources": sources_payload})
                events.append({
                    "type": "sources_created",
                    "data": {
                        "id": src_msg.id, "session_id": src_msg.session_id,
                        "sources": sources_payload,
                        "created_at": src_msg.created_at.isoformat() if src_msg.created_at else None,
                    },
                })

        if created_count:
            # Auto-attach any orphan to root so the single-root invariant holds,
            # then recompute layout once.
            for link in _attach_orphans_to_root(db, session_id):
                events.append({"type": "link_created", "data": LinkOut.model_validate(link).model_dump(mode="json")})
            for mid, x, y in layout_engine.apply_layout(db, session_id):
                events.append({"type": "node_updated", "data": {"id": mid, "session_id": session_id, "position_x": x, "position_y": y}})

        return {"created_count": created_count}, events

    elif name == "reorganize":
        logger.info("  📐 REORGANIZE: full graph relayout")
        events.append({"type": "status", "data": {"message": "Reorganizing layout..."}})
        moved = layout_engine.apply_layout(db, session_id)
        for mid, x, y in moved:
            events.append({"type": "node_updated", "data": {"id": mid, "session_id": session_id, "position_x": x, "position_y": y}})
        return {"repositioned_count": len(moved)}, events

    elif name == "set_layout_mode":
        requested = str(args.get("mode", "")).strip().lower()
        reason = str(args.get("reason", ""))[:300]
        if requested not in layout_engine.LAYOUT_MODES:
            logger.warning("  🎨 SET_LAYOUT_MODE rejected: invalid mode %r", requested)
            return {
                "error": f"Invalid mode {requested!r}",
                "valid_modes": list(layout_engine.LAYOUT_MODES),
            }, events

        sess = message_service.get_session_row(db, session_id)
        if sess is None:
            return {"error": "Session not found"}, events
        current = getattr(sess, "layout_mode", None) or layout_engine.DEFAULT_LAYOUT
        if current == requested:
            logger.info("  🎨 SET_LAYOUT_MODE no-op (already %s)", current)
            return {"status": "noop", "layout_mode": current}, events

        sess.layout_mode = requested
        db.flush()
        logger.info("  🎨 SET_LAYOUT_MODE: %s → %s (reason: %s)", current, requested, reason[:80])

        events.append({
            "type": "layout_mode_changed",
            "data": {
                "session_id": session_id,
                "layout_mode": requested,
                "previous": current,
                "reason": reason,
            },
        })
        for mid, x, y in layout_engine.apply_layout(db, session_id):
            events.append({"type": "node_updated", "data": {"id": mid, "session_id": session_id, "position_x": x, "position_y": y}})
        return {"status": "ok", "layout_mode": requested, "previous": current}, events

    elif name == "done":
        logger.info("  ✅ DONE: %s", args.get("summary", "")[:120])
        return {"status": "complete", "summary": args.get("summary", "")}, events

    else:
        logger.warning("Unknown context agent tool: %s", name)
        return {"error": f"Unknown tool: {name}"}, events


async def run(
    *,
    session_id: int,
    prompt: str,
    mode: str,
    db: Session,
    api_keys: list[str] | None = None,
) -> AsyncGenerator[dict, None]:
    """Run the context agent loop. Yields SSE event dicts."""
    logger.info("── CONTEXT AGENT START session=%d mode=%s ──", session_id, mode)
    context_msg = _build_context(db, session_id, prompt, mode)
    logger.info("  graph context: %d chars", len(context_msg))

    messages: list[genai_types.Content] = [
        genai_types.Content(role="user", parts=[genai_types.Part.from_text(text=context_msg)]),
    ]

    for iteration in range(MAX_ITERATIONS):
        logger.info("  ── iteration %d/%d ──", iteration + 1, MAX_ITERATIONS)
        response = await _generate_gemini(
            contents=messages,
            system_prompt=SYSTEM_PROMPT,
            tools=CONTEXT_TOOLS,
            tool_config=CONTEXT_TOOL_CONFIG,
            api_keys=api_keys,
        )

        if response.candidates and response.candidates[0].content:
            messages.append(response.candidates[0].content)

        fn_calls = _extract_function_calls(response)
        if not fn_calls:
            logger.info("  no tool calls returned — treating as done")
            break

        logger.info("  gemini returned %d tool call(s): %s", len(fn_calls), [fc.name for fc in fn_calls])

        for fc in fn_calls:
            tool_name = fc.name
            tool_args = dict(fc.args) if fc.args else {}

            logger.info("  ▶ executing: %s", tool_name)

            try:
                result, events = await _execute_tool(
                    tool_name,
                    tool_args,
                    db=db,
                    session_id=session_id,
                    mode=mode,
                    session_user_prompt=prompt,
                    api_keys=api_keys,
                )
            except Exception as exc:
                logger.error("Context tool %s failed: %s", tool_name, exc, exc_info=True)
                # Make the failure visible: red banner on the client AND a system
                # message in the chat. Then short-circuit so Gemini can't chain
                # into a misleading `done` summary.
                friendly = _friendly_error(exc)
                yield {"type": "error", "data": {"message": friendly}}
                sys_msg = message_service.create_message(db, session_id, "system", f"⚠️ {friendly}")
                yield {"type": "message_created", "data": MessageOut.model_validate(sys_msg).model_dump(mode="json")}
                logger.info("── CONTEXT AGENT END (tool failure) ──")
                return

            for event in events:
                yield event

            messages.append(
                genai_types.Content(
                    role="user",
                    parts=[genai_types.Part.from_function_response(name=tool_name, response=result)],
                )
            )

            if tool_name == "done":
                summary_text = result.get("summary", "Done.")
                sys_msg = message_service.create_message(db, session_id, "system", summary_text)
                yield {"type": "message_created", "data": MessageOut.model_validate(sys_msg).model_dump(mode="json")}
                logger.info("── CONTEXT AGENT END (done tool) ──")
                return

    # If loop exits without done, auto-complete
    logger.info("── CONTEXT AGENT END (max iterations) ──")
    sys_msg = message_service.create_message(db, session_id, "system", "Completed.")
    yield {"type": "message_created", "data": MessageOut.model_validate(sys_msg).model_dump(mode="json")}
