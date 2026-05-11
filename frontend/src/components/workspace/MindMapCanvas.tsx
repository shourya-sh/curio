import { Fragment, forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react'
import type { LinkOut, NodeOut } from '../../lib/api'
import { CANVAS_H, CANVAS_W, snapCoord } from '../../lib/canvasConstants'
import {
  DEFAULT_NODE_RADIUS,
  MAX_NODE_RADIUS,
  MIN_NODE_RADIUS,
  readNodeBoxPx,
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
type WireDraft = { fromId: number; x1: number; y1: number }
type Viewport = { x: number; y: number; scale: number }
type PanState = {
  pointerId: number
  startClient: { x: number; y: number }
  startViewport: Viewport
}

const MIN_ZOOM = 0.35
const MAX_ZOOM = 2.5

function clampZoom(value: number): number {
  return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, value))
}

function anchorPoint(cx: number, cy: number, width: number, height: number, tx: number, ty: number) {
  const dx = tx - cx
  const dy = ty - cy
  if (Math.abs(dx) < 0.001 && Math.abs(dy) < 0.001) {
    return { x: cx, y: cy }
  }
  const sx = Math.abs(dx) > 0.001 ? (width / 2) / Math.abs(dx) : Infinity
  const sy = Math.abs(dy) > 0.001 ? (height / 2) / Math.abs(dy) : Infinity
  const scale = Math.min(sx, sy)
  return {
    x: cx + dx * scale,
    y: cy + dy * scale,
  }
}

function pointInsideNode(lx: number, ly: number, cx: number, cy: number, width: number, height: number): boolean {
  return Math.abs(lx - cx) <= width / 2 + 10 && Math.abs(ly - cy) <= height / 2 + 10
}

export type ViewportSnapshot = {
  scale: number
  handToolActive: boolean
}

export type MindMapCanvasHandle = {
  setHandTool: (on: boolean) => void
  zoomIn: () => void
  zoomOut: () => void
  resetView: () => void
  fit: () => void
}

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
  selectedLinkId?: number | null
  onSelectLink?: (linkId: number | null, pos?: { x: number; y: number }) => void
  /** Increment to fit all nodes in view (after layout is restored in the parent). */
  fitContentNonce?: number
  /** Reset nodes to canonical positions, persist, then parent bumps `fitContentNonce`. */
  onFitView?: () => void
  /** Enable CSS position transitions (set true during/after streaming layout). */
  animatePositions?: boolean
  /** Node IDs currently being streamed in (for fade-in animation). */
  streamingNodeIds?: Set<number>
  /** Link IDs recently created (for edge draw-in animation). */
  newLinkIds?: Set<number>
  /** Emits the latest viewport scale + pan tool state to the parent so external controls can reflect/affect them. */
  onViewportChange?: (snapshot: ViewportSnapshot) => void
  /** Per-side padding (in css px) the fit-to-view algorithm should leave free.
   *  Used to keep the floating control dock from overlapping the fitted content. */
  fitInset?: { top: number; right: number; bottom: number; left: number }
}

