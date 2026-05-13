import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { flushSync } from 'react-dom'

import type { NodeOut } from '../../lib/api'
import {
  manualRadiusPxFromSliderPercent,
  manualRadiusSliderPercent,
  readNodeBoxPx,
  readNodeStyleSidecar,
  type NodeBoxPx,
} from '../../lib/nodeDisplay'
import type { NodeStyleDelta } from '../../lib/manualGraph'
import { computeOrbitEllipseGeom, ORBIT_RING_STROKE_PX } from '../../lib/orbitLayout'
import { NODE_TINT_CHOICES, normalizeNodeFillHex } from './NodeColorField'

const TINT_PRESET_SET = new Set<string>(NODE_TINT_CHOICES)

export type OrbitPanelId = 'title' | 'fill' | 'textColor' | 'fontSize' | 'font' | 'scale' | 'layout'

type Props = {
  node: NodeOut
  box: NodeBoxPx
  onApplyStyleDelta: (delta: NodeStyleDelta & { color?: string | null; clearManualRadius?: boolean }) => void
  onRename: () => void
  /** When pan/zoom updates, reclamp the open sheet to the visible canvas area. */
  orbitViewportClampKey?: string
}

const TEXT_INK_SWATCHES = [
  '#0f172a',
  '#1e3a5f',
  '#14532d',
  '#7c2d12',
  '#ffffff',
  '#fef3c7',
  '#e2e8f0',
  '#64748b',
] as const

const SATELLITES: {
  id: OrbitPanelId
  label: string
  caption: string
  icon: 'title' | 'fill' | 'text' | 'aa' | 'font' | 'scale' | 'layout'
}[] = [
  { id: 'title', label: 'Title', caption: 'Title', icon: 'title' },
  { id: 'fill', label: 'Fill color', caption: 'Fill', icon: 'fill' },
  { id: 'textColor', label: 'Text color', caption: 'Ink', icon: 'text' },
  { id: 'fontSize', label: 'Text size', caption: 'Size', icon: 'aa' },
  { id: 'font', label: 'Font', caption: 'Font', icon: 'font' },
  { id: 'scale', label: 'Node size', caption: 'Scale', icon: 'scale' },
  { id: 'layout', label: 'Auto layout', caption: 'Auto', icon: 'layout' },
]

const ICON_INK = 'rgba(15, 23, 42, 0.9)'

function iconStroke(strokeWidth = 1.45) {
  return {
    stroke: ICON_INK,
    fill: 'none' as const,
    strokeWidth,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  }
}

