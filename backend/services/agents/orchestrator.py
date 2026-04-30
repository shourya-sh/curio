from sqlalchemy.orm import Session

from models.tables import NodeLinkTable, NodeTable
from services import graph_service
from services.agents import single_pass
from services.agents.core import structuring, validation
from services.agents.draft_models import GraphDraft

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


def _find_anchor(db: Session, session_id: str, anchor_node_id: int | None) -> NodeTable | None:
    if anchor_node_id is not None:
        return db.query(NodeTable).filter_by(id=anchor_node_id, session_id=session_id).first()
    nodes = db.query(NodeTable).filter_by(session_id=session_id).order_by(NodeTable.id.asc()).all()
    if len(nodes) == 1:
        return nodes[0]
    return None


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
    anchor = _find_anchor(db, session_id, anchor_node_id)
    if mode == "plan":
        draft = await _plan_draft(session_id, prompt, anchor)
    else:
        draft = await _research_draft(session_id, prompt, anchor)

    structured = structuring.organize(draft=draft, mode=mode, anchor=anchor)
    if structured.sources:
        yield {
            "type": "sources_created",
            "data": {"sources": [s.model_dump() for s in structured.sources]},
        }
    temp_to_real: dict[str, int] = {}
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
        db.flush()
        temp_to_real[node.temp_id] = created.id
        yield {"type": "node_created", "data": _node_dict(created)}

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
            db.flush()
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
        db.flush()
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
