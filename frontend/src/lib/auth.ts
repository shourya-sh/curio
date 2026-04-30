const AUTH_STORAGE_KEY = 'curio:isSignedIn'

export function isSignedIn(): boolean {
  try {
    return localStorage.getItem(AUTH_STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

export function markSignedIn(): void {
  try {
    localStorage.setItem(AUTH_STORAGE_KEY, '1')
  } catch {
    // Ignore storage errors and keep the app usable.
  }
}

export function markSignedOut(): void {
  try {
    localStorage.removeItem(AUTH_STORAGE_KEY)
  } catch {
    // Ignore storage errors and keep the app usable.
  }
}
