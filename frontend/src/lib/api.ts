export type SessionMode = 'research' | 'plan'

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8000'

interface SessionCreatePayload {
  title: string
  mode: SessionMode
}

interface NodeCreatePayload {
  topic: string
  summary?: string
  details?: string
  parent_id?: number
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
    ...init,
  })

  if (!response.ok) {
    const body = await response.text()
    throw new Error(body || `Request failed (${response.status})`)
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
): Promise<{ id: number }> {
  return request<{ id: number }>(`/sessions/${sessionId}/nodes/`, {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export interface SessionDetail {
  id: number
  title: string
  mode: SessionMode
  created_at?: string
  updated_at?: string
  nodes: Array<{
    id: number
    topic: string
    summary?: string | null
    details?: string | null
    depth: number
    created_at: string
  }>
  links: Array<{
    id: number
    parent_id: number
    child_id: number
  }>
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
