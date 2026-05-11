/**
 * Logical canvas dimensions used by the agent layout engine. The viewport
 * pans/zooms freely, so these numbers are just a reference frame for AI-
 * generated positions — users can drag nodes to any (positive or negative)
 * coordinate they like; nothing in the UI clamps them.
 */
export const CANVAS_W = 12000
export const CANVAS_H = 7200
export const GRID_SNAP = 4

export function snapCoord(value: number): number {
  return Math.round(value / GRID_SNAP) * GRID_SNAP
}
