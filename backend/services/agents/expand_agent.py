"""Expand Agent — generates subtopics for a single parent node, delegates
to research/plan worker for content, persists to DB, repositions children.

Flow: 1 Gemini JSON call (pick subtopics) → 1 worker call (fill details)
     → DB writes → reposition → SSE events
"""

import json
from collections.abc import AsyncGenerator

from sqlalchemy.orm import Session

from ai import call_gemini_json
from logger import get_logger
from models.session_models import NodeOut, LinkOut, MessageOut
from models.tables import NodeTable
from services import graph_service, message_service
from services.agents import research_agent, plan_agent
from services.agents.draft_models import ExpandResult
from services.agents.reposition import reposition_children
from services.graph_palette import node_color

logger = get_logger("expand_agent")

SYSTEM_PROMPT = """You are Curio's Expand Agent.
Given a parent node, propose 3-5 subtopics that branch from it.

Return ONLY short topic labels — no details, no summaries.
Each subtopic should be a distinct, non-overlapping aspect worth exploring.
Be specific, not generic. Think about what a curious learner would want to
drill into next."""


def _build_user_prompt(parent: NodeTable, user_prompt: str | None) -> str:
    ctx = {
        "parent": {
            "topic": parent.topic,
            "summary": parent.summary or "",
            "details": parent.details or "",
            "subtopics": parent.subtopics or [],
        },
    }
    if user_prompt:
        ctx["user_guidance"] = user_prompt
    return json.dumps(ctx)


async def run(
    *,
    session_id: int,
    anchor_node_id: int,
    prompt: str | None = None,
    mode: str,
    db: Session,
    api_keys: list[str] | None = None,
) -> AsyncGenerator[dict, None]:
    """Expand a single node. Yields SSE event dicts."""
    logger.info("── EXPAND AGENT START node=%d session=%d ──", anchor_node_id, session_id)

    parent = graph_service.get_node(db, session_id, anchor_node_id)
    if not parent:
        logger.warning("  node %d not found", anchor_node_id)
        yield {"type": "error", "data": {"message": f"Node {anchor_node_id} not found"}}
        return

    logger.info("  parent: '%s' (depth=%d)", parent.topic, parent.depth or 0)
    yield {"type": "status", "data": {"message": f"Expanding '{parent.topic}'..."}}

    # Step 1: Pick subtopics (1 Gemini call)
    logger.info("  step 1: picking subtopics (gemini call)...")
    user_prompt = _build_user_prompt(parent, prompt)
    expand_result: ExpandResult = await call_gemini_json(
        SYSTEM_PROMPT,
        user_prompt,
        session_id=str(session_id),
        response_model=ExpandResult,
        api_keys=api_keys,
    )

    if not expand_result.subtopics:
        yield {"type": "error", "data": {"message": "No subtopics generated"}}
        return

    topics = [st.topic for st in expand_result.subtopics]
    logger.info("  subtopics picked: %s", topics)

    yield {"type": "status", "data": {"message": f"Filling details for {len(topics)} nodes..."}}

    # Step 2: Delegate to worker (1 Gemini call)
    worker_name = "PLAN" if mode == "plan" else "RESEARCH"
    logger.info("  step 2: delegating to %s AGENT for content...", worker_name)
    worker_groups = [{
        "parent_id": parent.id,
        "parent_topic": parent.topic,
        "parent_summary": parent.summary or "",
        "children": topics,
    }]

    worker = plan_agent if mode == "plan" else research_agent
    worker_result = await worker.run(
        worker_groups,
        mode=mode,
        session_id=session_id,
        api_keys=api_keys,
    )

    # Step 3: Persist to DB + emit SSE events
    logger.info("  step 3: persisting %d filled nodes to DB...", sum(len(g.children) for g in worker_result.groups))
    created_node_ids: list[int] = []
    topic_to_node_id: dict[str, int] = {}

    for group in worker_result.groups:
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
            created_node_ids.append(created.id)
            topic_to_node_id[child.topic] = created.id

            yield {"type": "node_created", "data": NodeOut.model_validate(created).model_dump(mode="json")}

            # Emit auto-created parent link
            from models.tables import NodeLinkTable
            link = (
                db.query(NodeLinkTable)
                .filter_by(session_id=session_id, parent_id=parent.id, child_id=created.id)
                .first()
            )
            if link:
                yield {"type": "link_created", "data": LinkOut.model_validate(link).model_dump(mode="json")}

    # Step 4: Persist sources
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
                "title": src.title,
                "url": src.url,
                "publisher": src.publisher,
                "year": src.year,
                "summary": src.summary,
                "excerpt": src.excerpt,
                "relevance": src.relevance,
                "node_ids": node_ids,
                "node_topics": node_topics,
            })
        if sources_payload:
            src_msg = message_service.create_sources_message(db, session_id, {"sources": sources_payload})
            yield {
                "type": "sources_created",
                "data": {
                    "id": src_msg.id,
                    "session_id": src_msg.session_id,
                    "sources": sources_payload,
                    "created_at": src_msg.created_at.isoformat() if src_msg.created_at else None,
                },
            }

    # Step 5: Reposition children around parent
    logger.info("  step 5: repositioning %d children around parent...", len(created_node_ids))
    moved = reposition_children(db, session_id, parent)
    logger.info("  repositioned %d nodes", len(moved))
    for node_id, x, y in moved:
        yield {"type": "node_updated", "data": {"id": node_id, "session_id": session_id, "position_x": x, "position_y": y}}

    # Summary message
    summary = f"Expanded '{parent.topic}' with {len(created_node_ids)} subtopics."
    sys_msg = message_service.create_message(db, session_id, "system", summary)
    yield {"type": "message_created", "data": MessageOut.model_validate(sys_msg).model_dump(mode="json")}
    logger.info("── EXPAND AGENT END (%d nodes created) ──", len(created_node_ids))
