# Frontend Structure

## Pages
- `LandingPage` — public landing
- `LoginPage` / `SignupPage` — auth forms (PublicOnlyRoute)
- `DashboardHomePage` — main dashboard with session creation
- `LibraryPage` — session list/management
- `WorkspaceCanvasPage` — mind map canvas with AI streaming
- `SettingsPage` — profile, API keys, account deletion

## Components
- `AppTopBar` — top navigation with brand, nav links, settings gear, account avatar/menu
- `MindMapCanvas` — ReactFlow-based mind map renderer
- `DecorativePageBackground` — animated background for dashboard/library

## Lib
- `api.ts` — HTTP client for all backend endpoints
- `supabase.ts` — Supabase client initialization
- `AuthContext.tsx` — auth provider with `useAuth()` hook
- `profile.ts` — profile API (get/update/delete)
- `queryClient.ts` — React Query client and query key constants

## Styling
- Single `index.css` with section comments
- No CSS modules or CSS-in-JS
- Design: clean, minimal, indigo/slate color palette

## Data Fetching
- `@tanstack/react-query` for queries and mutations
- Optimistic updates where appropriate
- SSE streaming for AI responses (manual fetch + ReadableStream)
