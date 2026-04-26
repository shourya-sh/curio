import os
import httpx
from google import genai
from logger import get_logger

logger = get_logger("ai")

# Azure OpenAI (gpt-4o-mini)
AZURE_URL = os.getenv("AZURE_FOUNDRY_URL")
AZURE_KEY = os.getenv("AZURE_FOUNDRY_API_KEY")

# Gemini
GEMINI_KEY = os.getenv("GEMINI_API_KEY")
gemini_client = None

async def call_ai(system_prompt: str, user_prompt: str) -> str:
    if AZURE_URL:
        logger.info("Calling az")
        return await call_azure(system_prompt, user_prompt)
    elif GEMINI_KEY:
        logger.info("Calling gemini")
        return await call_gemini(system_prompt, user_prompt)
    else:
        logger.error("where tf the ai provider")
        raise ValueError("No AI provider configured")

async def call_azure(system_prompt: str, user_prompt: str) -> str:
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
            return resp.json()["choices"][0]["message"]["content"]
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

async def call_gemini(system_prompt: str, user_prompt: str) -> str:
    try:
        response = await _get_gemini_client().aio.models.generate_content(
            model="gemini-2.0-flash",
            contents=user_prompt,
            config=genai.types.GenerateContentConfig(
                system_instruction=system_prompt,
            ),
        )
        return response.text
    except Exception as e:
        logger.error(f"Gemini call failed: {e}")
        raise
