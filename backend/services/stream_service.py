"""Pure SSE transport layer. Validates the session, runs the orchestrator pipeline, and yields SSE events.
All DB persistence (messages, nodes, links) is handled by the orchestrator."""

import asyncio
import json
from starlette.requests import Request
from sqlalchemy.orm import Session
from services import message_service
from services.agents import orchestrator, expand_agent
from services.token_logging import log_prompt_token_usage
from logger import get_logger

logger = get_logger("stream_service")


def sse_event(event: str, data: dict) -> str:
    """Format a single SSE event string."""
    return f"event: {event}\ndata: {json.dumps(data)}\n\n"


async def run_agent_stream(
    session_id: int,
    prompt: str,
    db: Session,
    request: Request,
    anchor_node_id: int | None = None,
    api_keys: list[str] | None = None,
):
    """Async generator that runs the orchestrator pipeline and yields SSE events."""
    try:
        # validate session
        session = message_service.get_session_row(db, session_id)
        if not session:
            yield sse_event("error", {"message": f"Session {session_id} not found"})
            return

        mode = session.mode
        log_prompt_token_usage(
            session_id=session_id,
            mode=mode,
            prompt=prompt,
            source="run_agent_stream",
        )
        if mode not in ("research", "plan"):
            yield sse_event("error", {"message": f"Unknown mode: {mode}"})
            return

        # run agent pipeline, yielding events as they come
        async for event in orchestrator.run_pipeline(session_id, prompt, db, mode=mode, anchor_node_id=anchor_node_id, api_keys=api_keys):
            if await request.is_disconnected():
                logger.info(f"Client disconnected mid-stream session={session_id}")
                return
            yield sse_event(event["type"], event["data"])

        db.commit()
        yield sse_event("done", {})

    except asyncio.CancelledError:
        logger.warning(f"Stream cancelled (client disconnect) session={session_id}")
        db.rollback()

    except Exception as e:
        logger.error(f"Stream error session={session_id}: {e}")
        db.rollback()
        yield sse_event("error", {"message": str(e)})

    finally:
        db.close()
        logger.info(f"Stream ended session={session_id}")


async def run_expand_stream(
    session_id: int,
    node_id: int,
    db: Session,
    request: Request,
    api_keys: list[str] | None = None,
):
    """Async generator that runs the expand agent directly on a node and yields SSE events."""
    try:
        session = message_service.get_session_row(db, session_id)
        if not session:
            yield sse_event("error", {"message": f"Session {session_id} not found"})
            return

        mode = session.mode
        logger.info("Expand stream: session=%d node=%d mode=%s", session_id, node_id, mode)

        async for event in expand_agent.run(
            session_id=session_id,
            anchor_node_id=node_id,
            prompt=None,
            mode=mode,
            db=db,
            api_keys=api_keys,
        ):
            if await request.is_disconnected():
                logger.info(f"Client disconnected mid-expand session={session_id}")
                return
            yield sse_event(event["type"], event["data"])

        db.commit()
        yield sse_event("done", {})

    except asyncio.CancelledError:
        logger.warning(f"Expand stream cancelled (client disconnect) session={session_id} node={node_id}")
        db.rollback()

    except Exception as e:
        logger.error(f"Expand stream error session={session_id} node={node_id}: {e}")
        db.rollback()
        yield sse_event("error", {"message": str(e)})

    finally:
        db.close()
        logger.info(f"Expand stream ended session={session_id} node={node_id}")