/** Multicolor / duotone accents live in the SVGs; base strokes stay slate for contrast. */
function OrbitIcon({ kind }: { kind: (typeof SATELLITES)[number]['icon'] }) {
  const uid = useId().replace(/:/g, '')
  const spectrumId = `mm-orbit-fill-spectrum-${uid}`
  const fontGradId = `mm-orbit-font-grad-${uid}`
  if (kind === 'title')
    return (
      <svg width={16} height={16} viewBox='0 0 24 24' aria-hidden className='mm-orbit-sat__svg'>
        <path d='M4 7h12M4 12h8M4 17h10' {...iconStroke(1.4)} stroke='#475569' />
        <path d='M17 5v14l4-3.5L17 5z' fill='none' stroke='#14b8a6' strokeWidth={1.65} strokeLinecap='round' strokeLinejoin='round' />
      </svg>
    )
  if (kind === 'fill')
    return (
      <svg width={16} height={16} viewBox='0 0 24 24' aria-hidden className='mm-orbit-sat__svg'>
        <defs>
          <linearGradient id={spectrumId} x1='0%' y1='0%' x2='100%' y2='0%'>
            <stop offset='0%' stopColor='#ef4444' />
            <stop offset='16%' stopColor='#f97316' />
            <stop offset='33%' stopColor='#eab308' />
            <stop offset='50%' stopColor='#22c55e' />
            <stop offset='66%' stopColor='#06b6d4' />
            <stop offset='82%' stopColor='#6366f1' />
            <stop offset='100%' stopColor='#d946ef' />
          </linearGradient>
        </defs>
        <path d='M12 3C8 7 5 11 5 14a7 7 0 0 0 14 0c0-3-3-7-7-11z' fill='none' stroke='#0ea5e9' strokeWidth={1.35} strokeLinecap='round' strokeLinejoin='round' />
        <path d='M12 21v-4' stroke='#64748b' strokeWidth={1.35} strokeLinecap='round' fill='none' />
        <path
          d='M7.5 12.5Q12 8.5 16.5 12.5'
          fill='none'
          stroke={`url(#${spectrumId})`}
          strokeWidth={2.25}
          strokeLinecap='round'
        />
        <circle cx='16' cy='15' r='2.1' fill='#f472b6' />
        <circle cx='12' cy='16.2' r='1.85' fill='#fbbf24' />
        <circle cx='8.2' cy='15' r='1.85' fill='#34d399' />
      </svg>
    )
  if (kind === 'text')
    return (
      <svg width={16} height={16} viewBox='0 0 24 24' aria-hidden className='mm-orbit-sat__svg'>
        <text x={4.2} y={17.2} fontSize={14} fontWeight={800} fill='#0f172a' stroke='none' fontFamily='ui-sans-serif, system-ui, sans-serif'>
          A
        </text>
        <text x={12.2} y={14} fontSize={9.5} fontWeight={800} fill='#6366f1' stroke='none' fontFamily='ui-sans-serif, system-ui, sans-serif'>
          a
        </text>
        <path d='M4 20.5h16' stroke='#f97316' strokeWidth={2} strokeLinecap='round' fill='none' />
      </svg>
    )
  if (kind === 'aa')
    return (
      <svg width={16} height={16} viewBox='0 0 24 24' aria-hidden className='mm-orbit-sat__svg'>
        <text x={3.8} y={16.2} fontSize={12.5} fontWeight={800} fill='#0f172a' stroke='none' fontFamily='ui-sans-serif, system-ui, sans-serif'>
          A
        </text>
        <text x={11.2} y={13.2} fontSize={9.5} fontWeight={800} fill='#f59e0b' stroke='none' fontFamily='ui-sans-serif, system-ui, sans-serif'>
          a
        </text>
        <path d='M4 19h10' stroke='#14b8a6' strokeWidth={1.35} strokeLinecap='round' opacity={0.9} fill='none' />
      </svg>
    )
  if (kind === 'font')
    return (
      <svg width={16} height={16} viewBox='0 0 24 24' aria-hidden className='mm-orbit-sat__svg'>
        <defs>
          <linearGradient id={fontGradId} x1='0%' y1='0%' x2='0%' y2='100%'>
            <stop offset='0%' stopColor='#4f46e5' />
            <stop offset='100%' stopColor='#7c3aed' />
          </linearGradient>
        </defs>
        <path
          d='M5 19h3l1.2-3h6.6l1.2 3h3L13 5h-2L5 19zm6.5-5.5L12 8.2l.5 5.3h-2z'
          fill={`url(#${fontGradId})`}
          stroke='none'
        />
      </svg>
    )
  if (kind === 'scale')
    return (
      <svg width={16} height={16} viewBox='0 0 24 24' aria-hidden className='mm-orbit-sat__svg'>
        <rect x={4.5} y={4.5} width={11} height={11} rx={2.2} fill='none' stroke='#0d9488' strokeWidth={1.55} strokeLinecap='round' strokeLinejoin='round' />
        <rect x={10.5} y={10.5} width={8.5} height={8.5} rx={1.6} fill='rgba(124, 58, 237, 0.12)' stroke='#7c3aed' strokeWidth={1.55} strokeLinecap='round' strokeLinejoin='round' />
      </svg>
    )
  return (
    <svg width={16} height={16} viewBox='0 0 24 24' aria-hidden className='mm-orbit-sat__svg'>
      <path d='M12 3l1.2 3.2L16.5 7l-3.3 1L12 11l-1.2-3L7.5 7l3.3-.8L12 3z' fill='#fbbf24' stroke='#d97706' strokeWidth={1.1} strokeLinejoin='round' />
      <path d='M6 14h12l-2 7H8l-2-7z' fill='none' stroke='#14b8a6' strokeWidth={1.45} strokeLinecap='round' strokeLinejoin='round' />
    </svg>
  )
}

type OrbitFillSheetProps = {
  node: NodeOut
  sheetStyle: React.CSSProperties | undefined
  sheetRef: React.RefObject<HTMLDivElement | null>
  stop: (e: React.SyntheticEvent) => void
  cancelClose: () => void
  onApplyStyleDelta: Props['onApplyStyleDelta']
}

