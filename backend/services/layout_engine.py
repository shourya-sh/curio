"""Pure-math layout engine. Single source of truth for graph positions.

Public API:
- compute_layout(nodes, links, *, mode) -> dict[node_id, (x, y)]
- apply_layout(db, session_id, *, mode=None) -> list[(node_id, new_x, new_y)]

Layout modes:
- radial : concentric rings around the root, angular sectors weighted by
           subtree size. Best for hierarchical "sun" maps.
- tree   : top-down layered. Depth = vertical row, siblings spaced left→right
           proportional to subtree width. Best for clear hierarchies / flows.
- grid   : compact square packing (BFS order from root). Best for dense maps
           without strong hierarchy.
- web    : force-directed weave. Repulsion + spring on every link (including
           cross-links) so interconnected clusters arrange themselves
           organically. Best when the agent adds many cross-links.

Guarantees (all modes):
- Single root (lowest-id node with no incoming link) anchors the layout.
- A final overlap-resolution pass guarantees no two node *pills* overlap,
  using the same axis-aligned box model as `frontend/src/lib/nodeDisplay.ts`
  (not circular disks — those underestimated wide labels).
"""

import math
import random
from collections import defaultdict

from sqlalchemy.orm import Session

from logger import get_logger
from models.tables import NodeLinkTable, NodeTable

logger = get_logger("layout_engine")


# ── Canvas geometry ───────────────────────────────────────────
# Generous logical canvas. Frontend viewport pans/zooms freely so the user
# never feels constrained by these numbers, but agent-placed positions stay
# clustered near the centre.
CANVAS_W = 12000
CANVAS_H = 7200
CANVAS_CX = CANVAS_W // 2
CANVAS_CY = CANVAS_H // 2

GRID_SNAP = 4

# Mirrors frontend `nodeDisplay.ts` (radii + pill box sizing).
DEFAULT_RADIUS = 56
MIN_RADIUS = 28
MAX_RADIUS = 100
MIN_NODE_WIDTH = 112.0
MAX_NODE_WIDTH = 560.0
MIN_NODE_HEIGHT = 66.0
MAX_NODE_HEIGHT = 520.0
_HORIZONTAL_PAD = 44.0
_AVG_CHAR_EM = 0.58
_LINE_HEIGHT_FACTOR = 1.08
_VERTICAL_PAD = 30.0

# Minimum gap between pill *edges* after layout (logical px).
NODE_EDGE_PAD = 28.0

# Legacy disk repulsion tuning (web layout) — scaled from circumradius.
NODE_PAD = 56

# Layout tuning.
RADIAL_RING_STEP = 360
RADIAL_MIN_R = 240

TREE_LAYER_GAP = 320
TREE_NODE_GAP = 60

GRID_GAP = 80

WEB_TARGET_LINK_LEN = 360
WEB_RANDOM_JITTER = 70
WEB_ITERATIONS = 140
WEB_REPULSION_K = 0.55
WEB_SPRING_K = 0.06

LAYOUT_MODES = ("radial", "tree", "grid", "web")
DEFAULT_LAYOUT = "radial"


# ── Helpers ───────────────────────────────────────────────────


def _snap(v: float) -> float:
    return round(v / GRID_SNAP) * GRID_SNAP


def _clamp(v: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, v))


def _subtopic_count(st: object) -> int:
    if st is None:
        return 0
    if isinstance(st, list):
        return len(st)
    if isinstance(st, dict):
        return len(st)
    if isinstance(st, str) and st.strip():
        return 1
    return 0