export const MindMapCanvas = forwardRef<MindMapCanvasHandle, Props>(function MindMapCanvas(
  {
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
    selectedLinkId = null,
    onSelectLink,
    fitContentNonce = 0,
    onFitView,
    animatePositions = false,
    streamingNodeIds,
    newLinkIds,
    onViewportChange,
    fitInset,
  }: Props,
  ref,
) {
  const boardRef = useRef<HTMLDivElement | null>(null)
  const hitRef = useRef<HTMLDivElement | null>(null)
  const spaceDownRef = useRef(false)
  const handToolRef = useRef(false)
  const [handTool, setHandTool] = useState(false)
  const [drag, setDrag] = useState<DragState | null>(null)
  const dragRef = useRef<DragState | null>(null)
  const [viewport, setViewport] = useState<Viewport>({ x: 0, y: 0, scale: 1 })
  const [pan, setPan] = useState<PanState | null>(null)
  const [movePointer, setMovePointer] = useState<{ x: number; y: number } | null>(null)
  dragRef.current = drag
  handToolRef.current = handTool

  const [placeDraft, setPlaceDraft] = useState<PlaceDraft | null>(null)
  const placeDraftRef = useRef<PlaceDraft | null>(null)
  placeDraftRef.current = placeDraft

  const [wireDraft, setWireDraft] = useState<WireDraft | null>(null)
  const wireDraftRef = useRef<WireDraft | null>(null)
  wireDraftRef.current = wireDraft
  const [wireTargetId, setWireTargetId] = useState<number | null>(null)

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
    const localX = (clientX - r.left - viewport.x) / viewport.scale
    const localY = (clientY - r.top - viewport.y) / viewport.scale
    return { x: localX, y: localY }
  }, [viewport])

  const zoomAt = useCallback((clientX: number, clientY: number, nextScaleRaw: number) => {
    const el = boardRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const nextScale = clampZoom(nextScaleRaw)
    setViewport((current) => {
      const localX = clientX - rect.left
      const localY = clientY - rect.top
      const contentX = (localX - current.x) / current.scale
      const contentY = (localY - current.y) / current.scale
      return {
        scale: nextScale,
        x: localX - contentX * nextScale,
        y: localY - contentY * nextScale,
      }
    })
  }, [])

  const resetView = useCallback(() => {
    setViewport({ x: 0, y: 0, scale: 1 })
  }, [])

  const zoomCentered = useCallback(
    (factor: number) => {
      const el = boardRef.current
      if (!el) return
      const rect = el.getBoundingClientRect()
      zoomAt(rect.left + rect.width / 2, rect.top + rect.height / 2, viewport.scale * factor)
    },
    [viewport.scale, zoomAt],
  )

  const runFitBounds = useCallback(() => {
    const el = boardRef.current
    if (!el || nodes.length === 0) {
      setViewport({ x: 0, y: 0, scale: 1 })
      return
    }
    const rect = el.getBoundingClientRect()
    const W = rect.width
    const H = rect.height
    if (W < 1 || H < 1) {
      // Canvas hasn't been laid out yet (e.g. opening a fresh session before
      // flex children settle). Retry on the next frame so auto-fit still works.
      requestAnimationFrame(() => runFitBounds())
      return
    }

    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    for (const n of nodes) {
      const p = pendingPosition?.get(n.id) ?? { x: n.position_x, y: n.position_y }
      const box = readNodeBoxPx(n)
      minX = Math.min(minX, p.x - box.width / 2)
      maxX = Math.max(maxX, p.x + box.width / 2)
      minY = Math.min(minY, p.y - box.height / 2)
      maxY = Math.max(maxY, p.y + box.height / 2)
    }

    const padT = fitInset?.top ?? 48
    const padR = fitInset?.right ?? 48
    const padB = fitInset?.bottom ?? 48
    const padL = fitInset?.left ?? 48
    const cw = Math.max(maxX - minX, 1)
    const ch = Math.max(maxY - minY, 1)
    const availW = Math.max(W - padL - padR, 1)
    const availH = Math.max(H - padT - padB, 1)
    const scale = clampZoom(Math.min(availW / cw, availH / ch))
    const cx = (minX + maxX) / 2
    const cy = (minY + maxY) / 2
    // Center on the geometric middle of the available (non-dock-covered) area.
    const availCenterX = (padL + (W - padR)) / 2
    const availCenterY = (padT + (H - padB)) / 2
    setViewport({
      scale,
      x: availCenterX - cx * scale,
      y: availCenterY - cy * scale,
    })
  }, [nodes, pendingPosition, fitInset])

  const lastFitNonceRef = useRef(0)
  useLayoutEffect(() => {
    if (fitContentNonce === 0) return
    if (lastFitNonceRef.current === fitContentNonce) return
    lastFitNonceRef.current = fitContentNonce
    runFitBounds()
  }, [fitContentNonce, runFitBounds])

  const beginPan = useCallback(
    (e: React.PointerEvent, captureTarget: Element | null) => {
      e.preventDefault()
      setPan({
        pointerId: e.pointerId,
        startClient: { x: e.clientX, y: e.clientY },
        startViewport: viewport,
      })
      try {
        ;(captureTarget ?? hitRef.current)?.setPointerCapture(e.pointerId)
      } catch {
        /* ignore */
      }
    },
    [viewport],
  )

  useEffect(() => {
    if (connectMode || placeNodeMode) setHandTool(false)
  }, [connectMode, placeNodeMode])

  const handToolActive = handTool && !connectMode && !placeNodeMode

  useEffect(() => {
    onViewportChange?.({ scale: viewport.scale, handToolActive })
  }, [viewport.scale, handToolActive, onViewportChange])

  useImperativeHandle(
    ref,
    () => ({
      setHandTool: (on: boolean) => setHandTool(on),
      zoomIn: () => zoomCentered(1.15),
      zoomOut: () => zoomCentered(1 / 1.15),
      resetView,
      fit: () => {
        if (onFitView) onFitView()
        else resetView()
      },
    }),
    [onFitView, resetView, zoomCentered],
  )

  useEffect(() => {
    const isTyping = (target: EventTarget | null) => {
      const el = target as HTMLElement | null
      const tag = el?.tagName?.toLowerCase()
      return tag === 'input' || tag === 'textarea' || tag === 'select' || Boolean(el?.isContentEditable)
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (isTyping(e.target)) return
      if (e.code === 'Space') {
        spaceDownRef.current = true
        e.preventDefault()
        return
      }
      if (e.key === 'Escape' && handToolRef.current) {
        setHandTool(false)
        e.preventDefault()
        return
      }
      if (e.key === '+' || e.key === '=') {
        const rect = boardRef.current?.getBoundingClientRect()
        if (rect) zoomAt(rect.left + rect.width / 2, rect.top + rect.height / 2, viewport.scale * 1.12)
        e.preventDefault()
      } else if (e.key === '-') {
        const rect = boardRef.current?.getBoundingClientRect()
        if (rect) zoomAt(rect.left + rect.width / 2, rect.top + rect.height / 2, viewport.scale / 1.12)
        e.preventDefault()
      } else if (e.key === '0' || e.key === 'Home') {
        if (onFitView) onFitView()
        else resetView()
        e.preventDefault()
      } else if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
        const step = e.shiftKey ? 80 : 32
        setViewport((current) => ({
          ...current,
          x: current.x + (e.key === 'ArrowRight' ? -step : e.key === 'ArrowLeft' ? step : 0),
          y: current.y + (e.key === 'ArrowDown' ? -step : e.key === 'ArrowUp' ? step : 0),
        }))
        e.preventDefault()
      }
    }
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') spaceDownRef.current = false
    }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
    }
  }, [onFitView, resetView, viewport.scale, zoomAt])

  const nodeAtLogicalPoint = useCallback(
    (lx: number, ly: number, excludeId?: number): NodeOut | null => {
      let best: NodeOut | null = null
      let bestD = Infinity
      for (const n of nodes) {
        if (n.id === excludeId) continue
        const p = posLive(n)
        const box = readNodeBoxPx(n)
        const d = Math.hypot(lx - p.x, ly - p.y)
        if (pointInsideNode(lx, ly, p.x, p.y, box.width, box.height) && d < bestD) {
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
      // Free positioning — no canvas clamp. The viewport pans/zooms anywhere
      // the user drops a node; agent layouts still cluster near the centre.
      const sx = snapCoord(nx)
      const sy = snapCoord(ny)
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
      // No canvas clamp — drop node anywhere the user drew it.
      onPlaceNodeComplete(snapCoord(draft.cx), snapCoord(draft.cy), r)
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
    if (connectMode) return
    setWireDraft(null)
    setWireTargetId(null)
  }, [connectMode])

  useEffect(() => {
    if (placeNodeMode) return
    setPlaceDraft(null)
  }, [placeNodeMode])

  const onPointerDownOrb = useCallback(
    (e: React.PointerEvent, n: NodeOut) => {
      e.stopPropagation()
      if (handTool && !connectMode && !placeNodeMode && e.button === 0) {
        beginPan(e, e.currentTarget)
        return
      }
      if (connectMode) {
        e.preventDefault()
        const l = clientToLogical(e.clientX, e.clientY)
        const current = wireDraftRef.current
        if (!current) {
          setWireDraft({ fromId: n.id, x1: l.x, y1: l.y })
          setWireTargetId(null)
          return
        }
        if (current.fromId === n.id) {
          setWireDraft(null)
          setWireTargetId(null)
          return
        }
        onConnectWire(current.fromId, n.id)
        setWireDraft(null)
        setWireTargetId(null)
        return
      }
      onSelect(n.id)
      if (placeNodeMode) {
        e.preventDefault()
        return
      }
      e.preventDefault()
      const l = clientToLogical(e.clientX, e.clientY)
      setMovePointer(l)
      setDrag({ id: n.id, startPointer: l, startNode: basePos(n) })
    },
    [beginPan, clientToLogical, connectMode, handTool, placeNodeMode, onSelect, basePos, posLive, onConnectWire],
  )

  const onBackgroundPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if ((e.target as HTMLElement).closest('.mm-orb')) return
      const panWithPrimary =
        !placeNodeMode && e.button === 0 && (spaceDownRef.current || handToolRef.current)
      if (!placeNodeMode && (e.button === 1 || panWithPrimary)) {
        beginPan(e, hitRef.current)
        return
      }
      if (placeNodeMode) {
        e.preventDefault()
        const l = clientToLogical(e.clientX, e.clientY)
        // Free placement — wherever the user clicked.
        setPlaceDraft({ cx: l.x, cy: l.y, r: MIN_NODE_RADIUS })
        try {
          hitRef.current?.setPointerCapture(e.pointerId)
        } catch {
          /* ignore */
        }
        return
      }
    },
    [beginPan, clientToLogical, placeNodeMode],
  )

  const onBackgroundClick = useCallback(
    (e: React.MouseEvent) => {
      if ((e.target as HTMLElement).closest('.mm-orb')) return
      if (connectMode) {
        if (wireDraftRef.current) {
          setWireDraft(null)
          setWireTargetId(null)
        }
        return
      }
      if (placeNodeMode) return
      onSelectLink?.(null)
      onSelect(null)
    },
    [connectMode, onSelect, onSelectLink, placeNodeMode],
  )

  const onBoardPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (pan) {
        e.preventDefault()
        setViewport({
          ...pan.startViewport,
          x: pan.startViewport.x + (e.clientX - pan.startClient.x),
          y: pan.startViewport.y + (e.clientY - pan.startClient.y),
        })
        return
      }
      if (!connectMode) return
      const current = wireDraftRef.current
      if (!current) return
      const cur = clientToLogical(e.clientX, e.clientY)
      const target = nodeAtLogicalPoint(cur.x, cur.y, current.fromId)
      setWireDraft({ ...current, x1: cur.x, y1: cur.y })
      const nextTargetId = target?.id ?? null
      setWireTargetId((prev) => (prev === nextTargetId ? prev : nextTargetId))
    },
    [clientToLogical, connectMode, nodeAtLogicalPoint, pan],
  )

  const onBoardPointerUp = useCallback(
    (e: React.PointerEvent) => {
      if (pan && pan.pointerId === e.pointerId) {
        const dx = e.clientX - pan.startClient.x
        const dy = e.clientY - pan.startClient.y
        const moved = Math.hypot(dx, dy)
        setPan(null)
        // A click without any drag exits hand-tool mode. The user is signalling
        // they're done panning. Drags (>= 4px) keep the tool armed.
        if (moved < 4 && handToolRef.current) {
          setHandTool(false)
        }
        return
      }
      if (!connectMode) return
      const current = wireDraftRef.current
      if (!current) return
      const cur = clientToLogical(e.clientX, e.clientY)
      const target = nodeAtLogicalPoint(cur.x, cur.y, current.fromId)
      if (target) {
        onConnectWire(current.fromId, target.id)
        setWireDraft(null)
        setWireTargetId(null)
      }
    },
    [clientToLogical, connectMode, nodeAtLogicalPoint, onConnectWire, pan],
  )

  const onWheel = useCallback(
    (e: React.WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return
      e.preventDefault()
      const factor = e.deltaY > 0 ? 0.9 : 1.1
      zoomAt(e.clientX, e.clientY, viewport.scale * factor)
    },
    [viewport.scale, zoomAt],
  )

  const boardClass =
    `mm-canvas-board${placeNodeMode ? ' mm-canvas-board--place' : ''}${connectMode ? ' mm-canvas-board--connect' : ''}${handToolActive ? ' mm-canvas-board--hand-tool' : ''}${pan ? ' mm-canvas-board--panning' : ''}`.trim()

  return (
    <div
      ref={boardRef}
      className={boardClass}
      role='presentation'
      onClick={onBackgroundClick}
      onPointerMove={onBoardPointerMove}
      onPointerUp={onBoardPointerUp}
      onWheel={onWheel}
    >
      <div className='mm-canvas__vignette' aria-hidden />
      <div
        className={`mm-canvas__viewport${animatePositions ? ' mm-canvas__viewport--animating' : ''}`}
        style={{
          transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.scale})`,
          width: `${CANVAS_W}px`,
          height: `${CANVAS_H}px`,
        }}
      >
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
          const c1 = posLive(a)
          const c2 = posLive(b)
          const b1 = readNodeBoxPx(a)
          const b2 = readNodeBoxPx(b)
          const p1 = anchorPoint(c1.x, c1.y, b1.width, b1.height, c2.x, c2.y)
          const p2 = anchorPoint(c2.x, c2.y, b2.width, b2.height, c1.x, c1.y)
          const d = bezierForEdge(p1.x, p1.y, p2.x, p2.y)
          const mid = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 }
          const raw = (link.line_style ?? 'solid') as string
          const style = ['solid', 'dashed', 'dotted', 'bold'].includes(raw) ? raw : 'solid'
          const isSel = selectedLinkId === link.id
          return (
            <Fragment key={link.id}>
              <path
                d={d}
                className='mm-edge-hit'
                fill='none'
                stroke='transparent'
                strokeWidth={36}
                strokeLinecap='round'
                onPointerDown={(e) => {
                  if (connectMode) return
                  if (handToolRef.current && e.button === 0) {
                    e.stopPropagation()
                    beginPan(e, e.currentTarget)
                    return
                  }
                  e.stopPropagation()
                  onSelectLink?.(link.id, mid)
                }}
                onClick={(e) => {
                  if (connectMode) return
                  e.stopPropagation()
                }}
              />
              <path
                d={d}
                className='mm-edge-underlay'
                pointerEvents='none'
              />
              <path
                d={d}
                className={`mm-edge mm-edge--${style}${isSel ? ' mm-edge--selected' : ''}${newLinkIds?.has(link.id) ? ' mm-edge--new' : ''}`}
                style={!isSel && link.color ? { stroke: link.color } : undefined}
                pointerEvents='none'
              />
            </Fragment>
          )
        })}
        {connectMode && wireDraft ? (
          (() => {
            const source = nodes.find((n) => n.id === wireDraft.fromId)
            if (!source) return null
            const sourceCenter = posLive(source)
            const sourceBox = readNodeBoxPx(source)
            const target = wireTargetId != null ? nodes.find((n) => n.id === wireTargetId) ?? null : null
            const targetCenter = target ? posLive(target) : { x: wireDraft.x1, y: wireDraft.y1 }
            const from = anchorPoint(sourceCenter.x, sourceCenter.y, sourceBox.width, sourceBox.height, targetCenter.x, targetCenter.y)
            const to = target
              ? (() => {
                  const targetBox = readNodeBoxPx(target)
                  return anchorPoint(targetCenter.x, targetCenter.y, targetBox.width, targetBox.height, sourceCenter.x, sourceCenter.y)
                })()
              : { x: wireDraft.x1, y: wireDraft.y1 }
            return <path d={bezierForEdge(from.x, from.y, to.x, to.y)} className='mm-edge mm-edge--draft' />
          })()
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
        const box = readNodeBoxPx(n)
        const left = `${p.x}px`
        const top = `${p.y}px`
        const wireFrom = connectMode && wireDraft?.fromId === n.id
        const wireTarget = connectMode && wireTargetId === n.id
        const isDragging = drag?.id === n.id
        const isStreamingIn = streamingNodeIds?.has(n.id)
        return (
          <div
            key={n.id}
            role='button'
            tabIndex={0}
            className={`mm-orb${isSel ? ' mm-orb--selected' : ''}${wireFrom ? ' mm-orb--wire-from' : ''}${
              wireTarget ? ' mm-orb--wire-target' : ''
            }${connectMode && !placeNodeMode ? ' mm-orb--connect-target' : ''}${
              isDragging ? ' mm-orb--dragging' : ''
            }${isStreamingIn ? ' mm-orb--streaming-in' : ''}`}
            style={{
              left,
              top,
              width: `${box.width}px`,
              height: `${box.height}px`,
              aspectRatio: box.manual ? '1' : 'auto',
              background: orb.background,
              color: orb.color,
              borderRadius: box.manual ? '999px' : '999px',
              ['--mm-orb-font-size' as string]: `${box.fontSize}px`,
              ['--mm-orb-lines' as string]: box.lines,
              boxShadow: isSel
                ? '0 0 0 3px rgba(20, 184, 166, 0.55), 0 12px 36px rgba(15, 23, 42, 0.12)'
                : '0 8px 28px rgba(15, 23, 42, 0.1)',
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') onSelect(n.id)
            }}
            onPointerDown={(e) => onPointerDownOrb(e, n)}
            onPointerEnter={() => {
              if (connectMode) return
              onHoverNode(n.id)
            }}
            onPointerLeave={() => {
              if (connectMode) return
              onHoverNode(null)
            }}
          >
            <span className='mm-orb__text' title={n.topic}>
              {n.topic}
            </span>
          </div>
        )
        })}
      </div>
    </div>
  )
})
