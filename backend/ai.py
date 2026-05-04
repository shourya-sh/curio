import asyncio
import json
import os
import re
from typing import Any

import httpx
from google import genai
from pydantic import BaseModel

from logger import get_logger
from services.token_logging import log_provider_token_usage

logger = get_logger("ai")

# Azure OpenAI (gpt-4o-mini)
AZURE_URL = os.getenv("AZURE_FOUNDRY_URL")
AZURE_KEY = os.getenv("AZURE_FOUNDRY_API_KEY")

# Gemini — keys from any of:
#   GEMINI_API_KEY_1 … GEMINI_API_KEY_20 (one key per line; best for 5+ keys in .env)
#   GEMINI_API_KEYS (comma / newline / ; / | separated)
#   GEMINI_API_KEY (optional extra or sole key)
# Each generate_content call uses the next key in round-robin order.
# gemini-2.5-flash-lite has the highest free-tier RPM/RPD on a fresh project as of 2026.
# gemini-2.0-flash often returns "limit: 0" on the free tier of new Google accounts.
GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-2.5-flash-lite")
GEMINI_MODEL_FALLBACKS = [
    m.strip()
    for m in os.getenv(
        "GEMINI_MODEL_FALLBACKS",
        "gemini-2.5-flash,gemini-2.0-flash-lite,gemini-2.0-flash",
    ).split(",")
    if m.strip() and m.strip() != GEMINI_MODEL
]

_gemini_clients: dict[str, genai.Client] = {}
_gemini_rr_lock = asyncio.Lock()
_gemini_rr_index = 0
_gemini_pool_logged = False


def _clean_key_token(raw: str) -> str:
    p = raw.strip().strip("\ufeff")
    if len(p) >= 2 and p[0] == p[-1] and p[0] in "\"'":
        p = p[1:-1].strip()
    return p


def _parse_gemini_api_keys() -> list[str]:
    """Resolve the Gemini key pool with these rules (highest precedence first):
       1. GEMINI_API_KEY_1 .. GEMINI_API_KEY_20 — explicit numbered slots, kept in order.
       2. GEMINI_API_KEYS — comma/newline/semicolon/pipe separated.
       3. GEMINI_API_KEY — only used when neither of the above is set.
    This means a stray GEMINI_API_KEY in .env can NOT silently inflate the pool when
    you've already set GEMINI_API_KEYS."""
    global _gemini_pool_logged
    numbered: list[str] = []
    for i in range(1, 21):
        v = _clean_key_token(os.getenv(f"GEMINI_API_KEY_{i}", "") or "")
        if v:
            numbered.append(v)

    multi_raw = _clean_key_token(os.getenv("GEMINI_API_KEYS", "") or "")
    multi: list[str] = []
    if multi_raw:
        for part in re.split(r"[\n,;|]+", multi_raw):
            p = _clean_key_token(part)
            if p:
                multi.append(p)

    if numbered:
        keys = numbered
    elif multi:
        keys = multi
    else:
        single = _clean_key_token(os.getenv("GEMINI_API_KEY", "") or "")
        keys = [single] if single else []

    out = list(dict.fromkeys(keys))
    if out and not _gemini_pool_logged:
        _gemini_pool_logged = True
        logger.info("Gemini key pool: %s key(s) in round-robin rotation", len(out))
    return out


def gemini_configured() -> bool:
    return bool(_parse_gemini_api_keys())


def gemini_key_pool_size() -> int:
    return len(_parse_gemini_api_keys())


async def call_ai(system_prompt: str, user_prompt: str, session_id: str | None = None, *, api_keys: list[str] | None = None) -> str:
    if AZURE_URL and not api_keys:
        logger.info("Calling az")
        return await call_azure(system_prompt, user_prompt, session_id=session_id)
    elif api_keys or gemini_configured():
        logger.info("Calling gemini")
        return await call_gemini(system_prompt, user_prompt, session_id=session_id, api_keys=api_keys)
    else:
        logger.error("where tf the ai provider")
        raise ValueError("No AI provider configured")


