"""Context Agent — the brain/router that sees the full graph and decides what to do.

Tools: think, delete_nodes, expand_node, create_nodes, create_root, reorganize, done.
Max 5 iterations (it's a router, not a content generator).
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
from models.tables import NodeLinkTable, NodeTable
from services import graph_service, message_service
from services.agents import expand_agent, research_agent, plan_agent
from services.agents.reposition import reposition_children, reorganize_all
from services.agents.tool_defs import CONTEXT_TOOLS, CONTEXT_TOOL_CONFIG
from services.graph_palette import node_color

logger = get_logger("context_agent")

MAX_ITERATIONS = 5
CANVAS_CX = 1600
CANVAS_CY = 900

SYSTEM_PROMPT = """You are Curio's Context Agent — the brain of the mind-map tool.
You see the full graph and the user's message, then decide what to do.

ALWAYS call think() FIRST to reason about the situation before taking action.

Your available tools:
- think: Reason about what's needed. Always call first.
- create_root: Create a root node if the graph is empty or user wants a new root.
- expand_node: Expand a specific node with subtopics (delegates to Expand Agent).
- create_nodes: Create specific nodes under parents (delegates to Research/Plan worker).
- delete_nodes: Remove nodes that are wrong, redundant, or user asked to remove.
- reorganize: Reposition the entire graph. Only when user explicitly asks.
- done: Signal completion. Always call as your last tool.

Typical flows:
1. First prompt (empty graph): think → create_root → expand_node on root → done
2. User asks to explore topic X: think → expand_node on the X node → done
3. User says "remove the Y branch": think → delete_nodes → done
4. User says "add Z under X": think → create_nodes → done
5. User says "reorganize": think → reorganize → done
6. Ambiguous request: think → decide best action → done

Rules:
- Be efficient. 1-3 tool calls max (plus think and done).
- Don't create content yourself — delegate to expand_node or create_nodes.
- create_nodes groups format: [{"parent_id": 42, "children": ["Topic A", "Topic B"]}, ...]
"""


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
    return json.dumps({
        "mode": mode,
        "user_prompt": prompt,
        "graph": {"nodes": nodes_data, "links": links_data},
        "node_count": len(nodes_data),
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
            position_x=CANVAS_CX,
            position_y=CANVAS_CY,
            node_type=node_type,
            color=color,
            depth=0,
        )
        events.append({"type": "node_created", "data": NodeOut.model_validate(created).model_dump(mode="json")})
        return {"node_id": created.id, "topic": topic}, events

    elif name == "delete_nodes":
        node_ids = [int(nid) for nid in (args.get("node_ids") or [])]
        logger.info("  🗑️  DELETE_NODES: ids=%s", node_ids)
        deleted_count = 0
        parents_to_reposition: set[int] = set()

        for nid in node_ids:
            # Find parent before deleting
            parent_link = (
                db.query(NodeLinkTable)
                .filter_by(session_id=session_id, child_id=nid)
                .first()
            )
            if parent_link:
                parents_to_reposition.add(parent_link.parent_id)

            if graph_service.delete_node(db, session_id, nid):
                deleted_count += 1
                events.append({"type": "node_deleted", "data": {"id": nid, "session_id": session_id}})

        logger.info("    deleted %d nodes, repositioning %d parents", deleted_count, len(parents_to_reposition))
        for pid in parents_to_reposition:
            parent = graph_service.get_node(db, session_id, pid)
            if parent:
                moved = reposition_children(db, session_id, parent)
                for mid, x, y in moved:
                    events.append({"type": "node_updated", "data": {"id": mid, "session_id": session_id, "position_x": x, "position_y": y}})

        return {"deleted_count": deleted_count}, events

    elif name == "expand_node":
        node_id = int(args.get("node_id", 0))
        prompt = args.get("prompt", "")
        logger.info("  🔀 EXPAND_NODE: node_id=%d prompt=%s", node_id, prompt[:80])

        # Delegate to expand agent — collect its events
        expand_events: list[dict] = []
        async for ev in expand_agent.run(
            session_id=session_id,
            anchor_node_id=node_id,
            prompt=prompt,
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

        # Reposition children for each parent
        for pid in parent_ids:
            parent = graph_service.get_node(db, session_id, pid)
            if parent:
                moved = reposition_children(db, session_id, parent)
                for mid, x, y in moved:
                    events.append({"type": "node_updated", "data": {"id": mid, "session_id": session_id, "position_x": x, "position_y": y}})

        return {"created_count": created_count}, events

    elif name == "reorganize":
        logger.info("  📐 REORGANIZE: full graph reposition")
        events.append({"type": "status", "data": {"message": "Reorganizing layout..."}})
        moved = reorganize_all(db, session_id)
        for mid, x, y in moved:
            events.append({"type": "node_updated", "data": {"id": mid, "session_id": session_id, "position_x": x, "position_y": y}})
        return {"repositioned_count": len(moved)}, events

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
                    api_keys=api_keys,
                )
            except Exception as exc:
                logger.error("Context tool %s failed: %s", tool_name, exc, exc_info=True)
                result = {"error": f"Tool {tool_name} failed: {exc}"}
                events = []

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
