"""AI graph pipeline: all database writes go through ``graph_service`` and ``message_service``."""

from sqlalchemy.orm import Session

from models.session_models import NodeOut, LinkOut, MessageOut
from models.tables import NodeTable
from services import graph_service, message_service
from services.agents import single_pass
from services.agents.core import structuring, validation
from services.agents.draft_models import GraphDraft, SourceDraft

MAX_RESEARCH_NODES = 14
MAX_PLAN_NODES = 12


def _resolved_sources_payload(
    sources: list[SourceDraft],
    temp_to_real: dict[str, int],
    topic_by_temp: dict[str, str],
) -> list[dict]:
    """Attach real node ids and titles for the Sources panel (temp ids are stripped)."""
    out: list[dict] = []
    for s in sources:
        d = s.model_dump()
        node_ids: list[int] = []
        node_topics: list[str] = []
        for tid in d.get("node_temp_ids") or []:
            rid = temp_to_real.get(tid)
            if rid is None:
                continue
            node_ids.append(rid)
            node_topics.append((topic_by_temp.get(tid) or "").strip())
        d["node_ids"] = node_ids
        d["node_topics"] = node_topics
        d.pop("node_temp_ids", None)
        out.append(d)
    return out


async def _research_draft(session_id: int, prompt: str, anchor: NodeTable | None, api_keys: list[str] | None = None) -> GraphDraft:
    draft = await single_pass.build(
        prompt=prompt,
        mode="research",
        session_id=session_id,
        anchor=anchor,
        max_nodes=MAX_RESEARCH_NODES,
        api_keys=api_keys,
    )
    return validation.filter_draft(draft, mode="research", max_nodes=MAX_RESEARCH_NODES)


async def _plan_draft(session_id: int, prompt: str, anchor: NodeTable | None, api_keys: list[str] | None = None) -> GraphDraft:
    draft = await single_pass.build(
        prompt=prompt,
        mode="plan",
        session_id=session_id,
        anchor=anchor,
        max_nodes=MAX_PLAN_NODES,
        api_keys=api_keys,
    )
    return validation.filter_draft(draft, mode="plan", max_nodes=MAX_PLAN_NODES, max_fanout=5)


async def run_pipeline(session_id: int, prompt: str, db: Session, *, mode: str, anchor_node_id: int | None = None, api_keys: list[str] | None = None):
    # persist user message
    user_message = message_service.create_user_message(db, session_id, prompt)
    yield {"type": "message_created", "data": MessageOut.model_validate(user_message).model_dump(mode="json")}

    anchor = graph_service.find_expansion_anchor(db, session_id, anchor_node_id)
    if mode == "plan":
        draft = await _plan_draft(session_id, prompt, anchor, api_keys=api_keys)
    else:
        draft = await _research_draft(session_id, prompt, anchor, api_keys=api_keys)

    structured = structuring.organize(draft=draft, mode=mode, anchor=anchor)
    temp_to_real: dict[str, int] = {}
    topic_by_temp = {node.temp_id: node.topic for node in structured.nodes}
    child_ids = {edge.child_temp_id for edge in structured.edges}
    root_temp_ids = [node.temp_id for node in structured.nodes if node.temp_id not in child_ids]

    for node in structured.nodes:
        created = graph_service.create_node(
            db,
            session_id=session_id,
            topic=node.topic,
            summary=node.summary,
            details=node.details,
            position_x=node.position_x,
            position_y=node.position_y,
            node_type="task" if mode == "plan" else "topic",
            color=node.color,
            subtopics=node.subtopics,
            depth=node.depth,
        )
        temp_to_real[node.temp_id] = created.id
        yield {"type": "node_created", "data": NodeOut.model_validate(created).model_dump(mode="json")}

    if structured.sources:
        sources_payload = {"sources": _resolved_sources_payload(structured.sources, temp_to_real, topic_by_temp)}
        sources_message = message_service.create_sources_message(db, session_id, sources_payload)
        yield {
            "type": "sources_created",
            "data": {
                "id": sources_message.id,
                "session_id": sources_message.session_id,
                "sources": sources_payload.get("sources") or [],
                "created_at": sources_message.created_at.isoformat() if sources_message.created_at else None,
            },
        }

    if anchor:
        for temp_id in root_temp_ids:
            child_id = temp_to_real.get(temp_id)
            if child_id is None:
                continue
            link = graph_service.create_link(
                db,
                session_id=session_id,
                parent_id=anchor.id,
                child_id=child_id,
                color=None,
                line_style="solid",
            )
            yield {"type": "link_created", "data": LinkOut.model_validate(link).model_dump(mode="json")}

    for edge in structured.edges:
        parent_id = temp_to_real.get(edge.parent_temp_id)
        child_id = temp_to_real.get(edge.child_temp_id)
        if parent_id is None or child_id is None:
            continue
        link = graph_service.create_link(
            db,
            session_id=session_id,
            parent_id=parent_id,
            child_id=child_id,
            color=edge.color,
            line_style=edge.line_style,
        )
        yield {"type": "link_created", "data": LinkOut.model_validate(link).model_dump(mode="json")}

    summary = structured.assistant_summary or (
        f"Added {len(structured.nodes)} {mode} nodes and {len(structured.edges)} connections."
    )
    sys_message = message_service.create_message(db, session_id, "system", summary)
    yield {"type": "message_created", "data": MessageOut.model_validate(sys_message).model_dump(mode="json")}
