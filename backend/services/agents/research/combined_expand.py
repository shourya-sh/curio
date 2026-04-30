import json

from ai import call_gemini_json
from services.agents.draft_models import GraphDraft

SYSTEM_PROMPT = """You are Curio's Research Expansion Agent (single pass).
Do BOTH jobs in one response:
1) Deep decomposition: push important ideas one level deeper (sub-mechanisms, prerequisites, causal "why").
2) Coverage: add a small number of gap-filling nodes (missing prerequisites, shallow branches, unstated assumptions).

Do not duplicate labels. Avoid fluff. Return the full graph (all prior nodes and edges plus additions)."""


async def expand(*, draft: GraphDraft, prompt: str, session_id: str, max_new_nodes: int = 8) -> GraphDraft:
    user_prompt = {
        "prompt": prompt,
        "current_graph": draft.model_dump(),
        "instructions": [
            f"Add at most {max_new_nodes} new nodes total across decomposition + gap-filling.",
            "Use fresh temp ids that do not collide with existing ids.",
            "Every new node must have substantive details (mechanism / rationale).",
            "Return all existing nodes and edges plus additions.",
        ],
    }
    return await call_gemini_json(
        SYSTEM_PROMPT,
        json.dumps(user_prompt),
        session_id=session_id,
        response_model=GraphDraft,
    )
