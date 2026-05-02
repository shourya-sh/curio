"""AI graph pipeline: all database writes go through ``graph_service`` (no direct ``db.add`` / queries here)."""

from sqlalchemy.orm import Session

from models.tables import NodeLinkTable, NodeTable
from services import graph_service
from services.agents import single_pass
from services.agents.core import structuring, validation
from services.agents.draft_models import GraphDraft, SourceDraft

MAX_RESEARCH_NODES = 14
MAX_PLAN_NODES = 12


def _node_dict(node: NodeTable) -> dict:
    return {
        "id": node.id,
        "session_id": node.session_id,
        "topic": node.topic,
        "summary": node.summary,
        "details": node.details,
        "subtopics": node.subtopics,
        "depth": node.depth,
        "position_x": node.position_x,
        "position_y": node.position_y,
        "original_position_x": getattr(node, "original_position_x", node.position_x),
        "original_position_y": getattr(node, "original_position_y", node.position_y),
        "node_type": node.node_type,
        "color": node.color,
        "created_at": node.created_at.isoformat() if node.created_at else None,
        "updated_at": node.updated_at.isoformat() if node.updated_at else None,
    }


def _link_dict(link: NodeLinkTable) -> dict:
    return {
        "id": link.id,
        "session_id": link.session_id,
        "parent_id": link.parent_id,
        "child_id": link.child_id,
        "color": link.color,
        "line_style": link.line_style,
        "created_at": link.created_at.isoformat() if link.created_at else None,
    }


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


async def _research_draft(session_id: str, prompt: str, anchor: NodeTable | None) -> GraphDraft:
    draft = await single_pass.build(
        prompt=prompt,
        mode="research",
        session_id=session_id,
        anchor=anchor,
        max_nodes=MAX_RESEARCH_NODES,
    )
    return validation.filter_draft(draft, mode="research", max_nodes=MAX_RESEARCH_NODES)


async def _plan_draft(session_id: str, prompt: str, anchor: NodeTable | None) -> GraphDraft:
    draft = await single_pass.build(
        prompt=prompt,
        mode="plan",
        session_id=session_id,
        anchor=anchor,
        max_nodes=MAX_PLAN_NODES,
    )
    return validation.filter_draft(draft, mode="plan", max_nodes=MAX_PLAN_NODES, max_fanout=5)


async def run_pipeline(session_id: str, prompt: str, db: Session, *, mode: str, anchor_node_id: int | None = None):
    anchor = graph_service.find_expansion_anchor(db, session_id, anchor_node_id)
    if mode == "plan":
        draft = await _plan_draft(session_id, prompt, anchor)
    else:
        draft = await _research_draft(session_id, prompt, anchor)

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
        yield {"type": "node_created", "data": _node_dict(created)}

    if structured.sources:
        yield {
            "type": "sources_created",
            "data": {"sources": _resolved_sources_payload(structured.sources, temp_to_real, topic_by_temp)},
        }

    if anchor:
        for temp_id in root_temp_ids:
            child_id = temp_to_real.get(temp_id)
            if child_id is None:
                continue
            link = graph_service.create_link(
                db,
                session_id=session_id,
                parent_id=str(anchor.id),
                child_id=str(child_id),
                color=None,
                line_style="solid",
            )
            yield {"type": "link_created", "data": _link_dict(link)}

    for edge in structured.edges:
        parent_id = temp_to_real.get(edge.parent_temp_id)
        child_id = temp_to_real.get(edge.child_temp_id)
        if parent_id is None or child_id is None:
            continue
        link = graph_service.create_link(
            db,
            session_id=session_id,
            parent_id=str(parent_id),
            child_id=str(child_id),
            color=edge.color,
            line_style=edge.line_style,
        )
        yield {"type": "link_created", "data": _link_dict(link)}

    summary = structured.assistant_summary or (
        f"Added {len(structured.nodes)} {mode} nodes and {len(structured.edges)} connections."
    )
    yield {"type": "message_created", "data": {"role": "system", "content": summary}}


async def run_research(session_id: str, prompt: str, db: Session, *, anchor_node_id: int | None = None):
    async for event in run_pipeline(session_id, prompt, db, mode="research", anchor_node_id=anchor_node_id):
        yield event


async def run_plan(session_id: str, prompt: str, db: Session, *, anchor_node_id: int | None = None):
    async for event in run_pipeline(session_id, prompt, db, mode="plan", anchor_node_id=anchor_node_id):
        yield event
