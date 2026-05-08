import { supabase } from './supabase'

export type SessionMode = 'research' | 'plan'

function resolveApiBase(): string {
  const envBase = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.trim()
  if (envBase) return envBase.replace(/\/+$/, '')

  if (typeof window !== 'undefined') {
    const host = window.location.hostname || 'localhost'
    return `http://${host}:8000`
  }

  return 'http://localhost:8000'
}

const API_BASE = resolveApiBase()

/**
 * Module-level token cache — updated by AuthContext via setAccessToken().
 * This avoids race conditions where supabase.auth.getSession() returns null
 * briefly after page load even when the user is authenticated.
 */
let _accessToken: string | null = null

/** Called by AuthContext whenever the session changes. */
export function setAccessToken(token: string | null) {
  _accessToken = token
}

export async function getAuthHeaders(): Promise<Record<string, string>> {
  // Prefer the cached token (set by AuthContext, always in sync with auth state)
  if (_accessToken) {
    return { Authorization: `Bearer ${_accessToken}` }
  }
  // Fallback: try supabase directly (covers edge cases during init)
  const { data: { session } } = await supabase.auth.getSession()
  if (!session?.access_token) return {}
  return { Authorization: `Bearer ${session.access_token}` }
}

interface SessionCreatePayload {
  title: string
  mode: SessionMode
  /** Used for slug when title slugifies to empty (e.g. first prompt). */
  slug_source?: string
}

export interface SessionPromptPayload {
  prompt: string
  anchor_node_id?: number | null
}

export interface NodeOut {
  id: number
  session_id: number
  topic: string
  summary?: string | null
  details?: string | null
  subtopics?: unknown
  depth: number
  position_x: number
  position_y: number
  /** Agent / canonical layout; dragging only changes position_x/y. */
  original_position_x?: number
  original_position_y?: number
  node_type: string
  color?: string | null
  created_at: string
  updated_at: string
}

export type LinkLineStyle = 'solid' | 'dashed' | 'dotted' | 'bold'

export interface LinkOut {
  id: number
  session_id: number
  parent_id: number
  child_id: number
  color?: string | null
  line_style?: LinkLineStyle | string | null
  created_at: string
}

export interface NodeRestorePayload {
  node: NodeOut
  links: LinkOut[]
}

export interface MessageOut {
  id: number
  session_id: number
  role: string
  content: string
  created_at: string
}

export interface SessionDetail {
  id: number
  slug: string
  user_id?: number | null
  title: string
  mode: SessionMode
  created_at: string
  updated_at: string
  nodes: NodeOut[]
  links: LinkOut[]
  messages: MessageOut[]
}

export interface NodeCreatePayload {
  topic: string
  summary?: string
  details?: string
  parent_id?: number
  position_x?: number
  position_y?: number
  original_position_x?: number
  original_position_y?: number
  node_type?: string
  color?: string | null
  /** JSONB: list from AI, or `{ radiusPx }` for manual node size. */
  subtopics?: unknown
}

export interface NodeUpdatePayload {
  topic?: string
  summary?: string | null
  details?: string | null
  position_x?: number
  position_y?: number
  original_position_x?: number
  original_position_y?: number
  node_type?: string
  color?: string | null
  subtopics?: unknown
}

export interface NodeBulkItem {
  id: number
  topic?: string
  summary?: string | null
  details?: string | null
  position_x?: number
  position_y?: number
  original_position_x?: number
  original_position_y?: number
  node_type?: string
  color?: string | null
  subtopics?: unknown
}

export interface NodeBulkUpdatePayload {
  nodes: NodeBulkItem[]
}

export interface LinkCreatePayload {
  parent_id: number
  child_id: number
  color?: string | null
  line_style?: LinkLineStyle | string | null
}

