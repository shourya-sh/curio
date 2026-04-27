import os
import httpx
from google import genai
from logger import get_logger
from services.token_logging import log_provider_token_usage

logger = get_logger("ai")

# Azure OpenAI (gpt-4o-mini)
AZURE_URL = os.getenv("AZURE_FOUNDRY_URL")
AZURE_KEY = os.getenv("AZURE_FOUNDRY_API_KEY")

# Gemini
GEMINI_KEY = os.getenv("GEMINI_API_KEY")
gemini_client = None

async def call_ai(system_prompt: str, user_prompt: str, session_id: str | None = None) -> str:
    if AZURE_URL:
        logger.info("Calling az")
        return await call_azure(system_prompt, user_prompt, session_id=session_id)
    elif GEMINI_KEY:
        logger.info("Calling gemini")
        return await call_gemini(system_prompt, user_prompt, session_id=session_id)
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


def _get_gemini_client():
    global gemini_client
    if gemini_client is None:
        gemini_client = genai.Client(api_key=GEMINI_KEY)
    return gemini_client

async def call_gemini(system_prompt: str, user_prompt: str, session_id: str | None = None) -> str:
    try:
        response = await _get_gemini_client().aio.models.generate_content(
            model="gemini-2.0-flash",
            contents=user_prompt,
            config=genai.types.GenerateContentConfig(
                system_instruction=system_prompt,
            ),
        )
        output_text = response.text
        usage_metadata = None
        if hasattr(response, "usage_metadata") and response.usage_metadata:
            usage_metadata = response.usage_metadata.model_dump()

        log_provider_token_usage(
            provider="gemini",
            session_id=session_id,
            model="gemini-2.0-flash",
            usage=usage_metadata,
            system_prompt=system_prompt,
            user_prompt=user_prompt,
            output_text=output_text,
        )
        return output_text
    except Exception as e:
        logger.error(f"Gemini call failed: {e}")
        raise
