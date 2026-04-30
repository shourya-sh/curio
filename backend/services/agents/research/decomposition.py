import json

from ai import call_gemini_json
from services.agents.draft_models import GraphDraft


SYSTEM_PROMPT = """You are Curio's Deep Decomposition Agent.
For research mode, push promising ideas one level deeper. Add sub-mechanisms, prerequisites,
causal reasons, and missing explanatory layers. Do not add fluff or repeats."""


async def expand(*, draft: GraphDraft, prompt: str, session_id: str, max_new_nodes: int = 6) -> GraphDraft:
    user_prompt = {
        "prompt": prompt,
        "current_graph": draft.model_dump(),
        "instructions": [
            f"Add up to {max_new_nodes} new nodes with fresh temp ids that do not collide.",
            "Prefer deep explanatory children for shallow leaves.",
            "Return all existing nodes and edges plus the additions.",
            "Every added node needs details explaining the underlying reason/mechanism.",
        ],
    }
    return await call_gemini_json(
        SYSTEM_PROMPT,
        json.dumps(user_prompt),
        session_id=session_id,
        response_model=GraphDraft,
    )
