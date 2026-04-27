/** Human-readable "last activity" line with local date and time of day. */
export function formatSessionUpdatedAt(
  updatedAt?: string | null,
  createdAt?: string | null,
): string {
  const raw = updatedAt ?? createdAt ?? ''
  const parsed = new Date(raw)
  if (Number.isNaN(parsed.getTime())) {
    return 'Recently updated'
  }

  const datePart = parsed.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
  const timePart = parsed.toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  })

  return `Updated ${datePart} at ${timePart}`
}
