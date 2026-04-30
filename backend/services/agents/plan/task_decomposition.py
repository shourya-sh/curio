import json

from ai import call_gemini_json
from services.agents.draft_models import GraphDraft


SYSTEM_PROMPT = """You are Curio's Task Decomposition Agent.
For plan mode, break goals into actionable components, steps, dependencies, and checkpoints.
Keep the graph practical and execution-oriented."""


async def expand(*, draft: GraphDraft, prompt: str, session_id: str, max_new_nodes: int = 8) -> GraphDraft:
    user_prompt = {
        "prompt": prompt,
        "current_graph": draft.model_dump(),
        "instructions": [
            f"Add up to {max_new_nodes} task/component nodes with fresh temp ids.",
            "Use details for outcome, why it matters, and definition of done.",
            "Use subtopics for steps, checklist items, risks, or dependencies.",
            "Return all existing nodes and edges plus additions.",
        ],
    }
    return await call_gemini_json(
        SYSTEM_PROMPT,
        json.dumps(user_prompt),
        session_id=session_id,
        response_model=GraphDraft,
    )
