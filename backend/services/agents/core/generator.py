import json

from ai import call_gemini_json
from models.tables import NodeTable
from services.agents.draft_models import GraphDraft


SYSTEM_PROMPT = """You are Curio's Generator Agent.
Create concise but deeply explanatory graph nodes. Every node must carry the core reason behind the concept:
what it explains, why it matters, and the mechanism or planning value behind it.
Return only JSON matching the schema. Use stable temp ids n1, n2, ...
Do not create duplicate labels. Do not create shallow one-word-only nodes."""


def _anchor_payload(anchor: NodeTable | None) -> dict:
    if not anchor:
        return {}
    return {
        "id": anchor.id,
        "topic": anchor.topic,
        "summary": anchor.summary,
        "details": anchor.details,
        "depth": anchor.depth,
    }


async def generate(
    *,
    prompt: str,
    mode: str,
    session_id: str,
    anchor: NodeTable | None = None,
    max_nodes: int = 7,
    api_keys: list[str] | None = None,
) -> GraphDraft:
    user_prompt = {
        "mode": mode,
        "user_prompt": prompt,
        "anchor_node": _anchor_payload(anchor),
        "instructions": [
            f"Generate up to {max_nodes} high-value nodes.",
            "Research mode: concepts, mechanisms, prerequisites, implications.",
            "Plan mode: outcomes, tasks/components, definition of done, risks/dependencies.",
            "Each node must include topic, summary, details, subtopics, and palette_role.",
            "Use palette_role values: root, branch_a, branch_b, branch_c, branch_d, branch_e, emphasis, neutral.",
            "Leave edges empty; the Relationship Agent will connect nodes.",
        ],
    }
    return await call_gemini_json(
        SYSTEM_PROMPT,
        json.dumps(user_prompt),
        session_id=session_id,
        response_model=GraphDraft,
        api_keys=api_keys,
    )
