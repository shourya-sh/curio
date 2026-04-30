import json

from ai import call_gemini_json
from services.agents.draft_models import GraphDraft


SYSTEM_PROMPT = """You are Curio's Relationship Agent.
Build a clean directed graph using the provided temporary node ids.
Research mode should be mostly hierarchical from broad ideas to deeper explanations.
Plan mode should expose dependencies, sequence, and critical-path relationships.
Return the same nodes with an explicit edge list. Avoid self-loops, duplicate edges, and chaotic cross-links."""


async def connect(*, draft: GraphDraft, mode: str, session_id: str, anchor_temp_id: str | None = None) -> GraphDraft:
    user_prompt = {
        "mode": mode,
        "anchor_temp_id": anchor_temp_id,
        "nodes": [node.model_dump() for node in draft.nodes],
        "existing_edges": [edge.model_dump() for edge in draft.edges],
        "edge_kinds": ["hierarchy", "prerequisite", "sequence_next", "supporting", "optional", "critical"],
        "instructions": [
            "Return all input nodes unchanged.",
            "Create enough edges that every non-root node has a meaningful parent.",
            "Use hierarchy for core parent-child structure.",
            "Use prerequisite/sequence_next/critical only where it improves understanding.",
            "Keep fan-out readable; avoid dense webs.",
        ],
    }
    connected = await call_gemini_json(
        SYSTEM_PROMPT,
        json.dumps(user_prompt),
        session_id=session_id,
        response_model=GraphDraft,
    )
    if not connected.nodes:
        connected.nodes = draft.nodes
    return connected
