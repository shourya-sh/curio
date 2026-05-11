from pydantic import BaseModel, field_serializer
from typing import Any, Optional, List
from datetime import datetime
from uuid import UUID


class SessionCreate(BaseModel):
    title: str
    mode: str = "research"
    layout_mode: str = "radial"
    # Optional (e.g. first prompt) when title slugifies to empty.
    slug_source: Optional[str] = None

class SessionUpdate(BaseModel):
    """Patch a session. All fields optional — only provided ones are updated."""
    title: Optional[str] = None
    layout_mode: Optional[str] = None

class SessionPrompt(BaseModel):
    prompt: str
    anchor_node_id: Optional[int] = None


class SessionRelayout(BaseModel):
    """Optional override for the on-demand relayout endpoint. When `mode` is
    omitted the session's stored layout_mode wins."""
    mode: Optional[str] = None


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
    original_position_x: float = 0
    original_position_y: float = 0
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
    color: Optional[str] = None
    line_style: str = "solid"
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
    slug: str
    user_id: Optional[str | UUID] = None
    title: str
    mode: str
    layout_mode: str = "radial"
    created_at: datetime
    updated_at: datetime
    nodes: List[NodeOut] = []
    links: List[LinkOut] = []
    messages: List[MessageOut] = []

    @field_serializer("user_id")
    def serialize_user_id(self, v: str | UUID | None) -> str | None:
        return str(v) if v is not None else None

    class Config:
        from_attributes = True