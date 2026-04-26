from sqlalchemy.orm import Session


async def run(session_id: str, prompt: str, db: Session):
    """Stub plan agent — plan mode not implemented yet."""
    yield {"type": "status", "data": {"message": "Plan mode coming soon"}}
