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

export function recordSessionOpened(sessionId: number | string): void {
  const id = String(sessionId)
  try {
    const existing = parseStoredIds(localStorage.getItem(STORAGE_KEY))
    const next = [id, ...existing.filter((x) => x !== id)].slice(0, MAX_RECENT)
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  } catch {
    /* quota / private mode */
  }
}

export function readRecentSessionIds(): number[] {
  try {
    return parseStoredIds(localStorage.getItem(STORAGE_KEY))
      .map((s) => Number(s))
      .filter((n) => Number.isFinite(n))
  } catch {
    return []
  }
}

export function removeSessionFromRecent(sessionId: number | string): void {
  const id = String(sessionId)
  try {
    const existing = parseStoredIds(localStorage.getItem(STORAGE_KEY))
    const next = existing.filter((x) => x !== id)
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  } catch {
    /* ignore */
  }
}
