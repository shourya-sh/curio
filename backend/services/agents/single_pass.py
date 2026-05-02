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
  5. Check that every node owns a distinct conceptual job; merge or rename anything that overlaps another node's meaning.
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
  5. Check that every node owns a distinct workstream or decision; merge or rename anything that overlaps another node's job.
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


def _instructions_for_mode(mode: str) -> list[str]:
    common_graph = [
        "Return BOTH nodes and edges in this single response.",
        "Every non-root node must have at least one parent edge.",
        "Use hierarchy for the main parent-child structure.",
        "Use prerequisite/sequence_next/critical only where meaningful.",
        "Avoid self-loops, duplicate edges, and dense webs.",
        "Each top-level branch should get one palette role (branch_a, branch_b, etc.) and descendants should preserve that branch identity unless emphasis is truly needed.",
        "Node topics should be compact display labels: specific enough to be unique, short enough to read as a single label.",
        "Do not split the same idea into multiple neighboring nodes; make siblings mutually exclusive and collectively useful.",
        "Fill assistant_summary with a 1-2 sentence recap of what was added.",
    ]
    if mode == "plan":
        return common_graph + [
            "Include references: 3-6 substantive documents (policies, specs, playbooks, templates, or standards) with title,",
            "publisher or organization, year when known, url when you have a stable link, a rich summary, a short excerpt, and relevance.",
            "Each reference MUST set node_temp_ids to a non-empty array of temp_ids (e.g. [\"n2\",\"n4\"]) for the plan nodes it supports.",
            "Every node temp_id in your graph MUST appear in at least one reference's node_temp_ids (full coverage).",
            "Do not cite sources that are not clearly tied to specific nodes on this map.",
        ]
    return common_graph + [
        "Include sources: 5-8 substantive references with title, publisher, year when known, url when you have a stable link,",
        "a rich summary (multiple sentences), a short excerpt or paraphrase, and brief relevance for the cited nodes.",
        "Each source MUST set node_temp_ids to a non-empty array of temp_ids (e.g. [\"n3\",\"n7\"]) listing every node that source substantiates.",
        "Every node temp_id in your graph MUST appear in at least one source's node_temp_ids (full coverage).",
        "Prefer textbooks, standards bodies, university-level primers, and major encyclopedias; avoid vague blogs.",
    ]


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
        "instructions": _instructions_for_mode(mode),
    }
    return await call_gemini_json(
        system_prompt,
        json.dumps(user_prompt),
        session_id=session_id,
        response_model=GraphDraft,
        retry_on_parse_error=False,
    )
