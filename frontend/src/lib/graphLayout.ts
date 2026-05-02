import type { LinkOut, NodeBulkItem, NodeOut } from './api'
import { CANVAS_H, CANVAS_W } from './canvasConstants'
import { snapCoord } from './canvasConstants'
import { readNodeBoxPx } from './nodeDisplay'

const POS_EPS = 0.03
const BODY_GAP = 30
const EDGE_MARGIN = 36

function sameStackedPosition(a: NodeOut, b: NodeOut): boolean {
  return Math.abs(a.position_x - b.position_x) < POS_EPS && Math.abs(a.position_y - b.position_y) < POS_EPS
}

type LayoutNode = {
  node: NodeOut
  width: number
  height: number
  x: number
  y: number
  layer: number
  order: number
}

function closeEnough(a: number | undefined, b: number | undefined, eps = 1.5): boolean {
  if (a == null || b == null) return false
  return Math.abs(a - b) <= eps
}

function currentTracksOriginal(node: NodeOut): boolean {
  const ox = node.original_position_x ?? node.position_x
  const oy = node.original_position_y ?? node.position_y
  return closeEnough(node.position_x, ox) && closeEnough(node.position_y, oy)
}

function clampCenter(value: number, half: number, max: number): number {
  return snapCoord(Math.max(half + EDGE_MARGIN, Math.min(max - half - EDGE_MARGIN, value)))
}

function rootAndLayerOrder(nodes: NodeOut[], links: LinkOut[]) {
  const byId = new Map(nodes.map((node) => [node.id, node]))
  const children = new Map<number, number[]>()
  const parents = new Map<number, number[]>()
  for (const link of links) {
    if (!byId.has(link.parent_id) || !byId.has(link.child_id)) continue
    children.set(link.parent_id, [...(children.get(link.parent_id) ?? []), link.child_id])
    parents.set(link.child_id, [...(parents.get(link.child_id) ?? []), link.parent_id])
  }

  const roots = nodes
    .filter((node) => !(parents.get(node.id)?.length))
    .sort((a, b) => a.depth - b.depth || a.id - b.id)
  if (!roots.length && nodes[0]) roots.push(nodes[0])

  const layer = new Map<number, number>()
  const order = new Map<number, number>()
  const seen = new Set<number>()
  let cursor = 0

  const visit = (nodeId: number, depth: number) => {
    if (seen.has(nodeId)) return
    const node = byId.get(nodeId)
    if (!node) return
    seen.add(nodeId)
    layer.set(nodeId, Math.max(0, depth))
    order.set(nodeId, cursor++)
    ;(children.get(nodeId) ?? [])
      .map((id) => byId.get(id))
      .filter((item): item is NodeOut => Boolean(item))
      .sort((a, b) => a.depth - b.depth || a.id - b.id)
      .forEach((child) => visit(child.id, depth + 1))
  }

  roots.forEach((root) => visit(root.id, Math.max(0, root.depth)))
  nodes
    .filter((node) => !seen.has(node.id))
    .sort((a, b) => a.depth - b.depth || a.id - b.id)
    .forEach((node) => visit(node.id, Math.max(0, node.depth)))

  return { layer, order }
}

function resolveBodyOverlaps(items: LayoutNode[]): void {
  for (let iter = 0; iter < 90; iter++) {
    let moved = false
    for (let i = 0; i < items.length; i++) {
      for (let j = i + 1; j < items.length; j++) {
        const a = items[i]!
        const b = items[j]!
        const needX = (a.width + b.width) / 2 + BODY_GAP
        const needY = (a.height + b.height) / 2 + BODY_GAP
        const dx = b.x - a.x
        const dy = b.y - a.y
        const overlapX = needX - Math.abs(dx)
        const overlapY = needY - Math.abs(dy)
        if (overlapX <= 0 || overlapY <= 0) continue

        if (a.layer === b.layer || overlapY <= overlapX) {
          const dir = dy === 0 ? (a.order <= b.order ? 1 : -1) : Math.sign(dy)
          const push = overlapY / 2 + 2
          a.y = clampCenter(a.y - dir * push, a.height / 2, CANVAS_H)
          b.y = clampCenter(b.y + dir * push, b.height / 2, CANVAS_H)
        } else {
          const dir = dx === 0 ? (a.layer <= b.layer ? 1 : -1) : Math.sign(dx)
          const push = overlapX / 2 + 2
          a.x = clampCenter(a.x - dir * push, a.width / 2, CANVAS_W)
          b.x = clampCenter(b.x + dir * push, b.width / 2, CANVAS_W)
        }
        moved = true
      }
    }
    if (!moved) break
  }
}

