"""Agentic tool-calling loop: Gemini sees the full graph context, then calls
tools (create_node, create_link, add_sources, done) in a multi-turn conversation.
Each tool call writes to DB and yields an SSE event immediately."""

import asyncio
import json
from collections.abc import AsyncGenerator
from typing import Any

from google.genai import types as genai_types
from sqlalchemy.orm import Session

from ai import _generate_gemini
from logger import get_logger
from models.session_models import NodeOut, LinkOut, MessageOut
from models.tables import NodeTable, NodeLinkTable
from services import graph_service, message_service
from services.agents.tool_defs import ALL_TOOLS, TOOL_CONFIG
from services.graph_palette import node_color, edge_color, line_style

logger = get_logger("tool_loop")

MAX_ITERATIONS = 20
TIMEOUT_SECONDS = 60

SYSTEM_PROMPT_RESEARCH = """You are Curio's Research Mind-Map Agent.
You build interactive mind maps by calling tools one at a time. You have full context of the existing graph.

Your workflow:
1. Analyze the user's question and the existing graph context.
2. Call create_node for each node you want to add (3-12 nodes). Set parent_node_id to build hierarchy.
3. Call create_link for any cross-links between nodes (non-parent-child relationships).
4. Call add_sources with 4-8 substantive references. Each source MUST reference real node IDs from create_node results.
5. Call done with a summary.

Rules:
- Every non-root node MUST have a parent_node_id.
- Use palette_role to color-code branches: root, branch_a, branch_b, branch_c, branch_d, branch_e, emphasis, neutral.
- Node topics should be compact display labels. Don't duplicate topics.
- Fill in rich details and subtopics for every node.
- Prefer textbooks, standards bodies, university primers for sources."""

SYSTEM_PROMPT_PLAN = """You are Curio's Plan Mind-Map Agent.
You build executable plan mind maps by calling tools one at a time. You have full context of the existing graph.

Your workflow:
1. Analyze the user's goal and the existing graph context.
2. Call create_node for each action item (3-10 nodes). Set parent_node_id to build hierarchy.
3. Call create_link for prerequisite/sequence relationships between nodes.
4. Call add_sources with 3-6 references (policies, specs, playbooks). Each source MUST reference real node IDs.
5. Call done with a summary.

Rules:
- Every non-root node MUST have a parent_node_id.
- Use palette_role to color-code branches: root, branch_a, branch_b, branch_c, branch_d, branch_e, emphasis, neutral.
- Node topics should be compact display labels. Don't duplicate topics.
- Fill in rich details, subtopics with concrete steps/checklists.
- edge_kind options: hierarchy, prerequisite, sequence_next, supporting, optional, critical."""


def _build_context_message(
    db: Session,
    session_id: int,
    prompt: str,
    mode: str,
    anchor: NodeTable | None,
    max_nodes: int,
) -> str:
    """Assemble the user message with full graph context."""
    graph = graph_service.get_full_graph(db, session_id)
    nodes_data = [
        {"id": n.id, "topic": n.topic, "summary": n.summary, "depth": n.depth}
        for n in graph["nodes"]
    ]
    links_data = [
        {"parent_id": l.parent_id, "child_id": l.child_id}
        for l in graph["links"]
    ]
    context = {
        "mode": mode,
        "user_prompt": prompt,
        "existing_graph": {"nodes": nodes_data, "links": links_data},
        "anchor_node": (
            {"id": anchor.id, "topic": anchor.topic, "summary": anchor.summary, "depth": anchor.depth}
            if anchor
            else None
        ),
        "limits": {"max_nodes": max_nodes, "min_branches": 3, "max_branches": 5},
        "palette_roles": ["root", "branch_a", "branch_b", "branch_c", "branch_d", "branch_e", "emphasis", "neutral"],
        "edge_kinds": ["hierarchy", "prerequisite", "sequence_next", "supporting", "optional", "critical"],
    }
    return json.dumps(context)


