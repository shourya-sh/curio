import type { NodeOut } from './api'

/** Logical radius in canvas units (stored in subtopics.radiusPx). */
export const DEFAULT_NODE_RADIUS = 56
export const MIN_NODE_RADIUS = 28
export const MAX_NODE_RADIUS = 100
export const MIN_NODE_WIDTH = 112
export const MAX_NODE_WIDTH = 560
export const MIN_NODE_HEIGHT = 66
/** Auto pill height ceiling (many wrapped lines); sizing is canvas-relative, not viewport %. */
export const MAX_NODE_HEIGHT = 520

const HORIZONTAL_PAD = 44
/** Average glyph width vs font-size for bold UI sans (wrap estimate). */
const AVG_CHAR_EM = 0.58
/** Matches `.mm-orb__text` line-height. */
const LINE_HEIGHT_FACTOR = 1.08
const VERTICAL_PAD = 30

export type NodeBoxPx = {
  width: number
  height: number
  radius: number
  fontSize: number
  lines: number
  manual: boolean
}

function explicitRadius(n: NodeOut): number | null {
  const st = n.subtopics
  if (st && typeof st === 'object' && !Array.isArray(st) && 'radiusPx' in st) {
    const v = Number((st as { radiusPx: unknown }).radiusPx)
    if (Number.isFinite(v)) {
      return Math.min(MAX_NODE_RADIUS, Math.max(MIN_NODE_RADIUS, v))
    }
  }
  return null
}

function subtopicCount(value: unknown): number {
  if (Array.isArray(value)) return value.length
  if (value && typeof value === 'object') return Object.keys(value as Record<string, unknown>).length
  if (typeof value === 'string' && value.trim()) return 1
  return 0
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function charsPerLineForWidth(widthPx: number, fontSize: number): number {
  const charPx = fontSize * AVG_CHAR_EM
  const inner = Math.max(48, widthPx - HORIZONTAL_PAD)
  return Math.max(6, Math.floor(inner / Math.max(4, charPx)))
}

export function readNodeBoxPx(n: NodeOut): NodeBoxPx {
  const manualRadius = explicitRadius(n)
  if (manualRadius != null) {
    return {
      width: manualRadius * 2,
      height: manualRadius * 2,
      radius: manualRadius,
      fontSize: clamp(Math.round(manualRadius * 0.25), 11, 18),
      lines: 2,
      manual: true,
    }
  }

  const topic = (n.topic || '').trim()
  const topicChars = topic.length
  const contentWeight =
    Math.min(26, (n.summary?.length ?? 0) / 10) +
    Math.min(34, (n.details?.length ?? 0) / 24) +
    subtopicCount(n.subtopics) * 5
  const depthWeight = Math.max(0, 3 - n.depth) * 9
  const importance = depthWeight + contentWeight
  const fontSize = clamp(
    Math.round(16 - Math.max(0, topicChars - 34) * 0.045 + Math.max(0, 2 - n.depth) * 0.65),
    12,
    18,
  )
  const widthBonus = Math.min(40, importance * 0.45)

  let width: number
  let lines: number

  if (topicChars === 0) {
    width = MIN_NODE_WIDTH
    lines = 1
  } else {
    const singleLineW = Math.round(topicChars * fontSize * 0.62 + HORIZONTAL_PAD + widthBonus)
    width = clamp(
      singleLineW <= MAX_NODE_WIDTH ? singleLineW : Math.ceil(singleLineW / 1.72),
      MIN_NODE_WIDTH,
      MAX_NODE_WIDTH,
    )
    const cpl = charsPerLineForWidth(width, fontSize)
    lines = Math.max(1, Math.ceil(topicChars / cpl))
  }

  const lineBlock = lines * fontSize * LINE_HEIGHT_FACTOR
  const height = clamp(
    Math.round(
      VERTICAL_PAD + lineBlock + Math.min(22, contentWeight * 0.26) + Math.max(0, 2 - n.depth) * 6,
    ),
    MIN_NODE_HEIGHT,
    MAX_NODE_HEIGHT,
  )
  return {
    width,
    height,
    radius: Math.max(width, height) / 2,
    fontSize,
    lines,
    manual: false,
  }
}

export function readNodeRadiusPx(n: NodeOut): number {
  return readNodeBoxPx(n).radius
}

export function radiusToSubtopics(r: number): Record<string, number> {
  const clamped = Math.min(MAX_NODE_RADIUS, Math.max(MIN_NODE_RADIUS, r))
  return { radiusPx: clamped }
}
