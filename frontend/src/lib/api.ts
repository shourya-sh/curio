export type SessionMode = 'research' | 'plan'

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8000'

interface SessionCreatePayload {
  title: string
  mode: SessionMode
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

export interface LinkOut {
  id: number
  session_id: number
  parent_id: number
  child_id: number
  created_at: string
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

export async function createLink(
  sessionId: number,
  payload: LinkCreatePayload,
): Promise<LinkOut> {
  return request<LinkOut>(`/sessions/${sessionId}/links/`, {
    method: 'POST',
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