export interface LinkUpdatePayload {
  color?: string | null
  line_style?: LinkLineStyle | string | null
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const authHeaders = await getAuthHeaders()
  let response: Response
  try {
    response = await fetch(`${API_BASE}${path}`, {
      headers: {
        'Content-Type': 'application/json',
        ...authHeaders,
        ...(init?.headers ?? {}),
      },
      ...init,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Network request failed'
    throw new Error(`Cannot reach API at ${API_BASE}${path}. ${message}`)
  }

  if (!response.ok) {
    const body = await response.text()
    throw new Error(body || `Request failed (${response.status})`)
  }

  if (response.status === 204) {
    return undefined as T
  }

  return response.json() as Promise<T>
}

export async function createSession(payload: SessionCreatePayload): Promise<SessionListItem> {
  return request<SessionListItem>('/sessions/', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export async function createNode(
  sessionRef: string | number,
  payload: NodeCreatePayload,
): Promise<NodeOut> {
  return request<NodeOut>(`/sessions/${sessionRef}/nodes/`, {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export async function updateNode(
  sessionRef: string | number,
  nodeId: number,
  payload: NodeUpdatePayload,
): Promise<NodeOut> {
  return request<NodeOut>(`/sessions/${sessionRef}/nodes/${nodeId}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  })
}

export async function bulkUpdateNodes(
  sessionRef: string | number,
  payload: NodeBulkUpdatePayload,
): Promise<{ updated: number[] }> {
  return request<{ updated: number[] }>(`/sessions/${sessionRef}/nodes/`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  })
}

export async function deleteNode(
  sessionRef: string | number,
  nodeId: number,
): Promise<{ detail: string }> {
  return request<{ detail: string }>(`/sessions/${sessionRef}/nodes/${nodeId}`, {
    method: 'DELETE',
  })
}

export async function restoreNode(
  sessionRef: string | number,
  nodeId: number,
  payload: NodeRestorePayload,
): Promise<NodeOut> {
  return request<NodeOut>(`/sessions/${sessionRef}/nodes/${nodeId}/restore`, {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export async function createLink(
  sessionRef: string | number,
  payload: LinkCreatePayload,
): Promise<LinkOut> {
  return request<LinkOut>(`/sessions/${sessionRef}/links/`, {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export async function updateLink(
  sessionRef: string | number,
  linkId: number,
  payload: LinkUpdatePayload,
): Promise<LinkOut> {
  return request<LinkOut>(`/sessions/${sessionRef}/links/${linkId}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  })
}

export async function deleteLink(
  sessionRef: string | number,
  linkId: number,
): Promise<{ detail: string }> {
  return request<{ detail: string }>(`/sessions/${sessionRef}/links/${linkId}`, {
    method: 'DELETE',
  })
}

export async function restoreLink(
  sessionRef: string | number,
  link: LinkOut,
): Promise<LinkOut> {
  return request<LinkOut>(`/sessions/${sessionRef}/links/${link.id}/restore`, {
    method: 'POST',
    body: JSON.stringify(link),
  })
}

export async function getSession(sessionRef: string): Promise<SessionDetail> {
  return request<SessionDetail>(`/sessions/${sessionRef}`)
}

export interface SessionListItem {
  id: number
  slug: string
  title: string
  mode: SessionMode
  created_at: string
  updated_at?: string
}

export async function listSessions(): Promise<SessionListItem[]> {
  return request<SessionListItem[]>('/sessions/')
}

export async function updateSessionTitle(
  sessionRef: string | number,
  title: string,
): Promise<SessionListItem> {
  return request<SessionListItem>(`/sessions/${sessionRef}`, {
    method: 'PATCH',
    body: JSON.stringify({ title }),
  })
}

export async function deleteSession(sessionRef: string | number): Promise<{ detail: string }> {
  return request<{ detail: string }>(`/sessions/${sessionRef}`, {
    method: 'DELETE',
  })
}

export interface ResearchSource {
  title: string
  url?: string
  publisher?: string
  year?: string
  summary?: string
  excerpt?: string
  relevance?: string
  /** Real node ids this source supports (set after graph is persisted). */
  node_ids?: number[]
  /** Topics captured when the source was generated; may differ if the node was renamed. */
  node_topics?: string[]
}

export type SessionPromptEvent =
  | { type: 'status'; data: { message?: string } }
  | { type: 'tool_used'; data: { tool: string; args?: Record<string, unknown> } }
  | { type: 'node_created'; data: NodeOut }
  | { type: 'node_updated'; data: { id: number; session_id: number; position_x: number; position_y: number } }
  | { type: 'node_deleted'; data: { id: number; session_id: number } }
  | { type: 'link_created'; data: LinkOut }
  | { type: 'message_created'; data: MessageOut }
  | {
      type: 'sources_created'
      data: { id?: number; session_id?: number; sources: ResearchSource[]; created_at?: string | null }
    }
  | { type: 'done'; data: Record<string, never> }
  | { type: 'error'; data: { message?: string } }
  | { type: string; data: unknown }

export async function postSessionPromptStream(
  sessionRef: string | number,
  payload: SessionPromptPayload,
  onEvent: (event: SessionPromptEvent) => void,
  options?: { signal?: AbortSignal },
): Promise<void> {
  const authHeaders = await getAuthHeaders()
  const response = await fetch(`${API_BASE}/sessions/${sessionRef}/prompt`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders },
    body: JSON.stringify(payload),
    signal: options?.signal,
  })
  if (!response.ok || !response.body) {
    const body = await response.text()
    throw new Error(body || `Request failed (${response.status})`)
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  const flushFrame = (frame: string) => {
    let eventType = 'message'
    const dataLines: string[] = []
    for (const rawLine of frame.split(/\r?\n/)) {
      if (rawLine.startsWith('event:')) eventType = rawLine.slice(6).trim()
      if (rawLine.startsWith('data:')) dataLines.push(rawLine.slice(5).trim())
    }
    if (dataLines.length === 0) return
    const dataText = dataLines.join('\n')
    const data = dataText ? JSON.parse(dataText) : {}
    onEvent({ type: eventType, data } as SessionPromptEvent)
  }

  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const frames = buffer.split(/\n\n/)
    buffer = frames.pop() ?? ''
    frames.forEach(flushFrame)
  }
  if (buffer.trim()) flushFrame(buffer)
}