async def call_azure(system_prompt: str, user_prompt: str, session_id: str | None = None) -> str:
    headers = {"Content-Type": "application/json", "api-key": AZURE_KEY}
    payload = {
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
    }
    try:
        async with httpx.AsyncClient() as client:
            resp = await client.post(AZURE_URL, json=payload, headers=headers, timeout=30)
            resp.raise_for_status()
            body = resp.json()
            output_text = body["choices"][0]["message"]["content"]
            log_provider_token_usage(
                provider="azure",
                session_id=session_id,
                model=body.get("model"),
                usage=body.get("usage"),
                system_prompt=system_prompt,
                user_prompt=user_prompt,
                output_text=output_text,
            )
            return output_text
    except httpx.HTTPStatusError as e:
        logger.error(f"Azure API error {e.response.status_code}: {e.response.text}")
        raise
    except Exception as e:
        logger.error(f"Azure call failed: {e}")
        raise


def _client_for_api_key(api_key: str) -> genai.Client:
    if api_key not in _gemini_clients:
        _gemini_clients[api_key] = genai.Client(api_key=api_key)
    return _gemini_clients[api_key]


async def _pick_api_key_round_robin() -> str:
    keys = _parse_gemini_api_keys()
    if not keys:
        raise ValueError("GEMINI_API_KEY or GEMINI_API_KEYS is required for Gemini agent calls")
    global _gemini_rr_index
    async with _gemini_rr_lock:
        key = keys[_gemini_rr_index % len(keys)]
        _gemini_rr_index += 1
    return key


def _is_gemini_rate_limit_error(exc: BaseException) -> bool:
    code = getattr(exc, "status_code", None) or getattr(exc, "code", None)
    if code == 429:
        return True
    msg = str(exc).lower()
    return "resource_exhausted" in msg or "quota exceeded" in msg or "429" in msg


def _is_gemini_zero_quota_error(exc: BaseException) -> bool:
    """`limit: 0` means this model has NO free-tier quota for this project.
    Sleeping does nothing — we need a different model or paid billing."""
    if not _is_gemini_rate_limit_error(exc):
        return False
    msg = str(exc)
    return bool(re.search(r"limit:\s*0\b", msg))


def _is_gemini_invalid_api_key_error(exc: BaseException) -> bool:
    """Google often labels revoked/wrong/malformed keys as 'expired'. Treat as per-key; rotate."""
    code = getattr(exc, "status_code", None) or getattr(exc, "code", None)
    msg = str(exc).lower()
    if code == 400 and ("api_key_invalid" in msg or "api key expired" in msg or "renew the api key" in msg):
        return True
    if "api_key_invalid" in msg:
        return True
    return False


def _gemini_retry_after_seconds(exc: BaseException, default: float = 15.0) -> float:
    text = str(exc)
    m = re.search(r"retry in ([\d.]+)\s*s", text, re.I)
    if m:
        return min(max(float(m.group(1)), 0.5), 120.0)
    m2 = re.search(r"RetryInfo.*?(\d+)\s*s", text, re.I | re.DOTALL)
    if m2:
        return min(max(float(m2.group(1)), 0.5), 120.0)
    return default


_dead_keys: set[str] = set()
_zero_quota_models: set[str] = set()


def _live_keys() -> list[str]:
    return [k for k in _parse_gemini_api_keys() if k not in _dead_keys]


def _candidate_models() -> list[str]:
    out: list[str] = []
    if GEMINI_MODEL not in _zero_quota_models:
        out.append(GEMINI_MODEL)
    for m in GEMINI_MODEL_FALLBACKS:
        if m not in _zero_quota_models and m not in out:
            out.append(m)
    if not out:
        out.append(GEMINI_MODEL)
    return out


