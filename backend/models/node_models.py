from pydantic import BaseModel
from typing import Optional


class NodeCreate(BaseModel):
    topic: str
    summary: Optional[str] = None
    details: Optional[str] = None
    parent_id: Optional[int] = None


class NodeUpdate(BaseModel):
    topic: Optional[str] = None
    summary: Optional[str] = None
    details: Optional[str] = None
