import type { LinkOut, NodeOut } from './api'
import { CANVAS_H, CANVAS_W } from './canvasConstants'
import { snapCoord } from './canvasConstants'

const BODY_GAP = 116
const LAYER_GAP = 280
const EDGE_MARGIN = 120

/**
 * Quick seed position for a newly streamed node.
 * No BFS — just parent lookup + child count for offset.
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
    x: snapCoord(Math.min(CANVAS_W - EDGE_MARGIN, parent.position_x + LAYER_GAP)),
    y: snapCoord(Math.max(EDGE_MARGIN, Math.min(CANVAS_H - EDGE_MARGIN, parent.position_y + BODY_GAP * siblingCount))),
  }
}
