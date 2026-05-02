/** Path segment for `/workspace/...` — prefers slug when present (legacy URLs may use numeric id). */
export function workspacePathSegment(session: { id: number; slug?: string }): string {
  const s = session.slug?.trim()
  if (s) return s
  return String(session.id)
}