/**
 * Build a readable layered map from the actual node body sizes. The returned
 * patch updates canonical positions for all AI-layout nodes, but leaves manually
 * dragged current positions alone unless they still track their canonical origin.
 */
export function layoutReadableGraph(nodes: NodeOut[], links: LinkOut[]): NodeBulkItem[] {
  if (nodes.length === 0) return []

  const { layer, order } = rootAndLayerOrder(nodes, links)
  const maxLayer = Math.max(0, ...nodes.map((node) => layer.get(node.id) ?? Math.max(0, node.depth)))
  const layerCount = maxLayer + 1
  const columns = Math.max(1, layerCount)

  const items: LayoutNode[] = nodes.map((node) => {
    const box = readNodeBoxPx(node)
    const l = layer.get(node.id) ?? Math.max(0, node.depth)
    const x =
      columns === 1
        ? CANVAS_W / 2
        : EDGE_MARGIN + box.width / 2 + ((CANVAS_W - EDGE_MARGIN * 2 - box.width) * l) / Math.max(1, columns - 1)
    return {
      node,
      width: box.width,
      height: box.height,
      x: clampCenter(x, box.width / 2, CANVAS_W),
      y: CANVAS_H / 2,
      layer: l,
      order: order.get(node.id) ?? node.id,
    }
  })

  for (let l = 0; l <= maxLayer; l++) {
    const col = items.filter((item) => item.layer === l).sort((a, b) => a.order - b.order)
    if (!col.length) continue
    const totalHeight = col.reduce((sum, item) => sum + item.height, 0) + BODY_GAP * (col.length - 1)
    let y = Math.max(EDGE_MARGIN, (CANVAS_H - totalHeight) / 2)
    for (const item of col) {
      item.y = clampCenter(y + item.height / 2, item.height / 2, CANVAS_H)
      y += item.height + BODY_GAP
    }
  }

  resolveBodyOverlaps(items)

  const out: NodeBulkItem[] = []
  for (const item of items) {
    const px = snapCoord(item.x)
    const py = snapCoord(item.y)
    const node = item.node
    const ox = node.original_position_x ?? node.position_x
    const oy = node.original_position_y ?? node.position_y
    const canonicalChanged = !closeEnough(ox, px) || !closeEnough(oy, py)
    const shouldMoveCurrent =
      currentTracksOriginal(node) || sameStackedPosition(node, { ...node, position_x: ox, position_y: oy })
    const currentChanged = shouldMoveCurrent && (!closeEnough(node.position_x, px) || !closeEnough(node.position_y, py))

    if (canonicalChanged || currentChanged) {
      out.push({
        id: node.id,
        ...(currentChanged ? { position_x: px, position_y: py } : {}),
        original_position_x: px,
        original_position_y: py,
      })
    }
  }

  return out
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
      const px = snapCoord(Math.max(24, Math.min(CANVAS_W - 24, x)))
      const py = snapCoord(Math.max(24, Math.min(CANVAS_H - 24, y)))
      out.push({
        id: atOrigin[i]!.id,
        position_x: px,
        position_y: py,
        original_position_x: px,
        original_position_y: py,
      })
    }
    return out
  }
  if (atOrigin.length === 1) {
    return [
      {
        id: atOrigin[0]!.id,
        position_x: centerX,
        position_y: centerY,
        original_position_x: centerX,
        original_position_y: centerY,
      },
    ]
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
      const px = snapCoord(Math.max(24, Math.min(CANVAS_W - 24, x)))
      const py = snapCoord(Math.max(24, Math.min(CANVAS_H - 24, y)))
      out.push({
        id: stack[i]!.id,
        position_x: px,
        position_y: py,
        original_position_x: px,
        original_position_y: py,
      })
    }
  }

  return out
}
