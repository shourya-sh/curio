const STORAGE_KEY = 'curio:recentSessionIds'
const MAX_RECENT = 12

function parseStoredIds(raw: string | null): string[] {
  if (!raw) return []
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((x): x is string => typeof x === 'string')
  } catch {
    return []
  }
}

export function recordSessionOpened(sessionKey: string | number): void {
  const id = String(sessionKey)
  try {
    const existing = parseStoredIds(localStorage.getItem(STORAGE_KEY))
    const next = [id, ...existing.filter((x) => x !== id)].slice(0, MAX_RECENT)
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  } catch {
    /* quota / private mode */
  }
}

/** Recent workspace path segments (slug preferred; may include legacy numeric id strings). */
export function readRecentSessionRefs(): string[] {
  try {
    return parseStoredIds(localStorage.getItem(STORAGE_KEY))
  } catch {
    return []
  }
}

/** @deprecated Use readRecentSessionRefs and match by slug or id. */
export function readRecentSessionIds(): number[] {
  return readRecentSessionRefs()
    .map((s) => Number(s))
    .filter((n) => Number.isFinite(n))
}

export function removeSessionFromRecent(session: { id: number; slug?: string } | string | number): void {
  const drop = new Set<string>()
  if (typeof session === 'object' && session !== null && 'id' in session) {
    drop.add(String(session.id))
    if (session.slug) drop.add(session.slug)
  } else {
    drop.add(String(session))
  }
  try {
    const existing = parseStoredIds(localStorage.getItem(STORAGE_KEY))
    const next = existing.filter((x) => !drop.has(x))
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  } catch {
    /* ignore */
  }
}
