# Agent Pipeline — How AI Prompts Become Mind Maps

## Overview

When a user sends a prompt, it flows through a pipeline that makes **one Gemini API call**, then locally validates, lays out, colors, persists, and streams the result back as SSE events. The pipeline is the same for both research and plan modes — only the system prompt and limits differ.

## The Full Flow

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
        +-- 1. Find anchor node (explicit ID, or sole node in session, or None)
        |
        +-- 2. SINGLE LLM CALL
        |     single_pass.build()
        |       -> Builds JSON user prompt with:
        |         - mode, user_prompt, anchor_node context
        |         - limits (max 14 research / 12 plan nodes)
        |         - palette roles, edge kinds, instructions
        |       -> call_gemini_json() with GraphDraft schema
        |       -> Gemini returns structured JSON
        |       -> Parsed + validated into GraphDraft
        |
        +-- 3. VALIDATION (no LLM)
        |     validation.filter_draft()
        |       -> Dedup topics (case-insensitive)
        |       -> Drop shallow/empty nodes (research mode)
        |       -> Cap at max_nodes, cap fanout per parent
        |       -> Remove self-loops, dangling edges
        |       -> If no edges at all -> star topology from first node
        |       -> Filter sources to only reference surviving nodes
        |
        +-- 4. STRUCTURING (no LLM)
        |     structuring.organize()
        |       -> canvas_layout.layout_graph()
        |           - Radial layout: concentric rings from anchor
        |           - Angular sectors weighted by subtree size
        |           - Overlap repulsion (72 iterations)
        |       -> graph_palette colors + line styles
        |       -> Produces StructuredGraph (with positions + colors)
        |
        +-- 5. PERSIST + STREAM
        |     For each node in StructuredGraph:
        |       -> graph_service.create_node() -> DB
        |       -> yield SSE: node_created { id, topic, position, color, ... }
        |
        |     For anchor->root links (if expanding an existing node):
        |       -> graph_service.create_link() -> DB
        |       -> yield SSE: link_created
        |
        |     For each edge in StructuredGraph:
        |       -> graph_service.create_link() -> DB
        |       -> yield SSE: link_created { parent_id, child_id, color, line_style }
        |
        |     If sources exist:
        |       -> yield SSE: sources_created { sources[] with real node IDs }
        |
        |     -> yield SSE: message_created (system summary)
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
Frontend processes SSE events, adds nodes/links to ReactFlow canvas
```

## What Each Step Does

### 1. single_pass.build() — The Only LLM Call

One Gemini request produces the entire graph. The system prompt differs by mode:

- **Research**: "Build a complete, deeply explanatory research mind map" — 3-5 top-level branches, 1-3 deeper nodes each, emphasis on mechanisms/prerequisites/implications
- **Plan**: "Build a complete, executable plan mind map" — 3-5 actionable components, concrete steps/risks/checkpoints

The user prompt is a JSON object with:
- The user's text
- Anchor node context (if expanding)
- Node limits, palette roles, edge kinds
- Detailed instructions (return nodes + edges, include sources, etc.)

Response is parsed directly into a `GraphDraft` Pydantic model via `call_gemini_json()`.

### 2. validation.filter_draft() — Quality Gate

Deterministic (no LLM). Filters the raw draft:
- Deduplicates topics (case-insensitive match)
- Drops nodes with empty/very short details+summary (research only)
- Caps total nodes (14 research, 12 plan)
- Caps fanout per parent (6 research, 5 plan)
- Removes self-loops and edges referencing removed nodes
- Fallback: if no edges survive, creates a star topology
- Trims source references to only reference surviving node IDs

### 3. structuring.organize() — Layout + Colors

Deterministic (no LLM). Transforms `GraphDraft` -> `StructuredGraph`:
- **Layout**: `canvas_layout.layout_graph()` — radial rings from anchor/center, weighted angular sectors, overlap repulsion
- **Colors**: `graph_palette.node_color()` — branch-based color from hardcoded palettes
- **Edge styles**: `graph_palette.edge_color()` + `line_style()` — hierarchy=solid, prerequisite=dashed, critical=bold, etc.

### 4. Persist + Stream

The orchestrator iterates through the structured graph and for each element:
1. Writes to DB via `graph_service`
2. Maps temp IDs (`n1`, `n2`) to real DB IDs
3. Yields an SSE event with the persisted data

## Data Models

```
GraphDraft (from LLM)
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
| `done` | `{}` | Stream complete |
| `error` | `{ message }` | Something went wrong |

## AI Provider Layer (ai.py)

Not part of the agent pipeline per se, but critical infrastructure:

- **Provider priority**: BYOK Gemini -> Azure OpenAI -> Server Gemini pool
- **Gemini key pool**: 1-20 keys, round-robin rotation, dead-key quarantine
- **Model fallback**: Primary model -> fallback chain (configurable via `GEMINI_MODEL_FALLBACKS`)
- **Rate limit handling**: Sleeps + retries on 429, skips model on "limit: 0" (no free-tier quota)
- **JSON mode**: `call_gemini_json()` requests `response_mime_type="application/json"`, validates against Pydantic schema, auto-retries on parse errors
