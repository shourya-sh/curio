import type { LinkOut, NodeOut } from './api'
import { CANVAS_H, CANVAS_W } from './canvasConstants'
import { snapCoord } from './canvasConstants'

const BODY_GAP = 116
const LAYER_GAP = 280

/**
 * Quick seed position for a newly streamed node before the agent's layout
 * pass arrives. No BFS, no clamps — just parent + sibling-count offset.
 * The backend's `layout_engine.apply_layout()` produces the final canonical
 * positions a moment later via `node_updated` SSE events.
 */
export function seedNodePosition(
  parentId: number | null | undefined,
  nodes: NodeOut[],
  links: LinkOut[],
): { x: number; y: number } {
  if (!parentId) return { x: CANVAS_W / 2, y: CANVAS_H / 2 }
  const parent = nodes.find((n) => n.id === parentId)
  if (!parent) return { x: CANVAS_W / 2, y: CANVAS_H / 2 }
  const siblingCount = links.filter((l) => l.parent_id === parentId).length
  return {
    x: snapCoord(parent.position_x + LAYER_GAP),
    y: snapCoord(parent.position_y + BODY_GAP * siblingCount),
  }
}
