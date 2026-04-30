from pydantic import BaseModel
from typing import Any, Optional
from datetime import datetime


class NodeCreate(BaseModel):
    topic: str
    summary: Optional[str] = None
    details: Optional[str] = None
    parent_id: Optional[int] = None
    position_x: float = 0
    position_y: float = 0
    node_type: str = "topic"
    color: Optional[str] = None
    subtopics: Optional[Any] = None
    depth: Optional[int] = None


class NodeUpdate(BaseModel):
    topic: Optional[str] = None
    summary: Optional[str] = None
    details: Optional[str] = None
    position_x: Optional[float] = None
    position_y: Optional[float] = None
    node_type: Optional[str] = None
    color: Optional[str] = None
    subtopics: Optional[Any] = None
    depth: Optional[int] = None


class NodeBulkItem(BaseModel):
    """One node's worth of updates for the bulk-save endpoint."""
    id: int
    topic: Optional[str] = None
    summary: Optional[str] = None
    details: Optional[str] = None
    position_x: Optional[float] = None
    position_y: Optional[float] = None
    node_type: Optional[str] = None
    color: Optional[str] = None
    subtopics: Optional[Any] = None
    depth: Optional[int] = None


class NodeBulkUpdate(BaseModel):
    nodes: list[NodeBulkItem]


class NodeRestoreItem(BaseModel):
    id: int
    topic: str
    summary: Optional[str] = None
    details: Optional[str] = None
    subtopics: Optional[Any] = None
    depth: int = 0
    position_x: float
    position_y: float
    node_type: str = "topic"
    color: Optional[str] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None


class LinkRestoreItem(BaseModel):
    id: Optional[int] = None
    parent_id: int
    child_id: int
    color: Optional[str] = None
    line_style: Optional[str] = None
    created_at: Optional[datetime] = None


class NodeRestorePayload(BaseModel):
    node: NodeRestoreItem
    links: list[LinkRestoreItem] = []
