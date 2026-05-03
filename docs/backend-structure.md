# Backend Structure

## Router Pattern
- Each router lives in `backend/routers/` and is registered in `main.py`
- Every endpoint takes `user_id: str = Depends(get_current_user)` for auth
- Session ownership verified via `_get_user_session_or_404()` or `_verify_session_owner()`

## Database
- SQLAlchemy ORM models in `backend/models/tables.py`
- Pydantic request/response schemas in `backend/models/*_models.py`
- `profiles` table managed via raw SQL (Supabase-created, not in SQLAlchemy models)

## Services Layer
- `graph_service.py` — DB mutations for nodes/links
- `message_service.py` — chat message persistence
- `stream_service.py` — SSE streaming orchestration
- `services/agents/` — AI pipeline modules

## AI Pipeline
- `single_pass.py` — one Gemini call produces entire graph
- `orchestrator.py` — runs pipeline, persists to DB, yields SSE events
- `research_agent.py` / `plan_agent.py` — thin wrappers for mode dispatch
- `core/structuring.py` — layout and color assignment (no LLM)
- `core/validation.py` — draft filtering and size limits

## Key Patterns
- SSE streaming via `StreamingResponse` + async generators
- Temp ID mapping: Gemini uses n1/n2/n3 → mapped to real DB IDs after creation
- Round-robin Gemini key pool with dead-key quarantine
- BYOK: `api_keys` param threaded through entire call chain
