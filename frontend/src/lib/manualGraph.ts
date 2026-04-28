import type { LinkCreatePayload, NodeCreatePayload, SessionMode } from './api'
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

export function buildNodeStylePatch(style: { color?: string | null; radiusPx?: number }): {
  color?: string | null
  subtopics?: Record<string, number>
} {
  const patch: { color?: string | null; subtopics?: Record<string, number> } = {}
  if (Object.prototype.hasOwnProperty.call(style, 'color')) patch.color = style.color ?? null
  if (typeof style.radiusPx === 'number') patch.subtopics = radiusToSubtopics(style.radiusPx)
  return patch
}
