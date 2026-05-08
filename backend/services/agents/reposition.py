"""Pure-math repositioner. One atomic operation: reposition all children of a parent.
No LLM calls. Uses radial arc placement around parent node."""

import math

from sqlalchemy.orm import Session

from logger import get_logger
from models.tables import NodeLinkTable, NodeTable
from services import graph_service

logger = get_logger("reposition")

CANVAS_W = 3200
CANVAS_H = 1800
GRID_SNAP = 8
NODE_MARGIN = 120
RING_STEP = 260
MIN_RADIUS = 180


def _snap(v: float) -> float:
    return round(v / GRID_SNAP) * GRID_SNAP


def _clamp_x(v: float) -> float:
    return _snap(max(NODE_MARGIN, min(CANVAS_W - NODE_MARGIN, v)))


def _clamp_y(v: float) -> float:
    return _snap(max(NODE_MARGIN, min(CANVAS_H - NODE_MARGIN, v)))


def reposition_children(
    db: Session,
    session_id: int,
    parent_node: NodeTable,
) -> list[tuple[int, float, float]]:
    """Reposition ALL children of parent_node in a radial arc around it.
    Returns [(node_id, new_x, new_y), ...] for every child that moved."""
    logger.info("    reposition_children: parent=%d (%s) at (%.0f, %.0f)", parent_node.id, parent_node.topic[:30], parent_node.position_x, parent_node.position_y)
    child_links = (
        db.query(NodeLinkTable)
        .filter_by(session_id=session_id, parent_id=parent_node.id)
        .all()
    )
    if not child_links:
        return []

    child_ids = [lnk.child_id for lnk in child_links]
    children = (
        db.query(NodeTable)
        .filter(NodeTable.id.in_(child_ids), NodeTable.session_id == session_id)
        .all()
    )
    if not children:
        return []

    cx = float(parent_node.position_x)
    cy = float(parent_node.position_y)
    n = len(children)
    radius = max(MIN_RADIUS, RING_STEP * 0.85) if n <= 5 else RING_STEP

    # Spread children in an arc. For <= 6 children use a half-arc (pi),
    # for more use a wider arc to avoid bunching.
    if n == 1:
        arc_span = 0
        start_angle = 0  # place directly to the right
    elif n <= 6:
        arc_span = math.pi * 0.8
        start_angle = -arc_span / 2
    else:
        arc_span = math.pi * 1.4
        start_angle = -arc_span / 2

    logger.info("    placing %d children, radius=%.0f, arc_span=%.2f", n, radius, arc_span if n > 1 else 0)
    moved: list[tuple[int, float, float]] = []
    for i, child in enumerate(children):
        if n == 1:
            angle = 0
        else:
            angle = start_angle + (arc_span * i / (n - 1))

        new_x = _clamp_x(cx + radius * math.cos(angle))
        new_y = _clamp_y(cy + radius * math.sin(angle))

        child.position_x = new_x
        child.position_y = new_y
        child.original_position_x = new_x
        child.original_position_y = new_y
        moved.append((child.id, new_x, new_y))

    return moved


def reorganize_all(
    db: Session,
    session_id: int,
) -> list[tuple[int, float, float]]:
    """Top-down BFS: for each parent that has children, reposition_children().
    Root stays where it is. Returns all moved nodes."""
    logger.info("  reorganize_all: session=%d", session_id)
    graph = graph_service.get_full_graph(db, session_id)
    nodes_by_id: dict[int, NodeTable] = {n.id: n for n in graph["nodes"]}
    links = graph["links"]

    # Find which nodes are parents
    parent_ids: set[int] = set()
    child_set: set[int] = set()
    for lnk in links:
        parent_ids.add(lnk.parent_id)
        child_set.add(lnk.child_id)

    # Roots = nodes that are never children
    roots = [n for n in graph["nodes"] if n.id not in child_set]

    # BFS from roots, reposition children at each level
    all_moved: list[tuple[int, float, float]] = []
    queue = list(roots)
    visited: set[int] = set()

    while queue:
        node = queue.pop(0)
        if node.id in visited:
            continue
        visited.add(node.id)

        if node.id in parent_ids:
            moved = reposition_children(db, session_id, node)
            all_moved.extend(moved)

        # Enqueue children
        for lnk in links:
            if lnk.parent_id == node.id and lnk.child_id in nodes_by_id:
                child = nodes_by_id[lnk.child_id]
                if child.id not in visited:
                    queue.append(child)

    return all_moved
