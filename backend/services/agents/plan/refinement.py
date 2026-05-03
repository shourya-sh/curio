import json

from ai import call_gemini_json
from services.agents.draft_models import GraphDraft


SYSTEM_PROMPT = """You are Curio's Plan Refinement Agent.
Improve clarity, sequencing, and missing components in a planning graph. Keep it lean,
practical, and visually readable. Do not overbuild."""


async def improve(*, draft: GraphDraft, prompt: str, session_id: str, api_keys: list[str] | None = None) -> GraphDraft:
    user_prompt = {
        "prompt": prompt,
        "current_graph": draft.model_dump(),
        "instructions": [
            "Clarify vague node wording.",
            "Add at most 3 missing plan nodes if there are obvious gaps.",
            "Prefer sequence_next or prerequisite edges for execution flow.",
            "Return all nodes and edges in the same JSON schema.",
        ],
    }
    return await call_gemini_json(
        SYSTEM_PROMPT,
        json.dumps(user_prompt),
        session_id=session_id,
        response_model=GraphDraft,
        api_keys=api_keys,
    )
