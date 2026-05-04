# Backend Structure

## Directory Layout

```
backend/
├── main.py                  # FastAPI app, CORS, lifespan, router registration
├── db.py                    # SQLAlchemy engine, SessionLocal, schema migrations
├── auth.py                  # JWT verification (HS256 + ES256 JWKS)
├── ai.py                    # AI provider abstraction (Gemini + Azure OpenAI); supports tools/tool_config for agentic mode
├── encryption.py            # Fernet encrypt/decrypt for stored API keys
├── logger.py                # Shared logger factory
├── prompts.py               # (empty — prompts live in agent modules)
│
├── models/
│   ├── tables.py            # SQLAlchemy ORM: SessionTable, NodeTable, NodeLinkTable, MessageTable
│   ├── session_models.py    # Pydantic: SessionCreate, SessionPrompt, SessionDetail, NodeOut, LinkOut, MessageOut
│   ├── node_models.py       # Pydantic: NodeCreate, NodeUpdate, NodeBulkUpdate, NodeRestorePayload
│   ├── link_models.py       # Pydantic: LinkCreate, LinkUpdate, LinkRestorePayload
│   └── profile_models.py    # Pydantic: ProfileOut, ProfileUpdate
│
├── routers/
│   ├── session_router.py    # CRUD + prompt endpoint (SSE streaming)
│   ├── node_router.py       # Node CRUD + bulk update + restore
│   ├── link_router.py       # Link CRUD + restore
│   └── profile_router.py    # Profile get/update/delete (account deletion)
│
├── services/
│   ├── graph_service.py     # All DB writes for nodes/links + session ownership check
│   ├── message_service.py   # Chat message persistence (user, system, sources)
│   ├── stream_service.py    # SSE orchestration — dispatches to orchestrator.run_pipeline
│   ├── canvas_layout.py     # Radial mind-map layout algorithm (no LLM)
│   ├── graph_palette.py     # Color/line-style lookup tables for nodes and edges
│   ├── session_identifiers.py  # Slug generation, slug<->PK resolution
│   ├── rate_limit.py        # Sliding-window rate limiter (8 req/60s per IP)
│   ├── token_logging.py     # Prompt + provider token usage logging
│   │
│   └── agents/              # AI pipeline modules (see agent-pipeline.md)
│       ├── orchestrator.py  # Runs pipeline: tool loop (primary) or single pass (fallback) -> persist -> SSE
│       ├── tool_defs.py     # Gemini function declarations for agentic tools (create_node, create_link, etc.)
│       ├── tool_loop.py     # Multi-turn agentic loop: LLM calls tools iteratively with safety limits
│       ├── single_pass.py   # One Gemini call -> full GraphDraft (fallback path)
│       ├── draft_models.py  # Pydantic: GraphDraft, StructuredGraph, SourceDraft
│       └── core/
│           ├── structuring.py   # Layout + color assignment (no LLM)
│           └── validation.py    # Dedup, size limits, orphan edges, fanout cap
```

## Router Pattern

- Each router lives in `backend/routers/` and is registered in `main.py`
- Every endpoint requires `user_id: str = Depends(get_current_user)` — auth on every request
- Session ownership verified via `graph_service.verify_session_owner(db, pk, user_id)`
- Session references in URLs can be slugs or numeric IDs (resolved by `resolve_session_pk_or_404`)

## Database

- **Engine**: SQLAlchemy ORM with Supabase PostgreSQL (`DATABASE_URL` env var)
- **Connection pool**: `QueuePool` with 5 base + 10 overflow connections
- **ORM models**: `backend/models/tables.py` — 4 tables: sessions, nodes, node_links, messages
- **Pydantic schemas**: `backend/models/*_models.py` — request/response validation
- **`profiles` table**: managed via raw SQL (Supabase trigger creates it, not in SQLAlchemy models)
- **Schema migrations**: `db.ensure_schema()` runs idempotent `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` on startup

## Services Layer

| File | Purpose |
|------|---------|
| `graph_service.py` | **All** node/link DB mutations + `verify_session_owner`. Routers and the orchestrator call this — never `db.add()` directly |
| `message_service.py` | Persist chat messages (user prompts, system summaries, sources JSON) |
| `stream_service.py` | SSE entry point — validates session, saves user message, calls `orchestrator.run_pipeline`, yields SSE events |
| `canvas_layout.py` | Radial layout: nodes on concentric rings, angular sectors by subtree weight, overlap repulsion |
| `graph_palette.py` | Hardcoded color palettes (research vs plan) and edge line styles per edge kind |
| `session_identifiers.py` | `slugify_text()`, `allocate_unique_slug()`, slug<->PK resolution |
| `rate_limit.py` | In-memory sliding window: 8 AI prompts per 60 seconds per client IP |
| `token_logging.py` | Logs estimated token counts for prompts and provider responses |

## Key Patterns

- **SSE streaming**: `StreamingResponse` wrapping an async generator (`run_agent_stream`)
- **Temp ID mapping**: Gemini uses `n1`/`n2`/`n3` -> mapped to real DB IDs after `graph_service.create_node`
- **Round-robin key pool**: Gemini keys rotated per-call with dead-key quarantine and model fallback
- **BYOK**: user's own API keys threaded through the entire call chain via `api_keys` param
- **Session touch**: every graph mutation bumps `sessions.updated_at` for correct sort order
- **Idempotent links**: `create_link` returns existing row if the same parent->child edge exists
