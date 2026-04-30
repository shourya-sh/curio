from sqlalchemy.orm import Session

from services.agents import orchestrator

async def run(session_id: str, prompt: str, db: Session, anchor_node_id: int | None = None):
    """Run the Gemini-backed research graph pipeline."""
    async for event in orchestrator.run_research(session_id, prompt, db, anchor_node_id=anchor_node_id):
        yield event
