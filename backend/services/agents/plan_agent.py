"""Plan Worker Agent — fills node content with actionable planning details.

Same interface as research_agent but lighter on research, heavier on
concrete steps, checklists, and action items. Listens to user intent more.
One Gemini JSON call. No tool loop.
"""

import json

from ai import call_gemini_json
from logger import get_logger
from services.agents.draft_models import WorkerResult

logger = get_logger("plan_agent")

SYSTEM_PROMPT = """You are Curio's Plan Content Agent.
You receive groups of nodes to fill with actionable planning content.

For each group you get a parent node (with its topic/summary) and a list of
child topic labels. Your job is to fill in planning-focused content for each child:

- summary: 1-2 sentence action description
- details: Concrete steps, checklists, considerations. Focus on "what to do"
  not "what to know". Be practical and specific. Don't over-research — the user
  wants a plan, not an encyclopedia.
- subtopics: 3-5 bullet-point action items or sub-steps
- palette_role: one of root, branch_a, branch_b, branch_c, branch_d, branch_e, emphasis, neutral

Also provide 3-6 reference sources (policies, specs, playbooks, tools).
Each source should reference node topics it supports (by topic string, not ID).

Keep it actionable. The user is building a plan, not reading a textbook."""


def _build_user_prompt(groups: list[dict], mode: str) -> str:
    return json.dumps({
        "mode": mode,
        "instruction": "Fill in actionable details for each child node in every group. Return WorkerResult JSON.",
        "groups": groups,
    })


async def run(
    groups: list[dict],
    *,
    mode: str = "plan",
    session_id: int | None = None,
    api_keys: list[str] | None = None,
) -> WorkerResult:
    """Single Gemini JSON call to fill node content for all groups.

    groups format: [
        {"parent_id": 42, "parent_topic": "Launch MVP", "parent_summary": "...",
         "children": ["Set up CI/CD", "Write tests", "Deploy staging"]},
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
        "Plan agent filled %d groups, %d total children, %d sources",
        len(result.groups),
        sum(len(g.children) for g in result.groups),
        len(result.sources),
    )
    return result
