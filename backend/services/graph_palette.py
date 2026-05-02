from services.agents.draft_models import EdgeKind, PaletteRole


RESEARCH_PALETTE: dict[PaletteRole, str] = {
    "root": "#0ea5a4",
    "branch_a": "#4f8df7",
    "branch_b": "#7c6df2",
    "branch_c": "#1fbf9a",
    "branch_d": "#3aa7d8",
    "branch_e": "#b06ee8",
    "emphasis": "#d89a1d",
    "neutral": "#7891ad",
}

PLAN_PALETTE: dict[PaletteRole, str] = {
    "root": "#e9782f",
    "branch_a": "#d89a1d",
    "branch_b": "#e06a8a",
    "branch_c": "#8b78e6",
    "branch_d": "#24a96b",
    "branch_e": "#3aa7d8",
    "emphasis": "#d84a4a",
    "neutral": "#7891ad",
}

EDGE_COLORS: dict[str, dict[EdgeKind, str | None]] = {
    "research": {
        "hierarchy": "#66c7de",
        "prerequisite": "#9da8ef",
        "sequence_next": "#54c9c8",
        "supporting": "#86dbc9",
        "optional": "#b8c4d4",
        "critical": "#d8a52d",
    },
    "plan": {
        "hierarchy": "#e9a46b",
        "prerequisite": "#e8a0ad",
        "sequence_next": "#d99a22",
        "supporting": "#7fd19e",
        "optional": "#b8c4d4",
        "critical": "#d84a4a",
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
