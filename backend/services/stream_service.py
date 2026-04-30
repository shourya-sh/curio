import json
from starlette.requests import Request
from sqlalchemy.orm import Session
from models.tables import MessageTable, SessionTable
from services.agents import research_agent, plan_agent
from services.token_logging import log_prompt_token_usage
from logger import get_logger

logger = get_logger("stream_service")


def sse_event(event: str, data: dict) -> str:
    """Format a single SSE event string."""
    return f"event: {event}\ndata: {json.dumps(data)}\n\n"


async def run_agent_stream(
    session_id: str,
    prompt: str,
    db: Session,
    request: Request,
    anchor_node_id: int | None = None,
):
    """Async generator that runs the appropriate agent and yields SSE events."""
    try:
        yield sse_event("status", {"message": "Processing..."})

        # validate session
        session = db.query(SessionTable).filter_by(id=session_id).first()
        if not session:
            yield sse_event("error", {"message": f"Session {session_id} not found"})
            return

        user_message = MessageTable(session_id=session_id, role="user", content=prompt)
        db.add(user_message)
        db.flush()
        yield sse_event(
            "message_created",
            {
                "id": user_message.id,
                "session_id": user_message.session_id,
                "role": user_message.role,
                "content": user_message.content,
                "created_at": user_message.created_at.isoformat() if user_message.created_at else None,
            },
        )

        # pick agent based on mode
        mode = session.mode
        log_prompt_token_usage(
            session_id=session_id,
            mode=mode,
            prompt=prompt,
            source="run_agent_stream",
        )
        if mode == "research":
            agent = research_agent.run
        elif mode == "plan":
            agent = plan_agent.run
        else:
            yield sse_event("error", {"message": f"Unknown mode: {mode}"})
            return

        # run agent, yielding events as they come
        async for event in agent(session_id, prompt, db, anchor_node_id=anchor_node_id):
            # check if client disconnected
            if await request.is_disconnected():
                logger.info(f"Client disconnected mid-stream session={session_id}")
                return

            if event["type"] == "message_created":
                data = event.get("data") or {}
                message = MessageTable(
                    session_id=session_id,
                    role=data.get("role") or "system",
                    content=data.get("content") or "",
                )
                db.add(message)
                db.flush()
                event = {
                    "type": "message_created",
                    "data": {
                        "id": message.id,
                        "session_id": message.session_id,
                        "role": message.role,
                        "content": message.content,
                        "created_at": message.created_at.isoformat() if message.created_at else None,
                    },
                }
            elif event["type"] == "sources_created":
                data = event.get("data") or {}
                payload = json.dumps(data)
                message = MessageTable(session_id=session_id, role="sources", content=payload)
                db.add(message)
                db.flush()
                event = {
                    "type": "sources_created",
                    "data": {
                        "id": message.id,
                        "session_id": message.session_id,
                        "sources": data.get("sources") or [],
                        "created_at": message.created_at.isoformat() if message.created_at else None,
                    },
                }
            yield sse_event(event["type"], event["data"])

        db.commit()
        yield sse_event("done", {})

    except Exception as e:
        logger.error(f"Stream error session={session_id}: {e}")
        db.rollback()
        yield sse_event("error", {"message": str(e)})

    finally:
        db.close()
        logger.info(f"Stream ended session={session_id}")
