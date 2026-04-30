from services.agents.draft_models import EdgeKind, PaletteRole


RESEARCH_PALETTE: dict[PaletteRole, str] = {
    "root": "#14b8a6",
    "branch_a": "#38bdf8",
    "branch_b": "#818cf8",
    "branch_c": "#34d399",
    "branch_d": "#60a5fa",
    "branch_e": "#a78bfa",
    "emphasis": "#f59e0b",
    "neutral": "#94a3b8",
}

PLAN_PALETTE: dict[PaletteRole, str] = {
    "root": "#f97316",
    "branch_a": "#f59e0b",
    "branch_b": "#fb7185",
    "branch_c": "#a78bfa",
    "branch_d": "#22c55e",
    "branch_e": "#38bdf8",
    "emphasis": "#ef4444",
    "neutral": "#94a3b8",
}

EDGE_COLORS: dict[str, dict[EdgeKind, str | None]] = {
    "research": {
        "hierarchy": "#7dd3fc",
        "prerequisite": "#a5b4fc",
        "sequence_next": "#67e8f9",
        "supporting": "#99f6e4",
        "optional": "#cbd5e1",
        "critical": "#fbbf24",
    },
    "plan": {
        "hierarchy": "#fdba74",
        "prerequisite": "#fda4af",
        "sequence_next": "#f59e0b",
        "supporting": "#86efac",
        "optional": "#cbd5e1",
        "critical": "#ef4444",
    },
}

LINE_STYLES: dict[EdgeKind, str] = {
    "hierarchy": "solid",
    "prerequisite": "dashed",
    "sequence_next": "bold",
    "supporting": "solid",
    "optional": "dotted",
    "critical": "bold",
}


def node_color(mode: str, role: PaletteRole, depth: int, branch_index: int) -> str:
    palette = PLAN_PALETTE if mode == "plan" else RESEARCH_PALETTE
    if role in palette and role != "neutral":
        return palette[role]
    branch_roles: list[PaletteRole] = ["branch_a", "branch_b", "branch_c", "branch_d", "branch_e"]
    if depth <= 0:
        return palette["root"]
    return palette[branch_roles[branch_index % len(branch_roles)]]


def edge_color(mode: str, kind: EdgeKind) -> str | None:
    return EDGE_COLORS.get(mode, EDGE_COLORS["research"]).get(kind)


def line_style(kind: EdgeKind) -> str:
    return LINE_STYLES.get(kind, "solid")
