import type { NodeOut } from './api'
import { readNodeBoxPx } from './nodeDisplay'

const HULL_EXTRA_X = 52
const HULL_EXTRA_Y = 52
const SEP = 10
const ITERS = 14

type Rect = { cx: number; cy: number; hw: number; hh: number }

function rectFor(node: NodeOut, x: number, y: number): Rect {
  const b = readNodeBoxPx(node)
  return { cx: x, cy: y, hw: b.width / 2, hh: b.height / 2 }
}

function overlapMtv(a: Rect, b: Rect): { mx: number; my: number; pen: number } | null {
  const dx = b.cx - a.cx
  const dy = b.cy - a.cy
  const overlapX = a.hw + b.hw - Math.abs(dx)
  const overlapY = a.hh + b.hh - Math.abs(dy)
  if (overlapX <= 0 || overlapY <= 0) return null
  if (overlapX < overlapY) {
    const sign = dx >= 0 ? 1 : -1
    return { mx: sign * (overlapX + SEP), my: 0, pen: overlapX }
  }
  const sign = dy >= 0 ? 1 : -1
  return { mx: 0, my: sign * (overlapY + SEP), pen: overlapY }
}

/**
 * Transient pixel offsets in canvas space so other nodes clear the hovered node's orbit hull.
 */
export function computeOrbitClearanceOffsets(
  anchorId: number,
  nodes: NodeOut[],
  getBase: (id: number) => { x: number; y: number },
): Map<number, { dx: number; dy: number }> {
  const anchor = nodes.find((n) => n.id === anchorId)
  if (!anchor) return new Map()

  const p0 = getBase(anchorId)
  const b0 = readNodeBoxPx(anchor)
  const hull: Rect = {
    cx: p0.x,
    cy: p0.y,
    hw: b0.width / 2 + HULL_EXTRA_X,
    hh: b0.height / 2 + HULL_EXTRA_Y,
  }

  const offsets = new Map<number, { dx: number; dy: number }>()

  const center = (id: number) => {
    const p = getBase(id)
    const o = offsets.get(id) ?? { dx: 0, dy: 0 }
    return { x: p.x + o.dx, y: p.y + o.dy }
  }

  for (let iter = 0; iter < ITERS; iter++) {
    for (const n of nodes) {
      if (n.id === anchorId) continue
      const c = center(n.id)
      const r = rectFor(n, c.x, c.y)
      const mtv = overlapMtv(hull, r)
      if (!mtv) continue
      const cur = offsets.get(n.id) ?? { dx: 0, dy: 0 }
      offsets.set(n.id, { dx: cur.dx + mtv.mx, dy: cur.dy + mtv.my })
    }
    for (const a of nodes) {
      if (a.id === anchorId) continue
      const ca = center(a.id)
      const ra = rectFor(a, ca.x, ca.y)
      for (const b of nodes) {
        if (b.id <= a.id || b.id === anchorId) continue
        const cb = center(b.id)
        const rb = rectFor(b, cb.x, cb.y)
        const mtv = overlapMtv(ra, rb)
        if (!mtv) continue
        const pushA = offsets.get(a.id) ?? { dx: 0, dy: 0 }
        const pushB = offsets.get(b.id) ?? { dx: 0, dy: 0 }
        offsets.set(a.id, { dx: pushA.dx - mtv.mx * 0.5, dy: pushA.dy - mtv.my * 0.5 })
        offsets.set(b.id, { dx: pushB.dx + mtv.mx * 0.5, dy: pushB.dy + mtv.my * 0.5 })
      }
    }
  }

  return offsets
}
