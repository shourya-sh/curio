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

interface SessionCreatePayload {
  title: string
  mode: SessionMode
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
  let response: Response
  try {
    response = await fetch(`${API_BASE}${path}`, {
      headers: {
        'Content-Type': 'application/json',
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
  sessionId: number,
  payload: NodeCreatePayload,
): Promise<NodeOut> {
  return request<NodeOut>(`/sessions/${sessionId}/nodes/`, {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export async function updateNode(
  sessionId: number,
  nodeId: number,
  payload: NodeUpdatePayload,
): Promise<NodeOut> {
  return request<NodeOut>(`/sessions/${sessionId}/nodes/${nodeId}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  })
}

export async function bulkUpdateNodes(
  sessionId: number,
  payload: NodeBulkUpdatePayload,
): Promise<{ updated: number[] }> {
  return request<{ updated: number[] }>(`/sessions/${sessionId}/nodes/`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  })
}

export async function deleteNode(
  sessionId: number,
  nodeId: number,
): Promise<{ detail: string }> {
  return request<{ detail: string }>(`/sessions/${sessionId}/nodes/${nodeId}`, {
    method: 'DELETE',
  })
}

export async function restoreNode(
  sessionId: number,
  nodeId: number,
  payload: NodeRestorePayload,
): Promise<NodeOut> {
  return request<NodeOut>(`/sessions/${sessionId}/nodes/${nodeId}/restore`, {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export async function createLink(
  sessionId: number,
  payload: LinkCreatePayload,
): Promise<LinkOut> {
  return request<LinkOut>(`/sessions/${sessionId}/links/`, {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export async function updateLink(
  sessionId: number,
  linkId: number,
  payload: LinkUpdatePayload,
): Promise<LinkOut> {
  return request<LinkOut>(`/sessions/${sessionId}/links/${linkId}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  })
}

export async function deleteLink(
  sessionId: number,
  linkId: number,
): Promise<{ detail: string }> {
  return request<{ detail: string }>(`/sessions/${sessionId}/links/${linkId}`, {
    method: 'DELETE',
  })
}

export async function restoreLink(
  sessionId: number,
  link: LinkOut,
): Promise<LinkOut> {
  return request<LinkOut>(`/sessions/${sessionId}/links/${link.id}/restore`, {
    method: 'POST',
    body: JSON.stringify(link),
  })
}

export async function getSession(sessionId: string): Promise<SessionDetail> {
  return request<SessionDetail>(`/sessions/${sessionId}`)
}

export interface SessionListItem {
  id: number
  title: string
  mode: SessionMode
  created_at: string
  updated_at?: string
}

export async function listSessions(): Promise<SessionListItem[]> {
  return request<SessionListItem[]>('/sessions/')
}

export async function updateSessionTitle(
  sessionId: number,
  title: string,
): Promise<SessionListItem> {
  return request<SessionListItem>(`/sessions/${sessionId}`, {
    method: 'PATCH',
    body: JSON.stringify({ title }),
  })
}

export async function deleteSession(sessionId: number): Promise<{ detail: string }> {
  return request<{ detail: string }>(`/sessions/${sessionId}`, {
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
}

export type SessionPromptEvent =
  | { type: 'status'; data: { message?: string } }
  | { type: 'node_created'; data: NodeOut }
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
  sessionId: number,
  payload: SessionPromptPayload,
  onEvent: (event: SessionPromptEvent) => void,
): Promise<void> {
  const response = await fetch(`${API_BASE}/sessions/${sessionId}/prompt`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
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
