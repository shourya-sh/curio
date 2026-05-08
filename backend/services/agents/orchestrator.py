"""Orchestrator — routes prompts to the right agent.

- anchor_node_id provided → Expand Agent (user clicked expand on a node)
- free text prompt        → Context Agent (brain decides what to do)
"""

from sqlalchemy.orm import Session

from logger import get_logger
from models.session_models import MessageOut
from services import graph_service, message_service
from services.agents import context_agent, expand_agent

logger = get_logger("orchestrator")


async def run_pipeline(
    session_id: int,
    prompt: str,
    db: Session,
    *,
    mode: str,
    anchor_node_id: int | None = None,
    api_keys: list[str] | None = None,
):
    """Main entry point. Yields SSE event dicts."""
    logger.info("━━━ PIPELINE START session=%d mode=%s anchor=%s ━━━", session_id, mode, anchor_node_id)
    logger.info("  prompt: %s", prompt[:120])

    # Persist user message
    user_message = message_service.create_user_message(db, session_id, prompt)
    yield {"type": "message_created", "data": MessageOut.model_validate(user_message).model_dump(mode="json")}

    if anchor_node_id:
        logger.info("  → routing to EXPAND AGENT (node_id=%d)", anchor_node_id)
        async for event in expand_agent.run(
            session_id=session_id,
            anchor_node_id=anchor_node_id,
            prompt=prompt,
            mode=mode,
            db=db,
            api_keys=api_keys,
        ):
            yield event
    else:
        logger.info("  → routing to CONTEXT AGENT (free text)")
        async for event in context_agent.run(
            session_id=session_id,
            prompt=prompt,
            mode=mode,
            db=db,
            api_keys=api_keys,
        ):
            yield event
    logger.info("━━━ PIPELINE END session=%d ━━━", session_id)
