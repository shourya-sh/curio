# BYOK (Bring Your Own Key)

## Supported Providers
- **Gemini**: list of API keys (1-20), round-robin rotation
- **Azure OpenAI**: single endpoint URL + API key

## Key Priority
- User BYOK keys take priority over server env keys
- If user has Gemini keys stored, ONLY those are used (never mixed with server keys)
- If user has no keys, server env pool is used as fallback
- User's bad key returns error to user — never falls back to server keys silently

## Key Storage
- Encrypted at rest with Fernet (`ENCRYPTION_KEY` env var)
- Stored in `profiles` table: `gemini_api_keys` (encrypted JSON array), `azure_foundry_url`, `azure_foundry_api_key`
- Decrypted only in-memory per-request, never logged
- If `ENCRYPTION_KEY` not set, plaintext pass-through (dev mode only)

## Call Chain
User keys are threaded through the entire AI pipeline:

```
session_router.session_prompt()
  → looks up user profile, decrypts gemini_api_keys
  → run_agent_stream(api_keys=...)
    → research_agent/plan_agent.run(api_keys=...)
      → orchestrator.run_pipeline(api_keys=...)
        → single_pass.build(api_keys=...)
          → call_gemini_json(api_keys=...)
            → _generate_gemini(api_keys=...)
              → _try_one_model(api_keys=...)
```

## Provider Dispatch (in ai.py)
1. If `api_keys` provided (BYOK): always use Gemini with those keys
2. If no BYOK and Azure configured: use Azure
3. If no BYOK and Gemini configured: use server Gemini pool
4. Otherwise: error

## Gemini Key Pool Behavior
- Supports 1-20 keys with round-robin rotation
- Dead-key quarantine (invalid/expired keys removed from rotation)
- Model fallback chain (configurable via `GEMINI_MODEL_FALLBACKS`)
- Same rotation logic applies to BYOK keys
