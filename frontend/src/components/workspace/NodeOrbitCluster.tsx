import { useCallback, useMemo } from 'react'
import type { NodeOut } from '../../lib/api'
import { MAX_NODE_RADIUS, MIN_NODE_RADIUS, readNodeBoxPx, readNodeRadiusPx, type NodeBoxPx } from '../../lib/nodeDisplay'
import { NODE_TINT_CHOICES } from './NodeColorField'

export type OrbitStylePatch = {
  color?: string | null
  radiusPx?: number
  fontSizePx?: number
  fontAuto?: boolean
  fontFamily?: string | null
  clearManualRadius?: boolean
}

export type OrbitPanelId = 'color' | 'size' | 'fontSize' | 'font' | 'autoLayout'

type Props = {
  node: NodeOut
  box: NodeBoxPx
  openPanel: OrbitPanelId | null
  onOpenPanel: (id: OrbitPanelId | null) => void
  onApply: (patch: OrbitStylePatch) => void
  onRename: () => void
}

const ORBIT_PAD = 8
const SAT_R = 13

const SATELLITES: { id: OrbitPanelId | 'rename'; label: string; icon: 'drop' | 'size' | 'aa' | 'font' | 'pen' | 'spark' }[] = [
  { id: 'color', label: 'Color', icon: 'drop' },
  { id: 'size', label: 'Size', icon: 'size' },
  { id: 'fontSize', label: 'Text size', icon: 'aa' },
  { id: 'font', label: 'Font', icon: 'font' },
  { id: 'rename', label: 'Rename', icon: 'pen' },
  { id: 'autoLayout', label: 'Auto size', icon: 'spark' },
]

function Icon({ kind }: { kind: (typeof SATELLITES)[number]['icon'] }) {
  const stroke = { stroke: 'currentColor', fill: 'none', strokeWidth: 1.6, strokeLinecap: 'round' as const }
  if (kind === 'drop')
    return (
      <svg width='12' height='12' viewBox='0 0 24 24' aria-hidden>
        <path d='M12 3C8 8 5 12 5 15a7 7 0 0 0 14 0c0-3-3-7-7-12z' {...stroke} />
      </svg>
    )
  if (kind === 'size')
    return (
      <svg width='12' height='12' viewBox='0 0 24 24' aria-hidden>
        <circle cx='9' cy='9' r='5' {...stroke} />
        <circle cx='15' cy='15' r='3' {...stroke} />
      </svg>
    )
  if (kind === 'aa')
    return (
      <svg width='12' height='12' viewBox='0 0 24 24' aria-hidden>
        <text x='4' y='16' fontSize='14' fontWeight='700' fill='currentColor' stroke='none'>
          A
        </text>
      </svg>
    )
  if (kind === 'font')
    return (
      <svg width='12' height='12' viewBox='0 0 24 24' aria-hidden>
        <path d='M5 19h3l1.2-3h6.6l1.2 3h3L13 5h-2L5 19zm6.5-5.5L12 8.2l.5 5.3h-2z' fill='currentColor' stroke='none' />
      </svg>
    )
  if (kind === 'pen')
    return (
      <svg width='12' height='12' viewBox='0 0 24 24' aria-hidden>
        <path d='M4 20h4l10-10-4-4L4 16v4z' {...stroke} />
        <path d='m14 6 4 4' {...stroke} />
      </svg>
    )
  return (
    <svg width='12' height='12' viewBox='0 0 24 24' aria-hidden>
      <path d='M6 14l6-8 6 8M8 14h8' {...stroke} />
    </svg>
  )
}