async def _try_one_model(
    *,
    model: str,
    contents: str | list,
    config: Any,
    api_keys: list[str] | None = None,
) -> tuple[Any | None, BaseException | None, dict[str, int]]:
    """Round-robin every live key once for this model. Returns (response, last_exc, counters).
    If api_keys is provided, uses ONLY those keys (BYOK) instead of the server pool."""
    if api_keys:
        keys = list(api_keys)
    else:
        keys = _live_keys()
    if not keys:
        return None, ValueError("No live Gemini API keys available"), {}
    n = len(keys)
    last_exc: BaseException | None = None
    counters = {"rl": 0, "zero_quota": 0, "invalid": 0, "other": 0}

    for i in range(n):
        if api_keys:
            api_key = keys[i % n]
        else:
            api_key = await _pick_api_key_round_robin()
            if api_key not in keys:
                continue
        client = _client_for_api_key(api_key)
        try:
            response = await client.aio.models.generate_content(
                model=model,
                contents=contents,
                config=config,
            )
            return response, None, counters
        except Exception as e:
            last_exc = e
            if _is_gemini_zero_quota_error(e):
                counters["zero_quota"] += 1
                continue
            if _is_gemini_rate_limit_error(e):
                counters["rl"] += 1
                continue
            if _is_gemini_invalid_api_key_error(e):
                counters["invalid"] += 1
                _dead_keys.add(api_key)
                logger.warning(
                    "Gemini permanently disabled one bad key in this process (pool: %s live).",
                    len(_live_keys()),
                )
                continue
            counters["other"] += 1
            logger.error(f"Gemini call failed (model={model}): {e}")
            raise
    return None, last_exc, counters


async def _generate_gemini(
    *,
    contents: str | list,
    system_prompt: str,
    response_mime_type: str | None = None,
    tools: list | None = None,
    tool_config: Any | None = None,
    api_keys: list[str] | None = None,
) -> Any:
    """Try the configured model across all live keys; rotate to fallback models if the
    primary model has zero free-tier quota for these projects (`limit: 0`); only sleep
    when keys are merely rate limited (transient).
    If api_keys is provided, uses ONLY those keys (BYOK) — never mixes with server pool."""
    if not api_keys:
        if not _parse_gemini_api_keys():
            raise ValueError("GEMINI_API_KEY or GEMINI_API_KEYS is required for Gemini agent calls")
        if not _live_keys():
            raise RuntimeError(
                "Every Gemini API key has been rejected as invalid/expired this process. "
                "Renew at https://aistudio.google.com/apikey, fix GEMINI_API_KEYS (no spaces, "
                "comma-separated), then restart."
            )

    cfg_kwargs: dict[str, Any] = {"system_instruction": system_prompt}
    if response_mime_type:
        cfg_kwargs["response_mime_type"] = response_mime_type
    if tools:
        cfg_kwargs["tools"] = tools
    if tool_config:
        cfg_kwargs["tool_config"] = tool_config
    config = genai.types.GenerateContentConfig(**cfg_kwargs)

    models_tried: list[str] = []
    last_exc: BaseException | None = None
    last_rl_exc: BaseException | None = None

    rate_limit_passes_per_model = 2
    for model in _candidate_models():
        models_tried.append(model)
        for rl_pass in range(rate_limit_passes_per_model):
            response, exc, counters = await _try_one_model(
                model=model,
                contents=contents,
                config=config,
                api_keys=api_keys,
            )
            if response is not None:
                if model != GEMINI_MODEL:
                    logger.warning("Gemini succeeded on fallback model: %s", model)
                return response

            last_exc = exc or last_exc
            n_live = max(1, len(api_keys) if api_keys else len(_live_keys()))

            if counters.get("zero_quota", 0) >= n_live:
                _zero_quota_models.add(model)
                logger.error(
                    "Gemini model %s reports limit: 0 (no free-tier quota for these projects). "
                    "Switching to a fallback model.",
                    model,
                )
                break

            if counters.get("rl", 0) + counters.get("zero_quota", 0) >= n_live:
                last_rl_exc = exc or last_rl_exc
                if rl_pass >= rate_limit_passes_per_model - 1:
                    break
                base = _gemini_retry_after_seconds(last_rl_exc, default=4.0)
                delay = min(base, 6.0) if n_live > 1 else min(base, 20.0)
                logger.warning(
                    "All %s live Gemini key(s) rate limited on model=%s; sleeping %.1fs then retrying.",
                    n_live,
                    model,
                    delay,
                )
                await asyncio.sleep(delay)
                continue

            break

    if _zero_quota_models and GEMINI_MODEL in _zero_quota_models and not GEMINI_MODEL_FALLBACKS:
        raise RuntimeError(
            f"Gemini model {GEMINI_MODEL} has no free-tier quota (limit: 0) for these projects. "
            "Set GEMINI_MODEL=gemini-2.5-flash-lite (or another available model) and restart, "
            "or enable billing on at least one Google Cloud project."
        )

    if last_exc:
        raise last_exc
    raise RuntimeError(f"Gemini generate_content failed without exception (models tried: {models_tried})")