function OrbitFillSheet({ node, sheetStyle, sheetRef, stop, cancelClose, onApplyStyleDelta }: OrbitFillSheetProps) {
  const nodeFillNorm = node.color ? normalizeNodeFillHex(node.color) : null
  const isPreset = Boolean(nodeFillNorm && TINT_PRESET_SET.has(nodeFillNorm))
  const isCustomFill = Boolean(node.color?.trim()) && !isPreset
  const swatchBg = isCustomFill ? (nodeFillNorm ?? '#94a3b8') : undefined

  const [hexDraft, setHexDraft] = useState('')
  useEffect(() => {
    setHexDraft(nodeFillNorm ?? (node.color?.trim() ?? ''))
  }, [node.color, nodeFillNorm])

  const hexForPicker = nodeFillNorm ?? '#c7e2ff'

  const applyHexDraft = useCallback(() => {
    const hex = normalizeNodeFillHex(hexDraft)
    if (hex) onApplyStyleDelta({ color: hex })
  }, [hexDraft, onApplyStyleDelta])

  return (
    <div
      ref={sheetRef}
      className='mm-orbit-sheet mm-orbit-sheet--color'
      style={sheetStyle}
      onPointerDown={stop}
      onPointerEnter={cancelClose}
    >
      <div className='mm-orbit-sheet__chips' role='group' aria-label='Node fill'>
        {NODE_TINT_CHOICES.map((c) => (
          <button
            key={c}
            type='button'
            className={`mm-orbit-chip${nodeFillNorm === c ? ' is-on' : ''}`}
            style={{ background: c }}
            aria-pressed={nodeFillNorm === c}
            onClick={() => onApplyStyleDelta({ color: c })}
          />
        ))}
        <button
          type='button'
          className={`mm-orbit-chip mm-orbit-chip--custom${isCustomFill ? ' is-on' : ''}`}
          style={swatchBg ? { background: swatchBg } : undefined}
          aria-pressed={isCustomFill}
          title={isCustomFill ? (nodeFillNorm ?? node.color ?? '') : 'Custom fill'}
          aria-label={
            isCustomFill ? `Custom fill ${nodeFillNorm ?? node.color ?? ''}` : 'Custom fill (picker or hex below)'
          }
        >
          {!isCustomFill ? (
            <span className='mm-orbit-chip-custom-glyph' aria-hidden>
              +
            </span>
          ) : null}
        </button>
      </div>
      <div className='mm-orbit-fill-custom'>
        <label className='mm-orbit-fill-custom-picker'>
          <input
            type='color'
            aria-label='Custom fill color'
            value={hexForPicker}
            onChange={(e) => {
              const hex = normalizeNodeFillHex(e.target.value)
              if (hex) onApplyStyleDelta({ color: hex })
            }}
          />
        </label>
        <input
          type='text'
          className='mm-orbit-fill-custom-hex'
          spellCheck={false}
          autoCapitalize='off'
          autoCorrect='off'
          placeholder='#RRGGBB'
          value={hexDraft}
          onChange={(e) => setHexDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') applyHexDraft()
          }}
        />
        <button type='button' className='mm-orbit-fill-custom-apply' onClick={applyHexDraft}>
          Apply
        </button>
      </div>
    </div>
  )
}

function satModifier(id: OrbitPanelId): string {
  if (id === 'textColor') return 'mm-orbit-sat--ink'
  return `mm-orbit-sat--${id}`
}

const CLAMP_MARGIN = 10

/** Screen-space delta so interval [start, start + length] lies inside [min, max]. */
function clampIntervalDelta(start: number, length: number, min: number, max: number): number {
  const avail = max - min
  if (!(avail > 0)) return 0
  if (length >= avail) return min - start
  const targetStart = Math.min(Math.max(start, min), max - length)
  return targetStart - start
}

