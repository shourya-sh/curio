import type { LinkCreatePayload, NodeCreatePayload, NodeOut, SessionMode } from './api'
import { mergeSubtopicsForPersist } from './nodeSubtopicsMerge'
import { radiusToSubtopics } from './nodeDisplay'

export type ManualNodeDraft = {
  topic?: string
  centerX: number
  centerY: number
  radiusPx: number
  color?: string | null
}

export function buildManualNodePayload(mode: SessionMode, draft: ManualNodeDraft): NodeCreatePayload {
  return {
    topic: draft.topic?.trim() || 'New node',
    summary: mode === 'plan' ? 'Planning note' : 'Research note',
    position_x: draft.centerX,
    position_y: draft.centerY,
    color: draft.color ?? null,
    subtopics: radiusToSubtopics(draft.radiusPx),
  }
}

export function buildManualLinkPayload(fromId: number, toId: number): LinkCreatePayload | null {
  if (fromId === toId) return null
  return { parent_id: fromId, child_id: toId }
}

/** Style fields stored in `subtopics` JSON alongside topic bullets. */
export type NodeStyleDelta = {
  radiusPx?: number
  fontSizePx?: number | null
  fontAuto?: boolean
  fontFamily?: string | null
  textColor?: string | null
}

/**
 * Build a partial node update from style deltas, merging into existing `subtopics`
 * so topic bullets and other keys are never wiped.
 */
export function buildNodeUpdateFromStyleDelta(node: NodeOut, delta: NodeStyleDelta & { color?: string | null }): Partial<NodeOut> {
  const out: Partial<NodeOut> = {}
  if (Object.prototype.hasOwnProperty.call(delta, 'color')) {
    out.color = delta.color ?? null
  }

  const clearRadius = (delta as { clearManualRadius?: boolean }).clearManualRadius === true
  const styleDelta: Record<string, unknown> = {}
  if (typeof delta.radiusPx === 'number') styleDelta.radiusPx = delta.radiusPx
  if (Object.prototype.hasOwnProperty.call(delta, 'fontSizePx')) {
    styleDelta.fontSizePx = delta.fontSizePx
  }
  if (typeof delta.fontAuto === 'boolean') styleDelta.fontAuto = delta.fontAuto
  if (Object.prototype.hasOwnProperty.call(delta, 'fontFamily')) {
    styleDelta.fontFamily = delta.fontFamily === undefined ? null : delta.fontFamily
  }
  if (Object.prototype.hasOwnProperty.call(delta, 'textColor')) {
    styleDelta.textColor = delta.textColor === undefined ? null : delta.textColor
  }

  const hasStyleKeys = Object.keys(styleDelta).length > 0 || clearRadius
  if (hasStyleKeys) {
    out.subtopics = mergeSubtopicsForPersist(node.subtopics, styleDelta, clearRadius ? { clearRadius: true } : undefined)
  }

  return out
}

/** @deprecated Prefer `buildNodeUpdateFromStyleDelta` with the current node row. */
export function buildNodeStylePatch(
  node: NodeOut,
  style: { color?: string | null; radiusPx?: number },
): Partial<NodeOut> {
  return buildNodeUpdateFromStyleDelta(node, style)
}
