"""Single-call mind-map generator. One Gemini request per user prompt produces
the entire GraphDraft (nodes, palette roles, edges with kinds, summary). All
quality gating, layout, and color/line-style assignment happen locally without
further LLM calls."""

import json

from ai import call_gemini_json
from models.tables import NodeTable
from services.agents.draft_models import GraphDraft


SYSTEM_PROMPT_RESEARCH = """You are Curio's Research Mind-Map Agent.
Build a complete, deeply explanatory research mind map in ONE response.
Follow this strict procedure mentally before answering:
  1. Identify the core question and its sub-mechanisms / prerequisites / implications.
  2. Pick a small number of high-value top-level branches (3-5).
  3. Under each branch include 1-3 deeper nodes that explain the mechanism, the why, or a key example.
  4. Connect them with directed edges from broad to deeper.
Every node MUST include topic, a 1-line summary, multi-sentence details, and useful subtopics.
Use stable temp ids n1, n2, n3, ...
Do not duplicate labels. Do not output shallow one-word nodes. Avoid fluff."""

SYSTEM_PROMPT_PLAN = """You are Curio's Plan Mind-Map Agent.
Build a complete, executable plan mind map in ONE response.
Follow this strict procedure mentally before answering:
  1. Identify the goal and definition of done.
  2. Decompose into 3-5 actionable components.
  3. Under each component include concrete steps, prerequisites, risks, or checkpoints.
  4. Connect them with directed edges (hierarchy / prerequisite / sequence_next / critical) for execution flow.
Every node MUST include topic, summary (1 line), details (outcome + why it matters), and subtopics for steps/checklist.
Use stable temp ids n1, n2, n3, ...
Avoid duplicate labels and shallow nodes."""


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


async def build(
    *,
    prompt: str,
    mode: str,
    session_id: str,
    anchor: NodeTable | None = None,
    max_nodes: int = 14,
) -> GraphDraft:
    """Single Gemini call that returns the full GraphDraft."""
    system_prompt = SYSTEM_PROMPT_PLAN if mode == "plan" else SYSTEM_PROMPT_RESEARCH
    user_prompt = {
        "mode": mode,
        "user_prompt": prompt,
        "anchor_node": _anchor_payload(anchor),
        "limits": {
            "max_nodes": max_nodes,
            "min_top_level_branches": 3,
            "max_top_level_branches": 5,
        },
        "palette_roles": [
            "root",
            "branch_a",
            "branch_b",
            "branch_c",
            "branch_d",
            "branch_e",
            "emphasis",
            "neutral",
        ],
        "edge_kinds": [
            "hierarchy",
            "prerequisite",
            "sequence_next",
            "supporting",
            "optional",
            "critical",
        ],
        "instructions": [
            "Return BOTH nodes and edges in this single response.",
            "Every non-root node must have at least one parent edge.",
            "Use hierarchy for the main parent-child structure.",
            "Use prerequisite/sequence_next/critical only where meaningful.",
            "Avoid self-loops, duplicate edges, and dense webs.",
            "Fill assistant_summary with a 1-2 sentence recap of what was added.",
            "Include sources: 5-8 entries with title, publisher, year when known, url when you have a stable link,",
            "a rich summary (multiple sentences), a short excerpt or paraphrase, and relevance tying each source to map themes.",
            "Prefer textbooks, standards bodies, university-level primers, and major encyclopedias; avoid vague blogs.",
        ],
    }
    return await call_gemini_json(
        system_prompt,
        json.dumps(user_prompt),
        session_id=session_id,
        response_model=GraphDraft,
        retry_on_parse_error=False,
    )
