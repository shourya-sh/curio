import type { NodeOut } from './api'

/** Logical radius in canvas units (stored in subtopics.radiusPx). */
export const DEFAULT_NODE_RADIUS = 56
export const MIN_NODE_RADIUS = 28
export const MAX_NODE_RADIUS = 100

export function readNodeRadiusPx(n: NodeOut): number {
  const st = n.subtopics
  if (st && typeof st === 'object' && !Array.isArray(st) && 'radiusPx' in st) {
    const v = Number((st as { radiusPx: unknown }).radiusPx)
    if (Number.isFinite(v)) {
      return Math.min(MAX_NODE_RADIUS, Math.max(MIN_NODE_RADIUS, v))
    }
  }
  return DEFAULT_NODE_RADIUS
}

export function radiusToSubtopics(r: number): Record<string, number> {
  const clamped = Math.min(MAX_NODE_RADIUS, Math.max(MIN_NODE_RADIUS, r))
  return { radiusPx: clamped }
}
