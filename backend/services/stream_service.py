import json
from starlette.requests import Request
from sqlalchemy.orm import Session
from models.tables import SessionTable
from services.agents import research_agent, plan_agent
from logger import get_logger

logger = get_logger("stream_service")


def sse_event(event: str, data: dict) -> str:
    """Format a single SSE event string."""
    return f"event: {event}\ndata: {json.dumps(data)}\n\n"


async def run_agent_stream(session_id: str, prompt: str, db: Session, request: Request):
    """Async generator that runs the appropriate agent and yields SSE events."""
    try:
        yield sse_event("status", {"message": "Processing..."})

        # validate session
        session = db.query(SessionTable).filter_by(id=session_id).first()
        if not session:
            yield sse_event("error", {"message": f"Session {session_id} not found"})
            return

        # pick agent based on mode
        mode = session.mode
        if mode == "research":
            agent = research_agent.run
        elif mode == "plan":
            agent = plan_agent.run
        else:
            yield sse_event("error", {"message": f"Unknown mode: {mode}"})
            return

        # run agent, yielding events as they come
        async for event in agent(session_id, prompt, db):
            # check if client disconnected
            if await request.is_disconnected():
                logger.info(f"Client disconnected mid-stream session={session_id}")
                return

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
