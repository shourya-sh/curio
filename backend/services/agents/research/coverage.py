import json

from ai import call_gemini_json
from services.agents.draft_models import GraphDraft


SYSTEM_PROMPT = """You are Curio's Coverage Agent.
Find important gaps in the research graph: missing prerequisites, hidden assumptions,
unanswered why/how questions, and branches that are too shallow. Return a concise improved graph."""


async def find_gaps(*, draft: GraphDraft, prompt: str, session_id: str, max_new_nodes: int = 4, api_keys: list[str] | None = None) -> GraphDraft:
    user_prompt = {
        "prompt": prompt,
        "current_graph": draft.model_dump(),
        "instructions": [
            f"Add at most {max_new_nodes} gap-filling nodes.",
            "Only add nodes that materially improve understanding.",
            "Return all existing nodes and edges plus additions.",
            "For each new node, explain why it closes a gap in details.",
        ],
    }
    return await call_gemini_json(
        SYSTEM_PROMPT,
        json.dumps(user_prompt),
        session_id=session_id,
        response_model=GraphDraft,
        api_keys=api_keys,
    )