def _extract_function_calls(response: Any) -> list[genai_types.FunctionCall]:
    """Pull all FunctionCall parts from a Gemini response."""
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
    node_count: int,
    branch_counter: dict[str, int],
) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    """Execute a single tool call. Returns (result_for_llm, list_of_sse_events)."""
    events: list[dict[str, Any]] = []

    if name == "create_node":
        parent_id = int(args["parent_node_id"]) if args.get("parent_node_id") else None
        palette_role = args.get("palette_role", "neutral")
        depth = 0
        if parent_id:
            parent = graph_service.get_node(db, session_id, parent_id)
            if not parent:
                return {"error": f"parent_node_id {parent_id} does not exist in this session. Use a real node_id from a previous create_node result."}, events
            depth = parent.depth + 1

        # Track branch index for coloring
        branch_key = str(parent_id) if parent_id else "root"
        if branch_key not in branch_counter:
            branch_counter[branch_key] = len(branch_counter)
        branch_index = branch_counter[branch_key]

        color = node_color(mode, palette_role, depth, branch_index)
        node_type = "task" if mode == "plan" else "topic"

        created = graph_service.create_node(
            db,
            session_id=session_id,
            topic=str(args.get("topic", ""))[:255],
            summary=str(args.get("summary", "")),
            details=str(args.get("details", "")),
            parent_id=parent_id,
            position_x=0,
            position_y=0,
            node_type=node_type,
            color=color,
            subtopics=args.get("subtopics", []),
            depth=depth,
        )
        node_out = NodeOut.model_validate(created).model_dump(mode="json")
        events.append({"type": "node_created", "data": node_out})

        # If parent link was auto-created by graph_service, emit link event
        if parent_id:
            link = (
                db.query(NodeLinkTable)
                .filter_by(session_id=session_id, parent_id=parent_id, child_id=created.id)
                .first()
            )
            if link:
                events.append({"type": "link_created", "data": LinkOut.model_validate(link).model_dump(mode="json")})

        return {"node_id": created.id, "topic": created.topic, "depth": depth}, events

    elif name == "create_link":
        parent_id = int(args["parent_id"])
        child_id = int(args["child_id"])
        if not graph_service.get_node(db, session_id, parent_id):
            return {"error": f"parent_id {parent_id} does not exist in this session."}, events
        if not graph_service.get_node(db, session_id, child_id):
            return {"error": f"child_id {child_id} does not exist in this session."}, events
        ek = args.get("edge_kind", "supporting")
        link = graph_service.create_link(
            db,
            session_id=session_id,
            parent_id=parent_id,
            child_id=child_id,
            color=edge_color(mode, ek),
            line_style=line_style(ek),
        )
        events.append({"type": "link_created", "data": LinkOut.model_validate(link).model_dump(mode="json")})
        return {"link_id": link.id}, events

    elif name == "add_sources":
        sources_raw = args.get("sources", [])
        sources_payload: list[dict] = []
        for src in sources_raw:
            node_ids = [int(nid) for nid in (src.get("node_ids") or [])]
            node_topics: list[str] = []
            for nid in node_ids:
                node = graph_service.get_node(db, session_id, nid)
                node_topics.append(node.topic if node else "")
            sources_payload.append({
                "title": src.get("title", ""),
                "url": src.get("url", ""),
                "publisher": src.get("publisher", ""),
                "year": src.get("year", ""),
                "summary": src.get("summary", ""),
                "excerpt": src.get("excerpt", ""),
                "relevance": src.get("relevance", ""),
                "node_ids": node_ids,
                "node_topics": node_topics,
            })
        sources_message = message_service.create_sources_message(db, session_id, {"sources": sources_payload})
        events.append({
            "type": "sources_created",
            "data": {
                "id": sources_message.id,
                "session_id": sources_message.session_id,
                "sources": sources_payload,
                "created_at": sources_message.created_at.isoformat() if sources_message.created_at else None,
            },
        })
        return {"sources_count": len(sources_payload)}, events

    elif name == "done":
        return {"status": "complete", "summary": args.get("summary", "")}, events

    else:
        logger.warning("Unknown tool call: %s", name)
        return {"error": f"Unknown tool: {name}"}, events


async def run(
    *,
    session_id: int,
    prompt: str,
    mode: str,
    db: Session,
    anchor: NodeTable | None,
    max_nodes: int,
    api_keys: list[str] | None = None,
) -> AsyncGenerator[dict, None]:
    """Run the agentic tool loop. Yields SSE event dicts."""
    system_prompt = SYSTEM_PROMPT_PLAN if mode == "plan" else SYSTEM_PROMPT_RESEARCH
    context_msg = _build_context_message(db, session_id, prompt, mode, anchor, max_nodes)

    messages: list[genai_types.Content] = [
        genai_types.Content(role="user", parts=[genai_types.Part.from_text(text=context_msg)]),
    ]

    node_count = 0
    branch_counter: dict[str, int] = {}
    deadline = asyncio.get_event_loop().time() + TIMEOUT_SECONDS

    for iteration in range(MAX_ITERATIONS):
        if asyncio.get_event_loop().time() > deadline:
            logger.warning("Tool loop hit timeout at iteration %d", iteration)
            break

        if node_count >= max_nodes:
            logger.info("Tool loop hit max_nodes cap (%d)", max_nodes)
            break

        response = await _generate_gemini(
            contents=messages,
            system_prompt=system_prompt,
            tools=ALL_TOOLS,
            tool_config=TOOL_CONFIG,
            api_keys=api_keys,
        )

        # Append model response to conversation
        if response.candidates and response.candidates[0].content:
            messages.append(response.candidates[0].content)

        fn_calls = _extract_function_calls(response)
        if not fn_calls:
            # Model returned text instead of tool calls — treat as done
            logger.info("Tool loop: model returned text, treating as done")
            break

        for fc in fn_calls:
            tool_name = fc.name
            tool_args = dict(fc.args) if fc.args else {}

            # Yield tool_used event for frontend display
            yield {"type": "tool_used", "data": {"tool": tool_name, "args": {k: v for k, v in tool_args.items() if k in ("topic", "parent_node_id", "parent_id", "child_id", "edge_kind", "summary")}}}

            try:
                result, events = await _execute_tool(
                    tool_name,
                    tool_args,
                    db=db,
                    session_id=session_id,
                    mode=mode,
                    node_count=node_count,
                    branch_counter=branch_counter,
                )
            except Exception as exc:
                logger.error("Tool %s raised: %s", tool_name, exc, exc_info=True)
                result = {"error": f"Tool {tool_name} failed: {exc}"}
                events = []

            if tool_name == "create_node" and "node_id" in result:
                node_count += 1

            # Yield all SSE events from tool execution
            for event in events:
                yield event

            # Feed result back to Gemini
            messages.append(
                genai_types.Content(
                    role="user",
                    parts=[genai_types.Part.from_function_response(name=tool_name, response=result)],
                )
            )

            if tool_name == "done":
                # Yield summary as system message
                summary_text = result.get("summary", f"Added {node_count} nodes.")
                sys_msg = message_service.create_message(db, session_id, "system", summary_text)
                yield {"type": "message_created", "data": MessageOut.model_validate(sys_msg).model_dump(mode="json")}
                return

    # If we exit the loop without done, auto-complete
    summary_text = f"Added {node_count} {mode} nodes."
    sys_msg = message_service.create_message(db, session_id, "system", summary_text)
    yield {"type": "message_created", "data": MessageOut.model_validate(sys_msg).model_dump(mode="json")}
