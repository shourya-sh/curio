import math
from typing import Any, Dict, Optional

from logger import get_logger

logger = get_logger("token_logging")


def estimate_tokens(text: str) -> int:
    """
    Rough token estimate for quick observability.
    Most English text averages ~4 chars/token.
    """
    if not text:
        return 0
    return math.ceil(len(text) / 4)


def log_prompt_token_usage(
    *,
    session_id: str,
    mode: str,
    prompt: str,
    source: str = "prompt_endpoint",
) -> Dict[str, Any]:
    prompt_chars = len(prompt or "")
    prompt_words = len((prompt or "").split())
    prompt_tokens_est = estimate_tokens(prompt or "")
    payload = {
        "event": "token_usage_prompt",
        "source": source,
        "session_id": session_id,
        "mode": mode,
        "prompt_chars": prompt_chars,
        "prompt_words": prompt_words,
        "prompt_tokens_est": prompt_tokens_est,
    }
    logger.info(payload)
    return payload


def log_provider_token_usage(
    *,
    provider: str,
    session_id: Optional[str],
    model: Optional[str],
    usage: Optional[Dict[str, Any]],
    system_prompt: str,
    user_prompt: str,
    output_text: str,
) -> None:
    # Fallback estimates are always logged so we can compare trends
    # even if a provider does not return usage metadata.
    input_tokens_est = estimate_tokens((system_prompt or "") + "\n" + (user_prompt or ""))
    output_tokens_est = estimate_tokens(output_text or "")

    payload = {
        "event": "token_usage_provider",
        "provider": provider,
        "session_id": session_id,
        "model": model,
        "usage": usage or {},
        "input_tokens_est": input_tokens_est,
        "output_tokens_est": output_tokens_est,
        "total_tokens_est": input_tokens_est + output_tokens_est,
    }
    logger.info(payload)