export function NodeOrbitCluster({ node, box, openPanel, onOpenPanel, onApply, onRename }: Props) {
  const styleRec = useMemo(() => {
    const st = node.subtopics
    if (st && typeof st === 'object' && !Array.isArray(st)) return st as Record<string, unknown>
    return null
  }, [node.subtopics])

  const fontSizePx = typeof styleRec?.fontSizePx === 'number' ? Math.round(styleRec.fontSizePx) : readNodeBoxPx(node).fontSize
  const fontFamily = (styleRec?.fontFamily as string | undefined) ?? 'system'

  const radiusVal = readNodeRadiusPx(node)

  const satellites = useMemo(() => {
    const n = SATELLITES.length
    const rx = box.width / 2 + ORBIT_PAD + SAT_R
    const ry = box.height / 2 + ORBIT_PAD + SAT_R
    return SATELLITES.map((s, i) => {
      const ang = -Math.PI / 2 + (i * 2 * Math.PI) / n
      const x = Math.cos(ang) * rx
      const y = Math.sin(ang) * ry
      return { ...s, x, y }
    })
  }, [box.width, box.height])

  const stop = useCallback((e: React.SyntheticEvent) => {
    e.stopPropagation()
  }, [])

  const sheetAngle = satellites.find((s) => s.id === openPanel)
  const sheetStyle: React.CSSProperties | undefined =
    openPanel && sheetAngle
      ? {
          left: `calc(50% + ${sheetAngle.x * 1.85}px)`,
          top: `calc(50% + ${sheetAngle.y * 1.85}px)`,
        }
      : undefined

  return (
    <div className='mm-orbit-root' onPointerDown={stop}>
      <div className='mm-orbit-ring' aria-hidden>
        {satellites.map((s) => (
          <button
            key={s.id}
            type='button'
            className={`mm-orbit-sat${openPanel === s.id ? ' mm-orbit-sat--active' : ''}`}
            style={{ left: `calc(50% + ${s.x}px)`, top: `calc(50% + ${s.y}px)` }}
            aria-label={s.label}
            title={s.label}
            onPointerDown={stop}
            onClick={(e) => {
              e.stopPropagation()
              if (s.id === 'rename') {
                onRename()
                return
              }
              onOpenPanel(openPanel === s.id ? null : s.id)
            }}
          >
            <Icon kind={s.icon} />
          </button>
        ))}
      </div>

      {openPanel === 'color' ? (
        <div className='mm-orbit-sheet mm-orbit-sheet--color' style={sheetStyle} onPointerDown={stop}>
          <div className='mm-orbit-sheet__chips' role='group' aria-label='Tint'>
            {NODE_TINT_CHOICES.map((c) => (
              <button
                key={c}
                type='button'
                className={`mm-orbit-chip${node.color === c ? ' is-on' : ''}`}
                style={{ background: c }}
                aria-pressed={node.color === c}
                onClick={() => onApply({ color: c })}
              />
            ))}
          </div>
        </div>
      ) : null}

      {openPanel === 'size' ? (
        <div className='mm-orbit-sheet mm-orbit-sheet--size' style={sheetStyle} onPointerDown={stop}>
          <label className='mm-orbit-sheet__label'>
            <span>Radius</span>
            <input
              type='range'
              min={MIN_NODE_RADIUS}
              max={MAX_NODE_RADIUS}
              value={Math.min(MAX_NODE_RADIUS, Math.max(MIN_NODE_RADIUS, Math.round(radiusVal)))}
              onChange={(e) => onApply({ radiusPx: Number(e.target.value) })}
            />
          </label>
        </div>
      ) : null}

      {openPanel === 'fontSize' ? (
        <div className='mm-orbit-sheet mm-orbit-sheet--font' style={sheetStyle} onPointerDown={stop}>
          <label className='mm-orbit-sheet__label'>
            <span>Size</span>
            <input
              type='range'
              min={10}
              max={22}
              value={fontSizePx}
              onChange={(e) => onApply({ fontSizePx: Number(e.target.value), fontAuto: false })}
            />
          </label>
          <button type='button' className='mm-orbit-sheet__ghost' onClick={() => onApply({ fontAuto: true })}>
            Auto
          </button>
        </div>
      ) : null}

      {openPanel === 'font' ? (
        <div className='mm-orbit-sheet mm-orbit-sheet--fontfam' style={sheetStyle} onPointerDown={stop}>
          {(['system', 'serif', 'mono'] as const).map((ff) => (
            <button
              key={ff}
              type='button'
              className={`mm-orbit-pill${fontFamily === ff ? ' is-on' : ''}`}
              onClick={() => onApply({ fontFamily: ff })}
            >
              {ff}
            </button>
          ))}
        </div>
      ) : null}

      {openPanel === 'autoLayout' ? (
        <div className='mm-orbit-sheet mm-orbit-sheet--auto' style={sheetStyle} onPointerDown={stop}>
          <p className='mm-orbit-sheet__hint'>Drop manual circle and fit from text again.</p>
          <button type='button' className='mm-orbit-sheet__primary' onClick={() => onApply({ clearManualRadius: true })}>
            Use auto layout
          </button>
        </div>
      ) : null}
    </div>
  )
}
