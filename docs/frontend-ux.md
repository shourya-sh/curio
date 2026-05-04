# Frontend UX — Canvas Interaction & Animation

## Canvas Interaction Model

### Selection & Navigation
- **Click node** → selects it (blue highlight ring), opens style popover
- **Click background** → deselects all
- **Double-click node** → opens detail panel in nodes sidebar
- **Scroll wheel** → zoom in/out (centered on cursor)
- **Pan tool** (toggle button or hold Space) → drag to pan canvas
- **Fit button** → resets zoom/pan to show all nodes, restores canonical positions

### Drag & Drop
- **Drag node** → moves it in canvas coordinates
- Dragged nodes have `mm-orb--dragging` class (disables all transitions for instant tracking)
- `onDragEnd` persists new position via `applyTrackedNodePatch`
- Negative IDs (temp optimistic nodes) skip persistence

### Connect Mode
- **Connect button** → enables wire drawing mode
- Drag from source node to target node → creates link
- Visual feedback: source gets `mm-orb--wire-from` outline, targets get `mm-orb--wire-target` glow
- Draft wire rendered as Bezier SVG path (`mm-edge--draft`)

### Place Node Mode
- **Add button** → enables node placement mode
- Click+drag on canvas → draw circle for new manual node
- Preview circle shown via SVG (`mm-place-preview`)

## Node Rendering

### Positioning
- Nodes use **absolute positioning** with `left` and `top` in pixel coordinates
- `transform: translate(-50%, -50%)` centers the node on its position point
- Canvas is a fixed-size virtual space (`CANVAS_W` x `CANVAS_H`)
- Viewport div applies `translate(x, y) scale(s)` for pan/zoom

### Sizing
- Node dimensions computed by `readNodeBoxPx(node)` based on topic text length
- Manual nodes (with `subtopics.radiusPx`) use aspect-ratio: 1 for circles
- Font size and line count set via CSS custom properties `--mm-orb-font-size`, `--mm-orb-lines`

### CSS Custom Property Transitions
- `--mm-pos-duration` controls position transition speed (default: `0s` = instant)
- `.mm-canvas__viewport--animating` sets `--mm-pos-duration: 0.45s` for smooth glides
- `.mm-orb--dragging` forces `--mm-pos-duration: 0s` (overrides animating)

## Layout System

### Signature-Based Trigger
- A `useEffect` computes a string signature from all node IDs, topics, depths, positions, and link pairs
- Layout only runs when signature changes (prevents redundant computation)
- Guarded with `if (streaming) return` during AI streaming

### Layered Hierarchy Algorithm (`graphLayout.ts`)
1. **Root detection**: nodes with no parents, sorted by depth then ID
2. **BFS layer assignment**: each node gets a layer (column) number
3. **Column centers**: spaced by `LAYER_GAP` (280px) horizontally
4. **Vertical stacking**: nodes within a column stacked with `BODY_GAP` (116px)
5. **Overlap resolution**: iterative repulsion (90 iterations max)
6. **Edge clamping**: positions clamped to keep nodes within canvas bounds

### Streaming Incremental Layout
During AI streaming, layout is handled differently:
1. **Seed**: `seedNodePosition()` — places new node one `LAYER_GAP` right of parent
2. **Debounced relayout**: `scheduleStreamingLayout()` — 50ms debounce, runs `layoutReadableGraphLocal()`
3. **Local-only**: positions updated in react-query cache, no API calls during streaming
4. **Final pass**: after stream ends, full `layoutReadableGraph()` + `bulkUpdateNodes` persists

## Detail Panel

### Read Mode
- Summary, details, and subtopics displayed as text
- Click any text → switches to edit mode

### Edit Mode
- Text fields: `<textarea>` with auto-focus
- Blur or Enter (without Shift) saves via `applyTrackedNodePatch`
- Escape cancels edit
- Subtopics: one item per line in textarea, saved as `string[]`
- Edit state resets when panel node changes (`useEffect` on `panelNodeId`/`selectedId`)

### History Integration
- All edits go through `applyTrackedNodePatch` which feeds into undo/redo history
- Ctrl+Z / Ctrl+Shift+Z to undo/redo

## SSE Streaming Flow

```
SSE event arrives
    |
    v
consumePromptStreamEvent()
    |
    +-- node_created → seed position if (0,0) → addNodeDeterministic → track in streamingNodeIdsRef → scheduleStreamingLayout
    +-- link_created → addLinkDeterministic → track in streamingLinkIdsRef → scheduleStreamingLayout
    +-- tool_used → display in chat panel
    +-- message_created → display in chat panel
    +-- sources_created → update sources list
    +-- done → (handled by runSessionPrompt after stream resolves)
    +-- error → show error banner
    |
    v
After stream completes (runSessionPrompt):
    → Final layoutReadableGraph + bulkUpdateNodes
    → fitContentNonce bump (fit view)
    → animatePositions = true for 600ms
    → Clear streaming ID sets
```

## Animation Timing

| Element | CSS Class | Duration | Trigger |
|---------|-----------|----------|---------|
| New node fade-in | `mm-orb--streaming-in` | 350ms | Node ID in `streamingNodeIds` |
| Node position glide | `--mm-pos-duration` via `mm-canvas__viewport--animating` | 450ms | `animatePositions` prop |
| Edge draw-in | `mm-edge--new` | 500ms | Link ID in `newLinkIds` |
| Dragged node | `mm-orb--dragging` | 0ms (instant) | Active drag state |
| Transitions off | — | — | 600ms after stream ends (`animatePositions` → false) |

## MindMapCanvas Props

| Prop | Type | Purpose |
|------|------|---------|
| `nodes` | `NodeOut[]` | All nodes to render |
| `links` | `LinkOut[]` | All links to render |
| `selectedId` | `number \| null` | Currently selected node |
| `connectMode` | `boolean` | Wire drawing mode active |
| `placeNodeMode` | `boolean` | Node placement mode active |
| `onSelect` | `(id) => void` | Node selection callback |
| `onHoverNode` | `(id) => void` | Node hover callback |
| `onDragEnd` | `(id, x, y) => void` | Drag completion callback |
| `onConnectWire` | `(from, to) => void` | Wire completion callback |
| `onPlaceNodeComplete` | `(cx, cy, r) => void` | Node placement callback |
| `pendingPosition` | `Map<id, {x,y}>` | Optimistic drag positions |
| `selectedLinkId` | `number \| null` | Selected link for style editing |
| `onSelectLink` | `(id, pos) => void` | Link selection callback |
| `fitContentNonce` | `number` | Increment to trigger fit-to-content |
| `onFitView` | `() => void` | Custom fit view handler |
| `animatePositions` | `boolean` | Enable CSS position transitions |
| `streamingNodeIds` | `Set<number>` | Node IDs with fade-in animation |
| `newLinkIds` | `Set<number>` | Link IDs with draw-in animation |
