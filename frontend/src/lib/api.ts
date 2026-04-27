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

export async function createSession(payload: SessionCreatePayload): Promise<{ id: number }> {
  return request<{ id: number }>('/sessions/', {
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
