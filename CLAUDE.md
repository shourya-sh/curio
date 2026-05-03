# Curio — AI Mind Map Tool

## What It Is
A learning tool that restructures prompts, finds subtopics, and builds interactive mind maps. Users can click nodes to expand/branch deeper.

## Two Modes
- **Research**: User asks a question → Claude breaks it down into a structured mind map
- **Plan**: User manually creates/connects nodes, AI can assist

## Tech Stack
- **Backend**: FastAPI, SQLAlchemy, Supabase PostgreSQL, Claude API, SSE for streaming
- **Frontend**: React (Vite, port 5173)
- **Infra**: Docker, docker-compose

## Database Schema
- **sessions**: id, user_id, title, mode, created_at, updated_at
- **nodes**: id, session_id, topic, summary, details, subtopics (JSON), depth, created_at, updated_at
- **node_links**: id, session_id, parent_id, child_id, created_at
- **messages**: id, session_id, role, content, created_at

## Core Endpoints
- `POST /sessions` — create new session
- `GET /sessions` — list all sessions
- `GET /sessions/{id}` — get full session (nodes, links, messages)
- `PATCH /sessions/{id}` — rename session title
- `DELETE /sessions/{id}` — delete session
- `POST /sessions/{id}/prompt` — send message, Claude responds with node updates via SSE

## Key Interaction
User sends a prompt → Claude structures it into nodes/subtopics → rendered as mind map → user clicks a node to expand → Claude branches further with deeper subtopics

## Architecture Conventions
- **IDs are always `int`** — all `session_id`, `node_id`, `parent_id`, `child_id`, `link_id` across services/routers use `int`. No `str()` wrapping.
- **`graph_service.py`** is the single module for all graph reads and writes (nodes + links). Routers never do inline `db.query()` for graph tables.
- **`profile_service.py`** handles BYOK key lookup (`get_user_api_keys`).
- **`message_service.py`** handles chat message persistence.
- **`orchestrator.py`** owns all DB persistence during the AI pipeline (user messages, nodes, links, sources, system messages).
- **`stream_service.py`** is a pure SSE transport layer — validates session, runs orchestrator, yields events, commits/rolls back.
- **Pydantic serialization** — use `NodeOut`, `LinkOut`, `MessageOut` with `.model_validate(row).model_dump(mode="json")` instead of manual dict builders.
