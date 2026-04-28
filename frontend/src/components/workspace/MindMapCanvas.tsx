import { useCallback, useEffect, useRef, useState } from 'react'
import type { LinkOut, NodeOut } from '../../lib/api'
import { CANVAS_H, CANVAS_W, snapCoord } from '../../lib/canvasConstants'
import {
  DEFAULT_NODE_RADIUS,
  MAX_NODE_RADIUS,
  MIN_NODE_RADIUS,
  readNodeRadiusPx,
} from '../../lib/nodeDisplay'
import { nodeOrbStyle } from '../../lib/nodeOrbStyle'

function bezierForEdge(x1: number, y1: number, x2: number, y2: number): string {
  const dx = x2 - x1
  const c1x = x1 + dx * 0.4
  const c1y = y1
  const c2x = x2 - dx * 0.4
  const c2y = y2
  return `M ${x1} ${y1} C ${c1x} ${c1y} ${c2x} ${c2y} ${x2} ${y2}`
}

type DragState = {
  id: number
  startPointer: { x: number; y: number }
  startNode: { x: number; y: number }
}

type PlaceDraft = { cx: number; cy: number; r: number }
type WireDraft = { fromId: number; x0: number; y0: number; x1: number; y1: number }

type Props = {
  nodes: NodeOut[]
  links: LinkOut[]
  selectedId: number | null
  connectMode: boolean
  placeNodeMode: boolean
  onSelect: (id: number | null) => void
  onHoverNode: (id: number | null) => void
  onDragEnd: (id: number, x: number, y: number) => void
  onConnectWire: (fromId: number, toId: number) => void
  onPlaceNodeComplete: (cx: number, cy: number, radiusPx: number) => void
  pendingPosition?: Map<number, { x: number; y: number }>
}

