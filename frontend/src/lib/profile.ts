import { getAuthHeaders } from './api'

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

export interface Profile {
  id: string
  display_name: string | null
  gemini_api_keys: string[]
  has_azure: boolean
  updated_at: string | null
}

export interface ProfileUpdatePayload {
  display_name?: string
  gemini_api_keys?: string[]
  azure_foundry_url?: string
  azure_foundry_api_key?: string
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const authHeaders = await getAuthHeaders()
  const response = await fetch(`${API_BASE}${path}`, {
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders,
      ...(init?.headers ?? {}),
    },
    ...init,
  })
  if (!response.ok) {
    const body = await response.text()
    throw new Error(body || `Request failed (${response.status})`)
  }
  if (response.status === 204) return undefined as T
  return response.json() as Promise<T>
}

export async function getProfile(): Promise<Profile> {
  return request<Profile>('/profile/')
}

export async function updateProfile(payload: ProfileUpdatePayload): Promise<Profile> {
  return request<Profile>('/profile/', {
    method: 'PATCH',
    body: JSON.stringify(payload),
  })
}

export async function deleteAccount(): Promise<{ detail: string }> {
  return request<{ detail: string }>('/profile/', {
    method: 'DELETE',
  })
}