def _chars_per_line_for_width(width_px: float, font_size: float) -> int:
    char_px = font_size * _AVG_CHAR_EM
    inner = max(48.0, width_px - _HORIZONTAL_PAD)
    return max(6, int(inner // max(4.0, char_px)))


def node_half_extents(node: NodeTable) -> tuple[float, float]:
    """Match `frontend/src/lib/nodeDisplay.readNodeBoxPx` — half-width / half-height in canvas px."""
    st = node.subtopics
    if isinstance(st, dict) and "radiusPx" in st:
        try:
            r = float(st["radiusPx"])
            r = max(MIN_RADIUS, min(MAX_RADIUS, r))
            return (r, r)
        except (TypeError, ValueError):
            pass

    topic = (node.topic or "").strip()
    topic_chars = len(topic)
    depth = int(node.depth or 0)
    summary = node.summary or ""
    details = node.details or ""
    content_weight = (
        min(26.0, len(summary) / 10.0)
        + min(34.0, len(details) / 24.0)
        + _subtopic_count(st) * 5.0
    )
    depth_weight = max(0, 3 - depth) * 9.0
    importance = depth_weight + content_weight
    font_size = _clamp(
        round(16 - max(0, topic_chars - 34) * 0.045 + max(0, 2 - depth) * 0.65),
        12,
        18,
    )
    width_bonus = min(40.0, importance * 0.45)

    if topic_chars == 0:
        width = MIN_NODE_WIDTH
        lines = 1
    else:
        single_line_w = round(topic_chars * font_size * 0.62 + _HORIZONTAL_PAD + width_bonus)
        width = _clamp(
            single_line_w if single_line_w <= MAX_NODE_WIDTH else math.ceil(single_line_w / 1.72),
            MIN_NODE_WIDTH,
            MAX_NODE_WIDTH,
        )
        cpl = _chars_per_line_for_width(float(width), float(font_size))
        lines = max(1, math.ceil(topic_chars / cpl))

    line_block = lines * font_size * _LINE_HEIGHT_FACTOR
    height = _clamp(
        round(
            _VERTICAL_PAD
            + line_block
            + min(22.0, content_weight * 0.26)
            + max(0, 2 - depth) * 6.0,
        ),
        MIN_NODE_HEIGHT,
        MAX_NODE_HEIGHT,
    )
    return (float(width) / 2.0, float(height) / 2.0)


def node_circumradius(node: NodeTable) -> float:
    """Circle through the pill corners — safe lower bound for center–center distance."""
    hw, hh = node_half_extents(node)
    return math.hypot(hw, hh)


def node_radius(node: NodeTable) -> float:
    """Largest half-axis (legacy name). Prefer `node_half_extents` / `node_circumradius`."""
    hw, hh = node_half_extents(node)
    return max(hw, hh)


def _build_adjacency(
    links: list[NodeLinkTable],
) -> tuple[dict[int, list[int]], dict[int, int]]:
    """parent_id -> [child_id, ...] and child_id -> first parent_id seen."""
    children: dict[int, list[int]] = defaultdict(list)
    parent_of: dict[int, int] = {}
    for lnk in links:
        if lnk.child_id == lnk.parent_id:
            continue
        children[lnk.parent_id].append(lnk.child_id)
        parent_of.setdefault(lnk.child_id, lnk.parent_id)
    return children, parent_of


def find_root(nodes: list[NodeTable], parent_of: dict[int, int]) -> NodeTable | None:
    """Single root invariant: lowest-id node with no incoming link.
    Falls back to lowest-id node overall when the graph has cycles."""
    if not nodes:
        return None
    candidates = [n for n in nodes if n.id not in parent_of]
    if not candidates:
        candidates = list(nodes)
    return min(candidates, key=lambda n: n.id)


# ── Radial layout ────────────────────────────────────────────


def _layout_radial(
    nodes: list[NodeTable],
    children: dict[int, list[int]],
    root: NodeTable,
) -> dict[int, tuple[float, float]]:
    """Concentric rings around root. Each subtree owns an angular sector
    proportional to its size, recursively subdivided down each branch."""
    positions: dict[int, tuple[float, float]] = {root.id: (CANVAS_CX, CANVAS_CY)}

    sizes: dict[int, int] = {}

    def _size(nid: int, seen: set[int]) -> int:
        if nid in sizes:
            return sizes[nid]
        if nid in seen:
            return 1
        seen.add(nid)
        total = 1
        for cid in children.get(nid, []):
            total += _size(cid, seen)
        sizes[nid] = total
        return total

    _size(root.id, set())

    # BFS, allocating angular slices.
    queue: list[tuple[int, float, float, int]] = [(root.id, -math.pi, math.pi, 0)]
    visited: set[int] = {root.id}
    while queue:
        nid, lo, hi, depth = queue.pop(0)
        kids = [c for c in children.get(nid, []) if c not in visited]
        if not kids:
            continue
        total_w = sum(max(1, sizes.get(c, 1)) for c in kids)
        cursor = lo
        # When the sector covers the full circle (only happens at the root with
        # one child) we'd otherwise stack everything at the same angle. Add a
        # tiny offset so siblings don't collapse on top of each other.
        for cid in kids:
            w = max(1, sizes.get(cid, 1))
            slice_span = (hi - lo) * (w / total_w)
            child_angle = cursor + slice_span / 2
            radius = max(RADIAL_MIN_R, (depth + 1) * RADIAL_RING_STEP)
            x = CANVAS_CX + radius * math.cos(child_angle)
            y = CANVAS_CY + radius * math.sin(child_angle)
            positions[cid] = (x, y)
            visited.add(cid)
            queue.append((cid, cursor, cursor + slice_span, depth + 1))
            cursor += slice_span

    return positions


# ── Tree layout (top-down layered) ───────────────────────────


def _layout_tree(
    nodes: list[NodeTable],
    children: dict[int, list[int]],
    root: NodeTable,
) -> dict[int, tuple[float, float]]:
    """Top-down tidy tree. Each subtree is allotted a horizontal slot
    proportional to its leaf count; depth becomes the y row."""
    nodes_by_id = {n.id: n for n in nodes}

    leaves: dict[int, int] = {}

    def _leaves(nid: int, seen: set[int]) -> int:
        if nid in leaves:
            return leaves[nid]
        if nid in seen:
            return 1
        seen.add(nid)
        kids = children.get(nid, [])
        if not kids:
            leaves[nid] = 1
            return 1
        total = sum(_leaves(c, seen) for c in kids)
        leaves[nid] = max(1, total)
        return leaves[nid]

    _leaves(root.id, set())

    # Slot width from widest pill (matches rendered boxes, not disk radius).
    max_full_w = max((node_half_extents(n)[0] * 2 for n in nodes), default=MIN_NODE_WIDTH)
    base_slot = max_full_w + TREE_NODE_GAP

    positions: dict[int, tuple[float, float]] = {}
    # Center the root horizontally by giving it a slot the width of its full
    # subtree, then recurse with that x-range.
    total_width = leaves[root.id] * base_slot
    root_x = CANVAS_CX
    positions[root.id] = (root_x, CANVAS_CY - 200)

    visited: set[int] = {root.id}
    queue: list[tuple[int, float, float, int]] = [
        (root.id, root_x - total_width / 2, root_x + total_width / 2, 0)
    ]
    while queue:
        nid, lo, hi, depth = queue.pop(0)
        kids = [c for c in children.get(nid, []) if c not in visited]
        if not kids:
            continue
        total_l = sum(leaves.get(c, 1) for c in kids)
        cursor = lo
        y = CANVAS_CY - 200 + (depth + 1) * TREE_LAYER_GAP
        for cid in kids:
            l = leaves.get(cid, 1)
            slot = (hi - lo) * (l / total_l)
            cx = cursor + slot / 2
            positions[cid] = (cx, y)
            visited.add(cid)
            queue.append((cid, cursor, cursor + slot, depth + 1))
            cursor += slot
    return positions


# ── Grid layout ──────────────────────────────────────────────


def _layout_grid(
    nodes: list[NodeTable],
    children: dict[int, list[int]],
    root: NodeTable | None,
) -> dict[int, tuple[float, float]]:
    """BFS-from-root order packed into a roughly-square grid."""
    if not nodes:
        return {}
    order: list[int] = []
    seen: set[int] = set()

    if root is not None:
        queue = [root.id]
        while queue:
            nid = queue.pop(0)
            if nid in seen:
                continue
            seen.add(nid)
            order.append(nid)
            for cid in children.get(nid, []):
                queue.append(cid)
    for n in sorted(nodes, key=lambda n: n.id):
        if n.id not in seen:
            order.append(n.id)
            seen.add(n.id)

    # Cell from max pill width/height so grid seed never stacks overlapping boxes.
    max_w = max((node_half_extents(n)[0] * 2 for n in nodes), default=MIN_NODE_WIDTH)
    max_h = max((node_half_extents(n)[1] * 2 for n in nodes), default=MIN_NODE_HEIGHT)
    cell = max(max_w, max_h) + GRID_GAP
    cols = max(3, int(math.sqrt(len(order)) * 1.4))
    rows = math.ceil(len(order) / cols)
    start_x = CANVAS_CX - (cols * cell) / 2 + cell / 2
    start_y = CANVAS_CY - (rows * cell) / 2 + cell / 2
    positions: dict[int, tuple[float, float]] = {}
    for i, nid in enumerate(order):
        col = i % cols
        row = i // cols
        positions[nid] = (start_x + col * cell, start_y + row * cell)
    return positions


# ── Web layout (force-directed) ───────────────────────────────


def _layout_web(
    nodes: list[NodeTable],
    links: list[NodeLinkTable],
    children: dict[int, list[int]],
    root: NodeTable | None,
) -> dict[int, tuple[float, float]]:
    """Springs (links) + repulsion (all node pairs). Seeded from radial so we
    never start tangled. Root stays pinned at centre so the map can't drift."""
    positions = _layout_radial(nodes, children, root) if root else {}
    if not positions:
        return positions

    rng = random.Random(0xC0FFEE)
    for nid in list(positions.keys()):
        x, y = positions[nid]
        positions[nid] = (
            x + rng.uniform(-WEB_RANDOM_JITTER, WEB_RANDOM_JITTER),
            y + rng.uniform(-WEB_RANDOM_JITTER, WEB_RANDOM_JITTER),
        )

    nodes_by_id = {n.id: n for n in nodes}
    radii = {nid: node_circumradius(nodes_by_id[nid]) for nid in positions}
    pinned = {root.id} if root is not None else set()

    for _ in range(WEB_ITERATIONS):
        forces: dict[int, list[float]] = {nid: [0.0, 0.0] for nid in positions}

        # Spring along every link (uses cross-links too — that's the whole
        # point of "web").
        for lnk in links:
            if lnk.parent_id not in positions or lnk.child_id not in positions:
                continue
            x1, y1 = positions[lnk.parent_id]
            x2, y2 = positions[lnk.child_id]
            dx, dy = x2 - x1, y2 - y1
            dist = math.hypot(dx, dy) or 1e-6
            stretch = (dist - WEB_TARGET_LINK_LEN) * WEB_SPRING_K
            fx, fy = (dx / dist) * stretch, (dy / dist) * stretch
            forces[lnk.parent_id][0] += fx
            forces[lnk.parent_id][1] += fy
            forces[lnk.child_id][0] -= fx
            forces[lnk.child_id][1] -= fy

        # Pairwise repulsion sized to actual radii so larger nodes claim space.
        ids = list(positions.keys())
        for i in range(len(ids)):
            a = ids[i]
            ax, ay = positions[a]
            ra = radii[a]
            for j in range(i + 1, len(ids)):
                b = ids[j]
                bx, by = positions[b]
                dx, dy = bx - ax, by - ay
                dist = math.hypot(dx, dy) or 1e-6
                min_d = ra + radii[b] + NODE_EDGE_PAD * 1.5
                if dist < min_d * 1.35:
                    push = ((min_d * 1.35 - dist) / dist) * WEB_REPULSION_K
                    fx, fy = dx * push, dy * push
                    forces[a][0] -= fx
                    forces[a][1] -= fy
                    forces[b][0] += fx
                    forces[b][1] += fy

        for nid, (fx, fy) in forces.items():
            if nid in pinned:
                continue
            x, y = positions[nid]
            positions[nid] = (x + fx, y + fy)

    return positions


# ── Overlap resolution (always last step) ─────────────────────


def _resolve_overlaps(
    positions: dict[int, tuple[float, float]],
    nodes_by_id: dict[int, NodeTable],
    *,
    fixed_ids: tuple[int, ...] = (),
    iterations: int = 900,
) -> None:
    """Push overlapping node *pills* apart using the same AABB as the frontend.

    Uses axis-aligned boxes from `node_half_extents` + `NODE_EDGE_PAD`.
    Fixed nodes (e.g. root in radial/web) never move; they only push others.
    """
    fixed = set(fixed_ids)
    ids = [nid for nid in positions.keys() if nid in nodes_by_id]
    if len(ids) < 2:
        return

    half: dict[int, tuple[float, float]] = {}
    _fudge = 2.0  # breathing room vs browser text metrics / float jitter
    for nid in ids:
        hw, hh = node_half_extents(nodes_by_id[nid])
        half[nid] = (hw + _fudge, hh + _fudge)
    pad = NODE_EDGE_PAD

    for _ in range(iterations):
        any_moved = False
        for i in range(len(ids)):
            a = ids[i]
            ax, ay = positions[a]
            hwa, hha = half[a]
            for j in range(i + 1, len(ids)):
                b = ids[j]
                bx, by = positions[b]
                hwb, hhb = half[b]
                dx = bx - ax
                dy = by - ay
                sum_w = hwa + hwb + pad
                sum_h = hha + hhb + pad
                overlap_x = sum_w - abs(dx)
                overlap_y = sum_h - abs(dy)
                if overlap_x <= 0 or overlap_y <= 0:
                    continue

                # Separate along the shallower penetration axis (MTV for AABB).
                if overlap_x <= overlap_y:
                    sep = overlap_x
                    if abs(dx) < 1e-6:
                        sign = 1.0 if (a + j) % 2 == 0 else -1.0
                    else:
                        sign = 1.0 if dx > 0 else -1.0
                    mx = sign * sep / 2.0
                    my = 0.0
                else:
                    sep = overlap_y
                    if abs(dy) < 1e-6:
                        sign = 1.0 if (a + i) % 2 == 0 else -1.0
                    else:
                        sign = 1.0 if dy > 0 else -1.0
                    mx = 0.0
                    my = sign * sep / 2.0

                a_fixed = a in fixed
                b_fixed = b in fixed
                if a_fixed and b_fixed:
                    continue
                if a_fixed:
                    positions[b] = (bx + mx * 2, by + my * 2)
                elif b_fixed:
                    positions[a] = (ax - mx * 2, ay - my * 2)
                else:
                    positions[a] = (ax - mx, ay - my)
                    positions[b] = (bx + mx, by + my)
                ax, ay = positions[a]
                any_moved = True
        if not any_moved:
            return


# ── Public API ────────────────────────────────────────────────


def compute_layout(
    nodes: list[NodeTable],
    links: list[NodeLinkTable],
    *,
    mode: str = DEFAULT_LAYOUT,
) -> dict[int, tuple[float, float]]:
    """Return final (x, y) for every node. Pure: no DB, no side effects."""
    if not nodes:
        return {}
    children, parent_of = _build_adjacency(links)
    root = find_root(nodes, parent_of)
    nodes_by_id = {n.id: n for n in nodes}
    mode = mode if mode in LAYOUT_MODES else DEFAULT_LAYOUT

    if root is None:
        positions: dict[int, tuple[float, float]] = {}
    elif mode == "tree":
        positions = _layout_tree(nodes, children, root)
    elif mode == "grid":
        positions = _layout_grid(nodes, children, root)
    elif mode == "web":
        positions = _layout_web(nodes, links, children, root)
    else:  # radial / fallback
        positions = _layout_radial(nodes, children, root)

    # Detached nodes (not reachable from root) get a fallback ring far out so
    # they're discoverable by Fit View but can't overlap the main tree.
    missing = [n for n in nodes if n.id not in positions]
    if missing:
        outer_r = max(2000, RADIAL_RING_STEP * 5)
        for i, n in enumerate(missing):
            angle = (i / max(1, len(missing))) * 2 * math.pi
            positions[n.id] = (
                CANVAS_CX + outer_r * math.cos(angle),
                CANVAS_CY + outer_r * math.sin(angle),
            )

    # Pin the root only for layouts where it owns a meaningful anchor point.
    # For tree / grid we let it shift slightly during overlap resolution so
    # very large root labels don't cascade errors through the whole layout.
    fixed = (root.id,) if root is not None and mode in ("radial", "web") else ()
    _resolve_overlaps(positions, nodes_by_id, fixed_ids=fixed, iterations=900)
    # Snap once to the frontend grid, relax, then snap again and relax — but
    # never apply a *third* snap after the last relax (that was re-opening 1–4px
    # penetrations on very flat, wide pills).
    for nid in positions:
        x, y = positions[nid]
        positions[nid] = (_snap(x), _snap(y))
    _resolve_overlaps(positions, nodes_by_id, fixed_ids=fixed, iterations=450)
    for nid in positions:
        x, y = positions[nid]
        positions[nid] = (_snap(x), _snap(y))
    _resolve_overlaps(positions, nodes_by_id, fixed_ids=fixed, iterations=350)
    return dict(positions)


def apply_layout(
    db: Session,
    session_id: int,
    *,
    mode: str | None = None,
) -> list[tuple[int, float, float]]:
    """Recompute layout for the whole session and persist. Returns the moved nodes
    as `(node_id, new_x, new_y)`. Caller is responsible for emitting SSE events
    and for `db.commit()`. When `mode` is None the session's stored
    `layout_mode` wins (fallback: DEFAULT_LAYOUT)."""
    from services import graph_service, message_service  # local to avoid cycles

    graph = graph_service.get_full_graph(db, session_id)
    nodes: list[NodeTable] = graph["nodes"]
    links: list[NodeLinkTable] = graph["links"]
    if not nodes:
        return []

    if mode is None:
        sess = message_service.get_session_row(db, session_id)
        mode = getattr(sess, "layout_mode", None) or DEFAULT_LAYOUT
    chosen = mode if mode in LAYOUT_MODES else DEFAULT_LAYOUT
    positions = compute_layout(nodes, links, mode=chosen)

    moved: list[tuple[int, float, float]] = []
    for n in nodes:
        target = positions.get(n.id)
        if target is None:
            continue
        x, y = float(target[0]), float(target[1])
        if abs(float(n.position_x) - x) > 0.5 or abs(float(n.position_y) - y) > 0.5:
            n.position_x = x
            n.position_y = y
            n.original_position_x = x
            n.original_position_y = y
            moved.append((n.id, x, y))

    if moved:
        graph_service.touch_session(db, session_id)
    logger.info("apply_layout session=%d mode=%s moved=%d/%d", session_id, chosen, len(moved), len(nodes))
    return moved
