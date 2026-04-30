"""Radial mind-map layout: nodes on concentric rings around the anchor (or canvas
center), with angular sectors allocated by subtree weight. Post-pass repulsion
prevents overlapping node disks (logical radius ~56px matching the frontend)."""

import math
from dataclasses import dataclass

from models.tables import NodeTable
from services.agents.draft_models import GraphEdgeDraft, GraphNodeDraft

CANVAS_W = 1200
CANVAS_H = 720
GRID_SNAP = 8
NODE_MARGIN = 72
# Match frontend DEFAULT_NODE_RADIUS (56) + comfortable gap between disk edges.
NODE_DISK_RADIUS = 56
MIN_CENTER_SEP = 2 * NODE_DISK_RADIUS + 32


@dataclass(frozen=True)
class PositionedDraft:
    temp_id: str
    depth: int
    position_x: float
    position_y: float
    branch_index: int


def snap(value: float) -> float:
    return round(value / GRID_SNAP) * GRID_SNAP


def clamp_x(value: float) -> float:
    return snap(max(NODE_MARGIN, min(CANVAS_W - NODE_MARGIN, value)))


def clamp_y(value: float) -> float:
    return snap(max(NODE_MARGIN, min(CANVAS_H - NODE_MARGIN, value)))


def root_position(anchor: NodeTable | None) -> tuple[float, float]:
    if anchor:
        return float(anchor.position_x), float(anchor.position_y)
    return CANVAS_W / 2, CANVAS_H / 2


def _subtree_size(temp_id: str, children: dict[str, list[str]], memo: dict[str, int]) -> int:
    if temp_id in memo:
        return memo[temp_id]
    total = 1
    for c in children.get(temp_id, []):
        total += _subtree_size(c, children, memo)
    memo[temp_id] = total
    return total


def _assign_polar(
    node_id: str,
    angle_lo: float,
    angle_hi: float,
    depth: int,
    children: dict[str, list[str]],
    sizes: dict[str, int],
    angles: dict[str, float],
    depths: dict[str, int],
    branch_index: int,
) -> None:
    angles[node_id] = (angle_lo + angle_hi) / 2
    depths[node_id] = depth
    kids = list(dict.fromkeys(children.get(node_id, [])))
    if not kids:
        return
    span = angle_hi - angle_lo
    total_w = sum(max(1, sizes.get(k, 1)) for k in kids)
    cursor = angle_lo
    for k in kids:
        w = max(1, sizes.get(k, 1))
        piece = span * (w / total_w)
        _assign_polar(k, cursor, cursor + piece, depth + 1, children, sizes, angles, depths, branch_index)
        cursor += piece


def _polar_to_xy(theta: float, radius: float, cx: float, cy: float) -> tuple[float, float]:
    return cx + radius * math.cos(theta), cy + radius * math.sin(theta)


def _resolve_overlaps(
    positions: dict[str, tuple[float, float]],
    iterations: int = 72,
) -> None:
    ids = list(positions.keys())
    for _ in range(iterations):
        moved = False
        for i in range(len(ids)):
            for j in range(i + 1, len(ids)):
                a, b = ids[i], ids[j]
                x1, y1 = positions[a]
                x2, y2 = positions[b]
                dx = x2 - x1
                dy = y2 - y1
                dist = math.hypot(dx, dy) + 1e-6
                if dist < MIN_CENTER_SEP:
                    push = (MIN_CENTER_SEP - dist) * 0.52
                    nx = dx / dist * push
                    ny = dy / dist * push
                    x1 -= nx
                    y1 -= ny
                    x2 += nx
                    y2 += ny
                    positions[a] = (clamp_x(x1), clamp_y(y1))
                    positions[b] = (clamp_x(x2), clamp_y(y2))
                    moved = True
        if not moved:
            break


def layout_graph(
    nodes: list[GraphNodeDraft],
    edges: list[GraphEdgeDraft],
    *,
    anchor: NodeTable | None = None,
) -> dict[str, PositionedDraft]:
    """Radial layered layout from the anchor/center; no overlapping node disks."""
    if not nodes:
        return {}

    known = {node.temp_id for node in nodes}
    children: dict[str, list[str]] = {}
    parents: dict[str, str] = {}
    for edge in edges:
        if edge.parent_temp_id not in known or edge.child_temp_id not in known:
            continue
        bucket = children.setdefault(edge.parent_temp_id, [])
        if edge.child_temp_id not in bucket:
            bucket.append(edge.child_temp_id)
        parents.setdefault(edge.child_temp_id, edge.parent_temp_id)

    roots = [node.temp_id for node in nodes if node.temp_id not in parents]
    if not roots:
        roots = [nodes[0].temp_id]

    cx, cy = root_position(anchor)
    base_depth = int(anchor.depth) + 1 if anchor else 0

    memo: dict[str, int] = {}
    sizes = {tid: _subtree_size(tid, children, memo) for tid in known}

    angles: dict[str, float] = {}
    depths: dict[str, int] = {}

    roots_sorted = sorted(roots)
    if len(roots_sorted) == 1:
        _assign_polar(roots_sorted[0], -math.pi, math.pi, 0, children, sizes, angles, depths, 0)
    else:
        total_w = sum(max(1, sizes[r]) for r in roots_sorted)
        cursor = -math.pi
        full = 2 * math.pi
        for idx, r in enumerate(roots_sorted):
            w = max(1, sizes[r])
            piece = full * (w / total_w)
            _assign_polar(r, cursor, cursor + piece, 0, children, sizes, angles, depths, idx)
            cursor += piece

    max_depth = max(depths.values()) if depths else 0
    ring_step = max(MIN_CENTER_SEP * 0.95, 128)
    r0 = max(160, min(240, 120 + ring_step * 0.35))

    raw_xy: dict[str, tuple[float, float]] = {}
    for tid in known:
        if tid not in angles:
            angles[tid] = 0.0
        if tid not in depths:
            depths[tid] = 0
        theta = angles[tid]
        d = depths[tid]
        rad = r0 + d * ring_step
        x, y = _polar_to_xy(theta, rad, cx, cy)
        raw_xy[tid] = (clamp_x(x), clamp_y(y))

    _resolve_overlaps(raw_xy)

    root_index = {r: i for i, r in enumerate(roots_sorted)}

    def _root_of(tid: str) -> str:
        cur = tid
        while cur in parents:
            cur = parents[cur]
        return cur

    positioned: dict[str, PositionedDraft] = {}
    for tid in known:
        x, y = raw_xy[tid]
        rroot = _root_of(tid)
        bi = root_index.get(rroot, 0)
        positioned[tid] = PositionedDraft(
            temp_id=tid,
            depth=base_depth + depths.get(tid, 0),
            position_x=x,
            position_y=y,
            branch_index=bi,
        )

    return positioned
