from pydantic import BaseModel
from typing import Any, Optional, List
from datetime import datetime


class SessionCreate(BaseModel):
    title: str
    mode: str = "research"

class SessionUpdate(BaseModel):
    title: str

class SessionPrompt(BaseModel):
    prompt: str


class NodeOut(BaseModel):
    id: int
    session_id: int
    topic: str
    summary: Optional[str] = None
    details: Optional[str] = None
    # JSONB field can hold either AI subtopic arrays or manual metadata objects.
    subtopics: Optional[Any] = None
    depth: int
    position_x: float = 0
    position_y: float = 0
    node_type: str = "topic"
    color: Optional[str] = None
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class LinkOut(BaseModel):
    id: int
    session_id: int
    parent_id: int
    child_id: int
    created_at: datetime

    class Config:
        from_attributes = True


class MessageOut(BaseModel):
    id: int
    session_id: int
    role: str
    content: str
    created_at: datetime

    class Config:
        from_attributes = True


class SessionDetail(BaseModel):
    id: int
    user_id: Optional[int] = None
    title: str
    mode: str
    created_at: datetime
    updated_at: datetime
    nodes: List[NodeOut] = []
    links: List[LinkOut] = []
    messages: List[MessageOut] = []

    class Config:
        from_attributes = True