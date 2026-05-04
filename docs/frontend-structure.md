# Frontend Structure

## Pages
- `LandingPage` — public landing
- `LoginPage` / `SignupPage` — auth forms (PublicOnlyRoute)
- `DashboardHomePage` — main dashboard with session creation
- `LibraryPage` — session list/management
- `WorkspaceCanvasPage` — mind map canvas with AI streaming
- `SettingsPage` — profile, API keys, account deletion

## Components
- `AppTopBar` — top navigation with brand, nav links, settings gear, account avatar/menu
- `MindMapCanvas` — canvas renderer with absolute-positioned node orbs and SVG edges
  - Props: `animatePositions`, `streamingNodeIds`, `newLinkIds` for streaming animation
- `DecorativePageBackground` — animated background for dashboard/library

## Lib
- `api.ts` — HTTP client for all backend endpoints
- `supabase.ts` — Supabase client initialization
- `AuthContext.tsx` — auth provider with `useAuth()` hook
- `profile.ts` — profile API (get/update/delete)
- `queryClient.ts` — React Query client and query key constants
- `graphLayout.ts` — layout engine for node positioning
  - `layoutReadableGraph()` — full layered layout, returns `NodeBulkItem[]` for API persistence
  - `layoutReadableGraphLocal()` — same algorithm, returns `Map<id, {x,y}>` for in-memory streaming layout
  - `seedNodePosition()` — quick parent-relative position for newly streamed nodes (no BFS)
  - `layoutStackedNodes()` — unstacks overlapping nodes at same coordinates
- `nodeDisplay.ts` — node box sizing (`readNodeBoxPx`)
- `nodeOrbStyle.ts` — color/gradient computation for node orbs
- `manualGraph.ts` — payload builders for manual node/link creation
- `canvasConstants.ts` — `CANVAS_W`, `CANVAS_H`, `snapCoord`

## Styling
- Single `index.css` with section comments
- No CSS modules or CSS-in-JS
- Design: clean, minimal, indigo/slate color palette
- CSS custom property `--mm-pos-duration` controls node position transition speed

## Data Fetching
- `@tanstack/react-query` for queries and mutations
- Optimistic updates for manual node/link creation (temp negative IDs)
- SSE streaming for AI responses (manual fetch + ReadableStream)

## Streaming Animation System

During AI streaming, nodes appear one at a time via SSE:

1. **Seed position**: `seedNodePosition()` places new nodes near their parent
2. **Incremental layout**: `scheduleStreamingLayout()` (50ms debounce) runs `layoutReadableGraphLocal()` to recompute positions in-memory
3. **CSS transitions**: `.mm-canvas__viewport--animating` enables `--mm-pos-duration: 0.45s` for smooth glides
4. **Fade-in**: `.mm-orb--streaming-in` applies a 350ms scale+opacity animation
5. **Edge draw-in**: `.mm-edge--new` applies a 500ms stroke-dashoffset animation
6. **Final layout**: After stream completes, full `layoutReadableGraph()` + `bulkUpdateNodes` persists positions

The signature-based layout `useEffect` is guarded with `if (streaming) return` to avoid conflicting with the debounced streaming layout.

## Node Detail Editing

The detail panel supports click-to-edit for summary, details, and subtopics:

- Click any text field → textarea appears (auto-focused)
- Blur or Enter saves via `applyTrackedNodePatch()` → optimistic cache update + undo/redo
- Escape cancels without saving
- Subtopics: "Edit" button next to heading → textarea with one item per line
- Only shows edit button for array subtopics (not `{ radiusPx }` manual nodes)

## Optimistic Manual Creates

Manual node/link creation is optimistic:

1. Temp node/link created with `id = -(Date.now())`
2. Added to react-query cache immediately
3. API call fires in background
4. On success: temp ID swapped for real DB ID
5. On failure: temp item removed from cache, error shown
6. `onDragEnd` guards against persisting negative IDs
