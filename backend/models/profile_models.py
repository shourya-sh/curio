from datetime import datetime
from pydantic import BaseModel


class ProfileOut(BaseModel):
    id: str
    display_name: str | None = None
    gemini_api_keys: list[str] = []
    has_azure: bool = False
    updated_at: datetime | None = None

    model_config = {"from_attributes": True}


class ProfileUpdate(BaseModel):
    display_name: str | None = None
    gemini_api_keys: list[str] | None = None
    azure_foundry_url: str | None = None
    azure_foundry_api_key: str | None = None
