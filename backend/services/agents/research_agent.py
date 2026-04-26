from services import graph_service
from sqlalchemy.orm import Session


async def run(session_id: str, prompt: str, db: Session):
    """Dummy research agent — creates a root node + 3 subtopics to prove SSE works."""

    root = graph_service.create_node(
        db,
        session_id=session_id,
        topic=prompt,
        summary=f"Overview of: {prompt}",
    )
    db.flush()
    yield {"type": "node_created", "data": _node_dict(root)}

    subtopics = [
        ("Key Concepts", f"Core ideas behind {prompt}"),
        ("Applications", f"Real-world uses of {prompt}"),
        ("Further Reading", f"Resources to learn more about {prompt}"),
    ]

    for topic, summary in subtopics:
        child = graph_service.create_node(
            db,
            session_id=session_id,
            topic=topic,
            summary=summary,
            parent_id=root.id,
        )
        db.flush()
        yield {"type": "node_created", "data": _node_dict(child)}

        # the link was created inside create_node — grab the last link added
        link = child.parent_links[-1]
        yield {
            "type": "link_created",
            "data": {
                "id": link.id,
                "session_id": link.session_id,
                "parent_id": link.parent_id,
                "child_id": link.child_id,
            },
        }


def _node_dict(node):
    return {
        "id": node.id,
        "session_id": node.session_id,
        "topic": node.topic,
        "summary": node.summary,
        "details": node.details,
        "subtopics": node.subtopics,
        "depth": node.depth,
    }