async def call_gemini(system_prompt: str, user_prompt: str, session_id: str | None = None, *, api_keys: list[str] | None = None) -> str:
    try:
        response = await _generate_gemini(contents=user_prompt, system_prompt=system_prompt, api_keys=api_keys)
        output_text = response.text
        usage_metadata = None
        if hasattr(response, "usage_metadata") and response.usage_metadata:
            usage_metadata = response.usage_metadata.model_dump()

        used_model = getattr(response, "model_version", None) or GEMINI_MODEL
        log_provider_token_usage(
            provider="gemini",
            session_id=session_id,
            model=used_model,
            usage=usage_metadata,
            system_prompt=system_prompt,
            user_prompt=user_prompt,
            output_text=output_text,
        )
        return output_text
    except Exception as e:
        logger.error(f"Gemini call failed: {e}")
        raise


def _json_schema_hint(response_model: type[BaseModel] | None) -> str:
    if response_model is None:
        return "Return valid JSON only."
    return (
        "Return valid JSON only. It must satisfy this JSON schema:\n"
        f"{json.dumps(response_model.model_json_schema(), ensure_ascii=False)}"
    )


def _strip_json_fences(text: str) -> str:
    stripped = text.strip()
    match = re.fullmatch(r"```(?:json)?\s*(.*?)\s*```", stripped, re.DOTALL | re.IGNORECASE)
    return match.group(1).strip() if match else stripped


async def call_gemini_json(
    system_prompt: str,
    user_prompt: str,
    *,
    session_id: str | None = None,
    response_model: type[BaseModel] | None = None,
    retry_on_parse_error: bool = True,
    api_keys: list[str] | None = None,
) -> Any:
    """Gemini-only JSON helper for agent modules. Never falls back to Azure."""
    prompt = f"{user_prompt}\n\n{_json_schema_hint(response_model)}"
    response_text = ""
    try:
        response = await _generate_gemini(
            contents=prompt,
            system_prompt=system_prompt,
            response_mime_type="application/json",
            api_keys=api_keys,
        )
        response_text = response.text or ""
        usage_metadata = None
        if hasattr(response, "usage_metadata") and response.usage_metadata:
            usage_metadata = response.usage_metadata.model_dump()
        used_model = getattr(response, "model_version", None) or GEMINI_MODEL
        log_provider_token_usage(
            provider="gemini",
            session_id=session_id,
            model=used_model,
            usage=usage_metadata,
            system_prompt=system_prompt,
            user_prompt=prompt,
            output_text=response_text,
        )
        parsed = json.loads(_strip_json_fences(response_text))
        if response_model is not None:
            return response_model.model_validate(parsed)
        return parsed
    except (json.JSONDecodeError, ValueError) as e:
        if not retry_on_parse_error:
            logger.error(f"Gemini JSON parse failed: {e}; body={response_text[:500]}")
            raise
        repair_prompt = (
            f"{prompt}\n\nYour prior response was not valid JSON or did not match the schema. "
            "Return the corrected JSON object only."
        )
        return await call_gemini_json(
            system_prompt,
            repair_prompt,
            session_id=session_id,
            response_model=response_model,
            retry_on_parse_error=False,
            api_keys=api_keys,
        )
    except Exception as e:
        logger.error(f"Gemini JSON call failed: {e}")
        raise
