import type { NodeBulkItem } from './api'
import type { NodeOut } from './api'
import { CANVAS_H, CANVAS_W } from './canvasConstants'
import { snapCoord } from './canvasConstants'

const POS_EPS = 0.03

function sameStackedPosition(a: NodeOut, b: NodeOut): boolean {
  return Math.abs(a.position_x - b.position_x) < POS_EPS && Math.abs(a.position_y - b.position_y) < POS_EPS
}

/**
 * Only fix true stacks: multiple nodes sharing the exact same coordinates,
 * or a single node still at the origin. Does NOT group nearby rounded coordinates
 * (that was causing nodes to jump apart after every save).
 */
export function layoutStackedNodes(nodes: NodeOut[]): NodeBulkItem[] {
  if (nodes.length === 0) return []

  const centerX = CANVAS_W / 2
  const centerY = CANVAS_H / 2

  const atOrigin = nodes.filter((n) => Math.hypot(n.position_x, n.position_y) < 0.75)
  if (atOrigin.length >= 2) {
    const out: NodeBulkItem[] = []
    const count = atOrigin.length
    const r = Math.min(160, 48 + count * 28)
    for (let i = 0; i < count; i++) {
      const angle = (2 * Math.PI * i) / count - Math.PI / 2
      const x = centerX + r * Math.cos(angle)
      const y = centerY + r * Math.sin(angle)
      out.push({
        id: atOrigin[i]!.id,
        position_x: snapCoord(Math.max(24, Math.min(CANVAS_W - 24, x))),
        position_y: snapCoord(Math.max(24, Math.min(CANVAS_H - 24, y))),
      })
    }
    return out
  }
  if (atOrigin.length === 1) {
    return [{ id: atOrigin[0]!.id, position_x: centerX, position_y: centerY }]
  }

  const used = new Set<number>()
  const out: NodeBulkItem[] = []

  for (const n of nodes) {
    if (used.has(n.id)) continue
    const stack = nodes.filter((m) => !used.has(m.id) && sameStackedPosition(m, n))
    stack.forEach((s) => used.add(s.id))
    if (stack.length < 2) continue

    const cx = n.position_x
    const cy = n.position_y
    const count = stack.length
    const r = Math.min(120, 40 + count * 22)
    for (let i = 0; i < count; i++) {
      const angle = (2 * Math.PI * i) / count - Math.PI / 2
      const x = cx + r * Math.cos(angle)
      const y = cy + r * Math.sin(angle)
      out.push({
        id: stack[i]!.id,
        position_x: snapCoord(Math.max(24, Math.min(CANVAS_W - 24, x))),
        position_y: snapCoord(Math.max(24, Math.min(CANVAS_H - 24, y))),
      })
    }
  }

  return out
}
