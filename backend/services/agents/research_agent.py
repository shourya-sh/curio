"""Research Worker Agent — fills node content with research-depth details.

Input:  groups of [[parent, child_topic, child_topic, ...], ...]
Output: WorkerResult with filled details, subtopics, sources.
One Gemini JSON call. No tool loop.
"""

import json

from ai import call_gemini_json
from logger import get_logger
from services.agents.draft_models import WorkerResult

logger = get_logger("research_agent")

SYSTEM_PROMPT = """You are Curio's Research Content Agent.
You receive groups of nodes to fill with research-quality content.

For each group you get a parent node (with its topic/summary) and a list of
child topic labels. Your job is to fill in rich content for each child:

- summary: 1-2 sentence overview
- details: Multi-paragraph explanation with depth. Be thorough — this is the
  main content users read. Include key concepts, mechanisms, examples.
- subtopics: 3-6 bullet-point sub-items that could be expanded further
- palette_role: one of root, branch_a, branch_b, branch_c, branch_d, branch_e, emphasis, neutral

Also provide 4-8 research sources that support the nodes. Each source should
reference node topics it supports (by topic string, not ID).

Prefer textbooks, standards bodies, university primers, seminal papers.
Be substantive — no filler."""


def _build_user_prompt(groups: list[dict], mode: str) -> str:
    return json.dumps({
        "mode": mode,
        "instruction": "Fill in details for each child node in every group. Return WorkerResult JSON.",
        "groups": groups,
    })


async def run(
    groups: list[dict],
    *,
    mode: str = "research",
    session_id: int | None = None,
    api_keys: list[str] | None = None,
) -> WorkerResult:
    """Single Gemini JSON call to fill node content for all groups.

    groups format: [
        {"parent_id": 42, "parent_topic": "Physics", "parent_summary": "...",
         "children": ["Quantum Mechanics", "Relativity", "Thermodynamics"]},
        ...
    ]
    """
    user_prompt = _build_user_prompt(groups, mode)
    result = await call_gemini_json(
        SYSTEM_PROMPT,
        user_prompt,
        session_id=str(session_id) if session_id else None,
        response_model=WorkerResult,
        api_keys=api_keys,
    )
    logger.info(
        "Research agent filled %d groups, %d total children, %d sources",
        len(result.groups),
        sum(len(g.children) for g in result.groups),
        len(result.sources),
    )
    return result
