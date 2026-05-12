/** Keys persisted alongside optional `topics` bullet list in `nodes.subtopics` JSONB. */
export const STYLE_KEYS = new Set(['radiusPx', 'fontSizePx', 'fontAuto', 'fontFamily'])

function topicStringsFromArray(arr: unknown[]): string[] {
  return arr
    .map((item) => {
      if (typeof item === 'string') return item
      if (item && typeof item === 'object') {
        const record = item as Record<string, unknown>
        const label = record.title ?? record.topic ?? record.label ?? record.name
        const text = record.summary ?? record.details ?? record.description
        return [label, text].filter(Boolean).join(': ')
      }
      return String(item)
    })
    .filter(Boolean) as string[]
}

/** Bullet strings for layout weighting and UI (matches panel `renderSubtopics` semantics). */
export function extractTopicList(subtopics: unknown): string[] {
  if (Array.isArray(subtopics)) {
    return topicStringsFromArray(subtopics)
  }
  if (subtopics && typeof subtopics === 'object') {
    const o = subtopics as Record<string, unknown>
    if (Array.isArray(o.topics)) {
      return o.topics.filter((x): x is string => typeof x === 'string' && x.length > 0)
    }
  }
  return []
}

function extractStyleMap(subtopics: unknown): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  if (!subtopics || typeof subtopics !== 'object' || Array.isArray(subtopics)) return out
  const o = subtopics as Record<string, unknown>
  for (const k of Object.keys(o)) {
    if (STYLE_KEYS.has(k)) out[k] = o[k]
  }
  return out
}

export type StyleDelta = Record<string, unknown>

/**
 * Merge AI / user topic bullets with style keys. Never drops `topics` when applying radius/color/font patches.
 */
export function mergeSubtopicsForPersist(
  existing: unknown,
  styleDelta: StyleDelta,
  opts?: { clearRadius?: boolean },
): unknown {
  let topics = extractTopicList(existing)
  const delta = { ...styleDelta } as Record<string, unknown>
  if ('topics' in delta && Array.isArray(delta.topics)) {
    topics = (delta.topics as unknown[]).filter((x): x is string => typeof x === 'string')
    delete delta.topics
  }
  const style = extractStyleMap(existing)
  if (opts?.clearRadius) {
    delete style.radiusPx
  }
  for (const [k, v] of Object.entries(delta)) {
    if (!STYLE_KEYS.has(k)) continue
    if (v === undefined || v === null) {
      delete style[k]
    } else {
      style[k] = v
    }
  }
  const hasTopics = topics.length > 0
  const styleKeys = Object.keys(style).filter((k) => style[k] !== undefined)
  if (hasTopics) {
    return { topics, ...style }
  }
  if (styleKeys.length === 0) {
    return []
  }
  return style
}

/** For `readNodeBoxPx` content weight — counts bullets only, not style keys. */
export function subtopicCountForWeight(subtopics: unknown): number {
  if (Array.isArray(subtopics)) return subtopics.length
  if (subtopics && typeof subtopics === 'object') {
    const o = subtopics as Record<string, unknown>
    if (Array.isArray(o.topics)) return o.topics.length
    return Object.keys(o).filter((k) => !STYLE_KEYS.has(k) && k !== 'topics').length
  }
  if (typeof subtopics === 'string' && subtopics.trim()) return 1
  return 0
}