export function MindMapCanvas({
  nodes,
  links,
  selectedId,
  connectMode,
  placeNodeMode,
  onSelect,
  onHoverNode,
  onDragEnd,
  onConnectWire,
  onPlaceNodeComplete,
  pendingPosition,
}: Props) {
  const boardRef = useRef<HTMLDivElement | null>(null)
  const hitRef = useRef<HTMLDivElement | null>(null)
  const [drag, setDrag] = useState<DragState | null>(null)
  const dragRef = useRef<DragState | null>(null)
  const [movePointer, setMovePointer] = useState<{ x: number; y: number } | null>(null)
  dragRef.current = drag

  const [placeDraft, setPlaceDraft] = useState<PlaceDraft | null>(null)
  const placeDraftRef = useRef<PlaceDraft | null>(null)
  placeDraftRef.current = placeDraft

  const [wireDraft, setWireDraft] = useState<WireDraft | null>(null)
  const wireDraftRef = useRef<WireDraft | null>(null)
  wireDraftRef.current = wireDraft

  const basePos = useCallback(
    (n: NodeOut) => pendingPosition?.get(n.id) ?? { x: n.position_x, y: n.position_y },
    [pendingPosition],
  )

  const posLive = useCallback(
    (n: NodeOut) => {
      const b = basePos(n)
      if (drag && drag.id === n.id && movePointer) {
        return {
          x: drag.startNode.x + (movePointer.x - drag.startPointer.x),
          y: drag.startNode.y + (movePointer.y - drag.startPointer.y),
        }
      }
      return b
    },
    [basePos, drag, movePointer],
  )

  const clientToLogical = useCallback((clientX: number, clientY: number) => {
    const el = boardRef.current
    if (!el) return { x: 0, y: 0 }
    const r = el.getBoundingClientRect()
    return {
      x: ((clientX - r.left) / r.width) * CANVAS_W,
      y: ((clientY - r.top) / r.height) * CANVAS_H,
    }
  }, [])

  const nodeAtLogicalPoint = useCallback(
    (lx: number, ly: number, excludeId?: number): NodeOut | null => {
      let best: NodeOut | null = null
      let bestD = Infinity
      for (const n of nodes) {
        if (n.id === excludeId) continue
        const p = posLive(n)
        const rad = readNodeRadiusPx(n)
        const d = Math.hypot(lx - p.x, ly - p.y)
        if (d <= rad + 6 && d < bestD) {
          bestD = d
          best = n
        }
      }
      return best
    },
    [nodes, posLive],
  )

  const endDrag = useCallback(
    (clientX: number, clientY: number) => {
      const d = dragRef.current
      if (!d) return
      const l = clientToLogical(clientX, clientY)
      const moved = Math.hypot(l.x - d.startPointer.x, l.y - d.startPointer.y)
      if (moved < 4) {
        setDrag(null)
        setMovePointer(null)
        return
      }
      const nx = d.startNode.x + (l.x - d.startPointer.x)
      const ny = d.startNode.y + (l.y - d.startPointer.y)
      const nodeRow = nodes.find((o) => o.id === d.id)
      const rad = nodeRow ? readNodeRadiusPx(nodeRow) : DEFAULT_NODE_RADIUS
      const sx = snapCoord(Math.max(rad, Math.min(CANVAS_W - rad, nx)))
      const sy = snapCoord(Math.max(rad, Math.min(CANVAS_H - rad, ny)))
      onDragEnd(d.id, sx, sy)
      setDrag(null)
      setMovePointer(null)
    },
    [clientToLogical, onDragEnd, nodes],
  )

  useEffect(() => {
    if (!drag) return
    const onMove = (e: PointerEvent) => {
      e.preventDefault()
      setMovePointer(clientToLogical(e.clientX, e.clientY))
    }
    const onUp = (e: PointerEvent) => {
      endDrag(e.clientX, e.clientY)
    }
    window.addEventListener('pointermove', onMove, { passive: false })
    window.addEventListener('pointerup', onUp, { passive: true })
    window.addEventListener('pointercancel', onUp, { passive: true })
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
    }
  }, [drag, clientToLogical, endDrag])

  useEffect(() => {
    if (!placeDraft) return
    const onMove = (e: PointerEvent) => {
      e.preventDefault()
      const cur = clientToLogical(e.clientX, e.clientY)
      const draft = placeDraftRef.current
      if (!draft) return
      const r = Math.hypot(cur.x - draft.cx, cur.y - draft.cy)
      setPlaceDraft({ ...draft, r })
    }
    const onUp = (e: PointerEvent) => {
      const draft = placeDraftRef.current
      setPlaceDraft(null)
      if (!draft) return
      const cur = clientToLogical(e.clientX, e.clientY)
      const rRaw = Math.hypot(cur.x - draft.cx, cur.y - draft.cy)
      const r = Math.min(MAX_NODE_RADIUS, Math.max(MIN_NODE_RADIUS, rRaw < 12 ? DEFAULT_NODE_RADIUS : rRaw))
      const cx = snapCoord(Math.max(r, Math.min(CANVAS_W - r, draft.cx)))
      const cy = snapCoord(Math.max(r, Math.min(CANVAS_H - r, draft.cy)))
      onPlaceNodeComplete(cx, cy, r)
    }
    window.addEventListener('pointermove', onMove, { passive: false })
    window.addEventListener('pointerup', onUp, { passive: true })
    window.addEventListener('pointercancel', onUp, { passive: true })
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
    }
  }, [placeDraft, clientToLogical, onPlaceNodeComplete])

  useEffect(() => {
    if (!wireDraft) return
    const onMove = (e: PointerEvent) => {
      e.preventDefault()
      const cur = clientToLogical(e.clientX, e.clientY)
      const w = wireDraftRef.current
      if (!w) return
      setWireDraft({ ...w, x1: cur.x, y1: cur.y })
    }
    const onUp = (e: PointerEvent) => {
      const w = wireDraftRef.current
      setWireDraft(null)
      if (!w) return
      const cur = clientToLogical(e.clientX, e.clientY)
      const target = nodeAtLogicalPoint(cur.x, cur.y, w.fromId)
      if (target) onConnectWire(w.fromId, target.id)
    }
    window.addEventListener('pointermove', onMove, { passive: false })
    window.addEventListener('pointerup', onUp, { passive: true })
    window.addEventListener('pointercancel', onUp, { passive: true })
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
    }
  }, [wireDraft, clientToLogical, nodeAtLogicalPoint, onConnectWire])

  const onPointerDownOrb = useCallback(
    (e: React.PointerEvent, n: NodeOut) => {
      e.stopPropagation()
      onSelect(n.id)
      if (connectMode) {
        e.preventDefault()
        const p = posLive(n)
        const l = clientToLogical(e.clientX, e.clientY)
        setWireDraft({ fromId: n.id, x0: p.x, y0: p.y, x1: l.x, y1: l.y })
        return
      }
      if (placeNodeMode) {
        e.preventDefault()
        return
      }
      e.preventDefault()
      const l = clientToLogical(e.clientX, e.clientY)
      setMovePointer(l)
      setDrag({ id: n.id, startPointer: l, startNode: basePos(n) })
    },
    [clientToLogical, connectMode, placeNodeMode, onSelect, basePos, posLive],
  )

  const onBackgroundPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if ((e.target as HTMLElement).closest('.mm-orb')) return
      if (placeNodeMode) {
        e.preventDefault()
        const l = clientToLogical(e.clientX, e.clientY)
        const cx = Math.max(MIN_NODE_RADIUS, Math.min(CANVAS_W - MIN_NODE_RADIUS, l.x))
        const cy = Math.max(MIN_NODE_RADIUS, Math.min(CANVAS_H - MIN_NODE_RADIUS, l.y))
        setPlaceDraft({ cx, cy, r: MIN_NODE_RADIUS })
        try {
          hitRef.current?.setPointerCapture(e.pointerId)
        } catch {
          /* ignore */
        }
        return
      }
    },
    [clientToLogical, placeNodeMode],
  )

  const onBackgroundClick = useCallback(
    (e: React.MouseEvent) => {
      if ((e.target as HTMLElement).closest('.mm-orb')) return
      if (placeNodeMode) return
      onSelect(null)
    },
    [onSelect, placeNodeMode],
  )

  const boardClass =
    `mm-canvas-board${placeNodeMode ? ' mm-canvas-board--place' : ''}${connectMode ? ' mm-canvas-board--connect' : ''}`.trim()

  return (
    <div ref={boardRef} className={boardClass} role='presentation' onClick={onBackgroundClick}>
      <div className='mm-canvas__vignette' aria-hidden />
      <div className='mm-canvas__grid' aria-hidden />
      <div
        ref={hitRef}
        className='mm-canvas__hit'
        onPointerDown={onBackgroundPointerDown}
        aria-hidden
      />
      <svg
        className='mm-canvas__edges'
        viewBox={`0 0 ${CANVAS_W} ${CANVAS_H}`}
        preserveAspectRatio='none'
        aria-hidden
      >
        {links.map((link) => {
          const a = nodes.find((o) => o.id === link.parent_id)
          const b = nodes.find((o) => o.id === link.child_id)
          if (!a || !b) return null
          const p1 = posLive(a)
          const p2 = posLive(b)
          return <path key={link.id} d={bezierForEdge(p1.x, p1.y, p2.x, p2.y)} className='mm-edge' />
        })}
        {wireDraft ? (
          <path
            d={bezierForEdge(wireDraft.x0, wireDraft.y0, wireDraft.x1, wireDraft.y1)}
            className='mm-edge mm-edge--draft'
          />
        ) : null}
        {placeDraft ? (
          <circle
            cx={placeDraft.cx}
            cy={placeDraft.cy}
            r={Math.max(MIN_NODE_RADIUS, placeDraft.r)}
            className='mm-place-preview'
          />
        ) : null}
      </svg>
      {nodes.map((n) => {
        const p = posLive(n)
        const orb = nodeOrbStyle(n.color)
        const isSel = selectedId === n.id
        const rPx = readNodeRadiusPx(n)
        const dPct = (2 * rPx) / CANVAS_W
        const left = `${(p.x / CANVAS_W) * 100}%`
        const top = `${(p.y / CANVAS_H) * 100}%`
        const wireFrom = wireDraft?.fromId === n.id
        return (
          <div
            key={n.id}
            role='button'
            tabIndex={0}
            className={`mm-orb${isSel ? ' mm-orb--selected' : ''}${wireFrom ? ' mm-orb--wire-from' : ''}${
              connectMode && !wireDraft && !placeNodeMode ? ' mm-orb--connect-target' : ''
            }`}
            style={{
              left,
              top,
              width: `${dPct * 100}%`,
              height: 'auto',
              aspectRatio: '1',
              background: orb.background,
              color: orb.color,
              boxShadow: isSel
                ? '0 0 0 3px rgba(20, 184, 166, 0.55), 0 12px 36px rgba(15, 23, 42, 0.12)'
                : '0 8px 28px rgba(15, 23, 42, 0.1)',
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') onSelect(n.id)
            }}
            onPointerDown={(e) => onPointerDownOrb(e, n)}
            onPointerEnter={() => onHoverNode(n.id)}
            onPointerLeave={() => onHoverNode(null)}
          >
            <span className='mm-orb__text' title={n.topic}>
              {n.topic}
            </span>
          </div>
        )
      })}
    </div>
  )
}
