/** User-facing labels for streamed `tool_used` names from the AI pipeline. */
export function humanizeAgentToolName(tool: string): string {
  const t = tool.trim()
  if (!t) return 'Tool'
  const map: Record<string, string> = {
    graph_add_node: 'Add topic node',
    graph_add_link: 'Connect nodes',
    graph_update_node: 'Update node',
    graph_delete_node: 'Remove node',
    read_file: 'Read context',
    web_search: 'Web search',
    search: 'Search',
  }
  if (map[t]) return map[t]
  return t
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
}

export function isAbortError(error: unknown): boolean {
  return (
    (error instanceof DOMException && error.name === 'AbortError') ||
    (error instanceof Error && error.name === 'AbortError')
  )
}
