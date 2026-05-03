# Authentication

## Flow
1. User signs up via Supabase Auth (email/password)
2. Supabase trigger auto-creates a `profiles` row with the user's UUID
3. JWT issued by Supabase, stored client-side

## Frontend
- `AuthContext` (`lib/AuthContext.tsx`) wraps the app, provides `{ user, session, loading, signOut }`
- `useAuth()` hook for accessing auth state
- `ProtectedRoute` redirects to `/login` if not authenticated
- `PublicOnlyRoute` redirects to `/home` if already authenticated
- Token refresh handled automatically by Supabase client (`onAuthStateChange`)

## Backend
- `auth.py` exports `get_current_user()` FastAPI dependency
- Supports both **ES256** (newer Supabase projects, asymmetric JWKS) and **HS256** (legacy, symmetric secret)
- On first ES256 token, fetches JWKS from `SUPABASE_URL/auth/v1/.well-known/jwks.json` (cached)
- Extracts `sub` (user UUID) from verified payload
- Returns 401 on missing/invalid/expired tokens

## API Auth
- `api.ts` calls `getAuthHeaders()` before every request
- Attaches `Authorization: Bearer <access_token>` header
- Token sourced from `supabase.auth.getSession()`

## Session Ownership
- Every session has `user_id` column matching the JWT `sub`
- `_get_user_session_or_404(db, pk, user_id)` enforces ownership
- Users can only see/modify their own sessions
