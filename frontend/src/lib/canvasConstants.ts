/**
 * Node positions in the API use logical canvas coordinates: center of the node, in [0, CANVAS_W] × [0, CANVAS_H].
 */
export const CANVAS_W = 3200
export const CANVAS_H = 1800
export const GRID_SNAP = 8

export function snapCoord(value: number): number {
  return Math.round(value / GRID_SNAP) * GRID_SNAP
}
