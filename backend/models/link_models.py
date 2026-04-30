from pydantic import BaseModel
from datetime import datetime
from typing import Optional


class LinkCreate(BaseModel):
    parent_id: int
    child_id: int
    color: Optional[str] = None
    line_style: Optional[str] = None


class LinkUpdate(BaseModel):
    color: Optional[str] = None
    line_style: Optional[str] = None


class LinkRestorePayload(BaseModel):
    id: int
    parent_id: int
    child_id: int
    color: Optional[str] = None
    line_style: Optional[str] = None
    created_at: Optional[datetime] = None
