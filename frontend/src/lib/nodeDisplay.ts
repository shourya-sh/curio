import type { NodeOut } from './api'

/** Logical radius in canvas units (stored in subtopics.radiusPx). */
export const DEFAULT_NODE_RADIUS = 56
export const MIN_NODE_RADIUS = 28
export const MAX_NODE_RADIUS = 100
export const MIN_NODE_WIDTH = 112
export const MAX_NODE_WIDTH = 328
export const MIN_NODE_HEIGHT = 66
export const MAX_NODE_HEIGHT = 132

export type NodeBoxPx = {
  width: number
  height: number
  radius: number
  fontSize: number
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

export function readNodeBoxPx(n: NodeOut): NodeBoxPx {
  const manualRadius = explicitRadius(n)
  if (manualRadius != null) {
    return {
      width: manualRadius * 2,
      height: manualRadius * 2,
      radius: manualRadius,
      fontSize: clamp(Math.round(manualRadius * 0.25), 11, 18),
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
  const width = clamp(Math.round(topicChars * 8.8 + 54 + importance * 0.75), MIN_NODE_WIDTH, MAX_NODE_WIDTH)
  const height = clamp(
    Math.round(68 + Math.min(30, contentWeight * 0.42) + Math.max(0, 2 - n.depth) * 8),
    MIN_NODE_HEIGHT,
    MAX_NODE_HEIGHT,
  )
  const fontSize = clamp(Math.round(15.5 - Math.max(0, topicChars - 22) * 0.08 + Math.max(0, 2 - n.depth) * 0.7), 12, 18)
  return {
    width,
    height,
    radius: Math.max(width, height) / 2,
    fontSize,
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
