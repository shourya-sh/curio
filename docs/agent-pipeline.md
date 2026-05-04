# Agent Pipeline — How AI Prompts Become Mind Maps

## Overview

When a user sends a prompt, it flows through a pipeline that builds a mind map via **either a multi-turn tool loop (primary) or a single-pass JSON call (fallback)**. Both paths validate, lay out, color, persist, and stream the result back as SSE events. The pipeline is the same for both research and plan modes — only the system prompt and limits differ.

## Primary Path: Tool Loop

The tool loop gives the LLM agentic control — it calls tools like `create_node` and `create_link` one at a time, streaming each result to the frontend as it's created.

```
User types prompt in frontend
        |
        v
POST /sessions/{id}/prompt  (session_router.py)
        |
        +-- Verify auth (JWT)
        +-- Resolve session slug -> PK
        +-- Rate limit check (8/60s)
        +-- Look up user's BYOK keys (decrypt from profiles table)
        |
        v
StreamingResponse <- run_agent_stream()  (stream_service.py)
        |
        +-- Validate session exists
        +-- Save user's message to DB
        +-- Yield SSE: message_created (user message)
        +-- Call orchestrator.run_pipeline(mode=session.mode)
        |
        v
orchestrator.run_pipeline()  (orchestrator.py)
        |
        +-- 1. Find anchor node
        +-- 2. Check USE_TOOL_LOOP env var (default: true)
        |
        +-- [TOOL LOOP PATH]
        |     tool_loop.run()  (tool_loop.py)
        |       -> Injects context: existing nodes, anchor, user prompt
        |       -> Multi-turn conversation with Gemini
        |       -> Each turn: LLM calls tools -> tools execute -> results fed back
        |       -> Tools: create_node, create_link, add_sources, done
        |       -> Each tool call persists to DB + yields SSE event immediately
        |       -> Safety limits: 20 iterations, 60s timeout, max_nodes cap
        |       -> Loop ends when LLM calls `done` tool
        |
        +-- [ON TOOL LOOP FAILURE -> FALLBACK TO SINGLE PASS]
        |
        v
stream_service catches message_created / sources_created events
        |  -> Persists them to messages table
        |  -> Yields final SSE events to client
        |
        v
yield SSE: done {}
        |
        v
Frontend processes SSE events, adds nodes/links to canvas with animation
```

### Tool Definitions (tool_defs.py)

| Tool | Arguments | Effect |
|------|-----------|--------|
| `create_node` | topic, summary, details, subtopics, depth, color | Creates node in DB, yields `node_created` SSE |
| `create_link` | parent_id, child_id, color, line_style | Creates link in DB, yields `link_created` SSE |
| `add_sources` | sources[] (title, url, summary, node_ids) | Yields `sources_created` SSE |
| `done` | summary | Signals loop completion, yields `message_created` SSE |

### Multi-Turn Conversation Flow

1. **Initial turn**: System prompt + user prompt + existing graph context
2. **LLM responds** with one or more tool calls
3. **Tools execute**: each persists to DB and yields an SSE event
4. **Tool results** fed back to LLM as the next conversation turn
5. **Repeat** until LLM calls `done` or safety limits hit

### Error Handling

- Each tool call is wrapped in try/catch — errors are sent back to the LLM as tool results
- Validation guards (e.g., duplicate topic check) return error messages, not exceptions
- If the entire tool loop fails, the orchestrator falls back to single_pass

### Safety Limits

- **Max iterations**: 20 turns (configurable)
- **Timeout**: 60 seconds
- **Max nodes**: Same caps as single-pass (14 research / 12 plan)
- **Fallback**: On any unrecoverable error, falls back to single_pass.build()

### New SSE Event: `tool_used`

During the tool loop, the frontend receives `tool_used` events for UI feedback:

```json
{ "type": "tool_used", "data": { "tool": "create_node", "args": { "topic": "Quantum Computing" } } }
```

Displayed as a system message in the chat panel (e.g., `🔧 create_node("Quantum Computing")`).

## Fallback Path: Single Pass

When `USE_TOOL_LOOP=false` or the tool loop fails, the pipeline falls back to the original single-pass approach.

### single_pass.build() — One LLM Call

One Gemini request produces the entire graph. The system prompt differs by mode:

- **Research**: "Build a complete, deeply explanatory research mind map" — 3-5 top-level branches, 1-3 deeper nodes each
- **Plan**: "Build a complete, executable plan mind map" — 3-5 actionable components, concrete steps/risks/checkpoints

Response is parsed directly into a `GraphDraft` Pydantic model via `call_gemini_json()`.

### validation.filter_draft() — Quality Gate

Deterministic (no LLM). Filters the raw draft:
- Deduplicates topics (case-insensitive match)
- Drops nodes with empty/very short details+summary (research only)
- Caps total nodes (14 research, 12 plan)
- Caps fanout per parent (6 research, 5 plan)
- Removes self-loops and edges referencing removed nodes
- Fallback: if no edges survive, creates a star topology

### structuring.organize() — Layout + Colors

Deterministic (no LLM). Transforms `GraphDraft` -> `StructuredGraph`:
- **Layout**: `canvas_layout.layout_graph()` — radial rings from anchor, overlap repulsion
- **Colors**: `graph_palette.node_color()` — branch-based color from palettes
- **Edge styles**: `graph_palette.edge_color()` + `line_style()` — hierarchy=solid, prerequisite=dashed, etc.

### Persist + Stream

Same as tool loop output — iterates through structured graph, writes to DB, yields SSE events.

## Data Models

```
GraphDraft (from single-pass LLM)
+-- nodes: [GraphNodeDraft]     # temp_id, topic, summary, details, subtopics, palette_role
+-- edges: [GraphEdgeDraft]     # parent_temp_id, child_temp_id, edge_kind, relation
+-- sources: [SourceDraft]      # title, url, publisher, summary, node_temp_ids
+-- assistant_summary: str

    | validation + structuring

StructuredGraph (ready for DB)
+-- nodes: [StructuredNode]     # temp_id, topic, summary, details, depth, position_x/y, color
+-- edges: [StructuredEdge]     # parent_temp_id, child_temp_id, color, line_style
+-- sources: [SourceDraft]      # (passed through, temp IDs resolved later)
+-- assistant_summary: str
```

## SSE Event Types

| Event | Data | When |
|-------|------|------|
| `message_created` | `{ id, session_id, role, content, created_at }` | User message echoed back, system summary |
| `node_created` | `{ id, session_id, topic, summary, details, position_x, position_y, color, ... }` | Each node persisted |
| `link_created` | `{ id, session_id, parent_id, child_id, color, line_style }` | Each edge persisted |
| `sources_created` | `{ sources: [{ title, url, summary, node_ids, node_topics, ... }] }` | References panel |
| `tool_used` | `{ tool, args }` | Tool loop: each tool invocation (for chat UI feedback) |
| `done` | `{}` | Stream complete |
| `error` | `{ message }` | Something went wrong |

## AI Provider Layer (ai.py)

- **Provider priority**: BYOK Gemini -> Azure OpenAI -> Server Gemini pool
- **Gemini key pool**: 1-20 keys, round-robin rotation, dead-key quarantine
- **Model fallback**: Primary model -> fallback chain (configurable via `GEMINI_MODEL_FALLBACKS`)
- **Rate limit handling**: Sleeps + retries on 429, skips model on "limit: 0"
- **JSON mode**: `call_gemini_json()` for single-pass; tool mode uses `tools` + `tool_config` params
