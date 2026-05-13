import type { NodeBoxPx } from './nodeDisplay'

/** Dashed ring stroke width (must match SVG `strokeWidth` in `NodeOrbitCluster`). */
export const ORBIT_RING_STROKE_PX = 1.1

const RING_PATH_INSET = ORBIT_RING_STROKE_PX / 2 + 0.35

/** Satellite centers sit on an ellipse this many canvas px beyond the ring (per semi-axis). */
export const ORBIT_SAT_ORBIT_AXIS_OUTSET = 11

export type OrbitEllipseGeom = {
  w: number
  h: number
  cx: number
  cy: number
  ringRx: number
  ringRy: number
  satRx: number
  satRy: number
}

/** Ring hugs the node's pill; satellites use a slightly larger concentric ellipse. */
export function computeOrbitEllipseGeom(box: Pick<NodeBoxPx, 'width' | 'height'>): OrbitEllipseGeom {
  const w = Math.max(1, box.width)
  const h = Math.max(1, box.height)
  const hw = w / 2
  const hh = h / 2
  const ringRx = Math.max(4, hw - RING_PATH_INSET)
  const ringRy = Math.max(4, hh - RING_PATH_INSET)
  const satRx = ringRx + ORBIT_SAT_ORBIT_AXIS_OUTSET
  const satRy = ringRy + ORBIT_SAT_ORBIT_AXIS_OUTSET
  return {
    w,
    h,
    cx: hw,
    cy: hh,
    ringRx,
    ringRy,
    satRx,
    satRy,
  }
}

/**
 * Axis-aligned half-extents from the node center that cover satellite glyphs + captions,
 * for transient hover layout (see `hoverOrbitClearance`).
 */
export function orbitHoverHullHalfExtents(box: Pick<NodeBoxPx, 'width' | 'height'>): { hw: number; hh: number } {
  const { satRx, satRy } = computeOrbitEllipseGeom(box)
  const glyphPad = 20
  const captionPad = 12
  return { hw: satRx + glyphPad, hh: satRy + glyphPad + captionPad }
}