export function NodeOrbitCluster({
  node,
  box,
  onApplyStyleDelta,
  onRename,
  orbitViewportClampKey = '',
}: Props) {
  const [openPanel, setOpenPanel] = useState<OrbitPanelId | null>(null)
  const [sheetShift, setSheetShift] = useState({ x: 0, y: 0 })
  const [layoutRemeasure, setLayoutRemeasure] = useState(0)
  const sheetRef = useRef<HTMLDivElement | null>(null)

  const styleRec = readNodeStyleSidecar(node)
  const fontSizePx =
    typeof styleRec.fontSizePx === 'number' ? Math.round(styleRec.fontSizePx) : readNodeBoxPx(node).fontSize
  const fontFamily = styleRec.fontFamily ?? 'system'
  const textColor = typeof styleRec.textColor === 'string' ? styleRec.textColor : null

  const orbitGeom = useMemo(() => {
    const g = computeOrbitEllipseGeom(box)
    return { ...g, n: SATELLITES.length }
  }, [box.width, box.height])

  const satellites = useMemo(() => {
    const { satRx, satRy, n } = orbitGeom
    return SATELLITES.map((s, i) => {
      const ang = -Math.PI / 2 + (i * 2 * Math.PI) / n
      const x = Math.cos(ang) * satRx
      const y = Math.sin(ang) * satRy
      return { ...s, x, y }
    })
  }, [orbitGeom])

  /** No-op: kept so sheet children can cancel any future delayed-close logic on enter. */
  const cancelClose = useCallback(() => {}, [])

  /** Close orbit menus as soon as the pointer leaves the cluster (not when moving between satellites and sheets). */
  const handleOrbitRootPointerLeave = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const root = e.currentTarget
    const next = e.relatedTarget as Node | null
    if (next && root.contains(next)) return
    setOpenPanel(null)
  }, [])

  useLayoutEffect(() => {
    if (!openPanel) return
    const sheet = sheetRef.current
    const root =
      (sheet?.closest('.mf-canvas') as HTMLElement | null) ??
      (sheet?.closest('.mm-canvas-board') as HTMLElement | null)
    if (!sheet || !root) return
    const ro = new ResizeObserver(() => {
      setLayoutRemeasure((n) => n + 1)
    })
    ro.observe(root)
    ro.observe(sheet)
    return () => ro.disconnect()
  }, [openPanel])

  useLayoutEffect(() => {
    if (!openPanel) {
      setSheetShift({ x: 0, y: 0 })
      return
    }
    const sheet = sheetRef.current
    const root =
      (sheet?.closest('.mf-canvas') as HTMLElement | null) ??
      (sheet?.closest('.mm-canvas-board') as HTMLElement | null)
    if (!sheet || !root) {
      setSheetShift({ x: 0, y: 0 })
      return
    }
    flushSync(() => setSheetShift({ x: 0, y: 0 }))
    const rr = root.getBoundingClientRect()
    const m = CLAMP_MARGIN
    const minL = rr.left + m
    const minT = rr.top + m
    const maxR = rr.right - m
    const maxB = rr.bottom - m
    const sr = sheet.getBoundingClientRect()
    const dx = clampIntervalDelta(sr.left, sr.width, minL, maxR)
    const dy = clampIntervalDelta(sr.top, sr.height, minT, maxB)
    setSheetShift((prev) => (prev.x === dx && prev.y === dy ? prev : { x: dx, y: dy }))
  }, [openPanel, box.width, box.height, orbitViewportClampKey, layoutRemeasure])

  const stop = useCallback((e: React.SyntheticEvent) => {
    e.stopPropagation()
  }, [])

  const sheetAnchor = satellites.find((s) => s.id === openPanel)
  const sheetPositionStyle: React.CSSProperties | undefined =
    openPanel && sheetAnchor
      ? {
          left: `calc(50% + ${sheetAnchor.x * 1.06}px)`,
          top: `calc(50% + ${sheetAnchor.y * 1.06}px)`,
        }
      : undefined

  const sheetShiftStyle: React.CSSProperties | undefined =
    sheetShift.x !== 0 || sheetShift.y !== 0
      ? { transform: `translate(-50%, -50%) translate(${sheetShift.x}px, ${sheetShift.y}px)` }
      : undefined

  const sheetStyle: React.CSSProperties | undefined =
    sheetPositionStyle || sheetShiftStyle ? { ...sheetPositionStyle, ...sheetShiftStyle } : undefined

  const scalePercent = manualRadiusSliderPercent(node)

  return (
    <div
      className='mm-orbit-root'
      onPointerDown={stop}
      onPointerEnter={cancelClose}
      onPointerLeave={handleOrbitRootPointerLeave}
    >
      <div className='mm-orbit-ring' aria-hidden>
        {satellites.map((s) => (
          <button
            key={s.id}
            type='button'
            className={`mm-orbit-sat ${satModifier(s.id)}${openPanel === s.id ? ' mm-orbit-sat--active' : ''}`}
            style={{ left: `calc(50% + ${s.x}px)`, top: `calc(50% + ${s.y}px)` }}
            aria-label={s.label}
            title={s.label}
            onPointerEnter={() => {
              cancelClose()
              setOpenPanel(s.id)
            }}
          >
            <span className='mm-orbit-sat__glyph'>
              <OrbitIcon kind={s.icon} />
            </span>
            <span className='mm-orbit-sat__cap'>{s.caption}</span>
          </button>
        ))}
        <div
          className='mm-orbit-halo-wrap'
          style={{ width: `${orbitGeom.w}px`, height: `${orbitGeom.h}px` }}
        >
          <svg
            className='mm-orbit-halo-svg'
            width='100%'
            height='100%'
            viewBox={`0 0 ${orbitGeom.w} ${orbitGeom.h}`}
          >
            <ellipse
              cx={orbitGeom.cx}
              cy={orbitGeom.cy}
              rx={orbitGeom.ringRx}
              ry={orbitGeom.ringRy}
              fill='none'
              stroke='rgba(100, 116, 139, 0.42)'
              strokeWidth={ORBIT_RING_STROKE_PX}
              strokeDasharray='3 5'
              strokeLinecap='round'
            />
          </svg>
        </div>
      </div>

      {openPanel === 'title' ? (
        <div
          ref={sheetRef}
          className='mm-orbit-sheet mm-orbit-sheet--title'
          style={sheetStyle}
          onPointerDown={stop}
          onPointerEnter={cancelClose}
        >
          <p className='mm-orbit-sheet__preview'>{node.topic?.trim() || 'Untitled'}</p>
          <button type='button' className='mm-orbit-sheet__primary' onClick={onRename}>
            Edit title…
          </button>
        </div>
      ) : null}

      {openPanel === 'fill' ? (
        <OrbitFillSheet
          node={node}
          sheetStyle={sheetStyle}
          sheetRef={sheetRef}
          stop={stop}
          cancelClose={cancelClose}
          onApplyStyleDelta={onApplyStyleDelta}
        />
      ) : null}

      {openPanel === 'textColor' ? (
        <div
          ref={sheetRef}
          className='mm-orbit-sheet mm-orbit-sheet--color'
          style={sheetStyle}
          onPointerDown={stop}
          onPointerEnter={cancelClose}
        >
          <div className='mm-orbit-sheet__chips' role='group' aria-label='Text color'>
            {TEXT_INK_SWATCHES.map((c) => (
              <button
                key={c}
                type='button'
                className={`mm-orbit-chip mm-orbit-chip--ink${textColor === c ? ' is-on' : ''}`}
                style={{ background: c }}
                aria-pressed={textColor === c}
                onClick={() => onApplyStyleDelta({ textColor: c })}
              />
            ))}
            <button
              type='button'
              className='mm-orbit-chip mm-orbit-chip--reset'
              title='Default ink'
              onClick={() => onApplyStyleDelta({ textColor: null })}
            >
              Auto
            </button>
          </div>
        </div>
      ) : null}

      {openPanel === 'fontSize' ? (
        <div
          ref={sheetRef}
          className='mm-orbit-sheet mm-orbit-sheet--size'
          style={sheetStyle}
          onPointerDown={stop}
          onPointerEnter={cancelClose}
        >
          <label className='mm-orbit-sheet__label'>
            <span>Size</span>
            <input
              type='range'
              min={10}
              max={24}
              value={fontSizePx}
              onChange={(e) => onApplyStyleDelta({ fontSizePx: Number(e.target.value), fontAuto: false })}
            />
          </label>
          <button
            type='button'
            className='mm-orbit-sheet__ghost'
            onClick={() => onApplyStyleDelta({ fontAuto: true, fontSizePx: null })}
          >
            Auto size
          </button>
        </div>
      ) : null}

      {openPanel === 'font' ? (
        <div
          ref={sheetRef}
          className='mm-orbit-sheet mm-orbit-sheet--fontfam'
          style={sheetStyle}
          onPointerDown={stop}
          onPointerEnter={cancelClose}
        >
          {(['system', 'serif', 'mono'] as const).map((ff) => (
            <button
              key={ff}
              type='button'
              className={`mm-orbit-pill${fontFamily === ff ? ' is-on' : ''}`}
              onClick={() => onApplyStyleDelta({ fontFamily: ff })}
            >
              {ff}
            </button>
          ))}
        </div>
      ) : null}

      {openPanel === 'scale' ? (
        <div
          ref={sheetRef}
          className='mm-orbit-sheet mm-orbit-sheet--size'
          style={sheetStyle}
          onPointerDown={stop}
          onPointerEnter={cancelClose}
        >
          <label className='mm-orbit-sheet__label'>
            <span>Scale</span>
            <input
              type='range'
              min={0}
              max={100}
              step={1}
              value={scalePercent}
              onChange={(e) =>
                onApplyStyleDelta({ radiusPx: manualRadiusPxFromSliderPercent(Number(e.target.value)) })
              }
            />
          </label>
        </div>
      ) : null}

      {openPanel === 'layout' ? (
        <div
          ref={sheetRef}
          className='mm-orbit-sheet mm-orbit-sheet--auto'
          style={sheetStyle}
          onPointerDown={stop}
          onPointerEnter={cancelClose}
        >
          <p className='mm-orbit-sheet__hint'>Fit the node from its text again.</p>
          <button
            type='button'
            className='mm-orbit-sheet__primary'
            onClick={() => onApplyStyleDelta({ clearManualRadius: true })}
          >
            Use auto layout
          </button>
        </div>
      ) : null}
    </div>
  )
}
