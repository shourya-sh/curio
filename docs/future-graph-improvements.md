# Future Graph Improvements

Tracking ideas for making the mind map more intelligent — better layouts, cross-links, richer structures. None of this is implemented yet. Current state: basic radial arc repositioning, no cross-linking logic.

---

## 1. Repositioning Overhaul

### Current State
- `reposition_children(parent)` places children in a radial arc around parent
- `reorganize_all()` walks parents top-down and calls `reposition_children` for each
- No awareness of grandchildren, overlapping subtrees, or canvas space usage
- Shape is always radial — no tree/linear option

### Improvements

**A. Force-Directed Layout (for web/radial maps)**
- Use a physics simulation: nodes repel each other, links act as springs
- Libraries to consider: implement a simple Fruchterman-Reingold in Python, or use `networkx.spring_layout` server-side
- Better for organic-looking webs where everything connects to everything
- Run for N iterations, snap to grid, clamp to canvas bounds
- Could run client-side too (d3-force) for real-time drag feedback

**B. Tree Layout (for hierarchical maps)**
- Layered/Sugiyama-style: root at top, children below, spread horizontally
- Use `dagre` (JS) or implement Buchheim tree layout in Python
- Better for plans, org charts, step-by-step flows
- Store `layout_shape` on the session table (`"radial"` | `"tree"` | `"horizontal_tree"`)
- User toggles between shapes via a button

**C. Incremental Repositioning**
- Current: reposition ALL children of a parent every time
- Better: only reposition NEW children, slot them into gaps between existing ones
- Respect "pinned" nodes (user manually dragged → `position_x != original_position_x`)
- Pinned nodes act as fixed anchors in the layout algorithm

**D. Subtree-Aware Spacing**
- Before placing a child, estimate how much space its subtree needs
- Wider subtrees get more angular/vertical space
- Prevents overlapping branches as the map grows deep

---

## 2. Intricate Webs / Cross-Linking

### Current State
- All links are parent→child (tree structure)
- `create_link` tool exists but Context Agent rarely uses it for cross-links
- No agent logic to discover connections between branches

### Improvements

**A. Cross-Link Discovery Agent**
- After the main expansion is done, run a lightweight pass:
  - Input: all node topics + summaries in the graph
  - Output: suggested cross-links between nodes in different branches
  - e.g., "Quantum Computing → Cryptography" if both exist in separate branches
- Could be a tool on Context Agent: `discover_cross_links()` — 1 Gemini call, returns pairs
- Each cross-link gets an `edge_kind` (supporting, prerequisite, related) and visual style (dashed, dotted)

**B. Bidirectional Links**
- Current links are directional (parent→child)
- For cross-links, "direction" is less meaningful — they're associations
- Could add a `bidirectional: bool` field to `node_links` table
- Frontend renders bidirectional links with no arrowhead (or double arrowhead)

**C. Link Labels**
- Add `label` field to `node_links` table
- Cross-links show the relationship: "enables", "contradicts", "depends on", "similar to"
- Context Agent or Research Agent fills these in

**D. Cluster Detection**
- After building a large graph, detect natural clusters (groups of tightly connected nodes)
- Visual treatment: subtle background color behind cluster, or a group label
- Algorithm: simple community detection (Louvain, label propagation) on the adjacency matrix
- Could be a `detect_clusters()` tool on Context Agent

---

## 3. Smarter Node Creation

### Current State
- Research Agent fills ALL children in one Gemini call
- No verification that content is accurate or non-redundant
- No awareness of what already exists in the graph (only parent context)

### Improvements

**A. Deduplication Check**
- Before creating nodes, compare proposed topics against existing graph
- If "Quantum Computing" already exists as a node, don't create a duplicate
- Simple: fuzzy string match on topics. Better: embedding similarity.

**B. Depth-Aware Detail Level**
- Depth 0-1: broad overview (current behavior)
- Depth 2-3: more specific, narrower focus
- Depth 4+: very specific, could include formulas, code snippets, exact specifications
- Pass depth to Research Agent prompt so it adjusts detail level

**C. Web Search Integration**
- Add a `search_web(query)` tool to Research Agent
- Before filling details, search for real information
- Cite actual URLs instead of hallucinated sources
- Could use Google Custom Search API, Brave Search API, or Tavily

**D. Source Verification**
- After Research Agent returns sources, verify URLs are real (HEAD request)
- Flag or remove sources with dead links
- Could be a post-processing step, not an agent

---

## 4. Layout Shapes Reference

| Shape | Best For | Algorithm |
|-------|----------|-----------|
| Radial/Web | Research exploration, brainstorming | Force-directed or radial tree |
| Top-Down Tree | Hierarchical breakdowns, taxonomies | Buchheim / dagre |
| Horizontal Tree | Timelines, sequential processes | Same as tree, rotated 90deg |
| Mind Map (classic) | Balanced exploration from center | Radial tree with alternating L/R |

Store as `layout_shape` on `sessions` table. Default: `"radial"`. User can switch via toolbar button. Repositioner reads shape and uses the corresponding algorithm.

---

## 5. Implementation Priority

1. **Force-directed layout** — biggest visual improvement, makes dense graphs readable
2. **Cross-link discovery** — makes the "web" in mind map actually work
3. **Layout shape toggle** — radial vs tree, simple UI button
4. **Pinned nodes** — respect user-placed nodes during reposition
5. **Web search** — real sources instead of hallucinated ones
6. **Link labels** — makes cross-links meaningful
7. **Cluster detection** — nice-to-have for large graphs
8. **Depth-aware details** — improves content quality at deep levels
