import type { NodeOut } from './api'

/** Logical radius in canvas units (stored in subtopics.radiusPx). */
export const DEFAULT_NODE_RADIUS = 56
export const MIN_NODE_RADIUS = 28
/** Global upper bound for manual circle radius and place-node sizing (canvas px). */
export const GLOBAL_MAX_MANUAL_RADIUS = 120
/** @deprecated alias */
export const MAX_NODE_RADIUS = GLOBAL_MAX_MANUAL_RADIUS
export const MIN_MANUAL_RADIUS = MIN_NODE_RADIUS

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

export type NodeStyleSidecar = {
  fontSizePx?: number
  fontAuto?: boolean
  fontFamily?: string
  textColor?: string | null
}

export type NodeBoxPx = {
  width: number
  height: number
  radius: number
  fontSize: number
  lines: number
  manual: boolean
  /** When set, overrides default ink on the topic label. */
  labelColor?: string
  /** CSS `font-family` stack for the topic label. */
  fontFamilyCss: string
}

function readStyleSidecar(n: NodeOut): NodeStyleSidecar {
  const st = n.subtopics
  if (!st || typeof st !== 'object' || Array.isArray(st)) return {}
  const o = st as Record<string, unknown>
  const textColor =
    'textColor' in o
      ? typeof o.textColor === 'string'
        ? o.textColor
        : o.textColor === null
          ? null
          : undefined
      : undefined
  return {
    fontSizePx: typeof o.fontSizePx === 'number' ? o.fontSizePx : undefined,
    fontAuto: typeof o.fontAuto === 'boolean' ? o.fontAuto : undefined,
    fontFamily: typeof o.fontFamily === 'string' ? o.fontFamily : undefined,
    textColor,
  }
}

export function readNodeStyleSidecar(n: NodeOut): NodeStyleSidecar {
  return readStyleSidecar(n)
}

function fontFamilyCss(side: NodeStyleSidecar): string {
  const ff = side.fontFamily ?? 'system'
  if (ff === 'serif') return 'Georgia, "Times New Roman", serif'
  if (ff === 'mono') return 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace'
  return 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif'
}

function labelColorFromSidecar(side: NodeStyleSidecar): string | undefined {
  if (typeof side.textColor !== 'string' || !side.textColor.trim()) return undefined
  const c = side.textColor.trim()
  if (!/^#[0-9A-Fa-f]{6}$/i.test(c)) return undefined
  return c.startsWith('#') ? c : `#${c}`
}

function explicitRadius(n: NodeOut): number | null {
  const st = n.subtopics
  if (st && typeof st === 'object' && !Array.isArray(st) && 'radiusPx' in st) {
    const v = Number((st as { radiusPx: unknown }).radiusPx)
    if (Number.isFinite(v)) {
      return Math.min(GLOBAL_MAX_MANUAL_RADIUS, Math.max(MIN_NODE_RADIUS, v))
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

function resolveFontSize(baseAuto: number, side: NodeStyleSidecar, manualRadius?: number): number {
  if (side.fontAuto === false && typeof side.fontSizePx === 'number') {
    return clamp(Math.round(side.fontSizePx), 10, 24)
  }
  if (manualRadius != null) {
    return clamp(Math.round(manualRadius * 0.25), 11, 18)
  }
  return clamp(Math.round(baseAuto), 12, 18)
}

export function readNodeBoxPx(n: NodeOut): NodeBoxPx {
  const side = readStyleSidecar(n)
  const fontStack = fontFamilyCss(side)
  const labelColor = labelColorFromSidecar(side)

  const manualRadius = explicitRadius(n)
  if (manualRadius != null) {
    const baseFromRadius = clamp(Math.round(manualRadius * 0.25), 11, 18)
    const fontSize = resolveFontSize(baseFromRadius, side, manualRadius)
    return {
      width: manualRadius * 2,
      height: manualRadius * 2,
      radius: manualRadius,
      fontSize,
      lines: 2,
      manual: true,
      fontFamilyCss: fontStack,
      ...(labelColor ? { labelColor } : {}),
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
  const baseFont = clamp(
    Math.round(16 - Math.max(0, topicChars - 34) * 0.045 + Math.max(0, 2 - n.depth) * 0.65),
    12,
    18,
  )
  const fontSize = resolveFontSize(baseFont, side)
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
    fontFamilyCss: fontStack,
    ...(labelColor ? { labelColor } : {}),
  }
}

export function readNodeRadiusPx(n: NodeOut): number {
  return readNodeBoxPx(n).radius
}

export function radiusToSubtopics(r: number): Record<string, number> {
  const clamped = Math.min(GLOBAL_MAX_MANUAL_RADIUS, Math.max(MIN_NODE_RADIUS, Math.round(r)))
  return { radiusPx: clamped }
}

/** 0–100 slider value for manual radius (UI). */
export function manualRadiusSliderPercent(n: NodeOut): number {
  const min = MIN_NODE_RADIUS
  const max = GLOBAL_MAX_MANUAL_RADIUS
  const span = max - min
  const rStored = explicitRadius(n)
  const r = rStored ?? Math.min(max, readNodeBoxPx(n).radius)
  return clamp(Math.round(((r - min) / span) * 100), 0, 100)
}

export function manualRadiusPxFromSliderPercent(percent: number): number {
  const t = clamp(percent, 0, 100) / 100
  return Math.round(MIN_NODE_RADIUS + t * (GLOBAL_MAX_MANUAL_RADIUS - MIN_NODE_RADIUS))
}
