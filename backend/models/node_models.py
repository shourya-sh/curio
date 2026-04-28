from pydantic import BaseModel
from typing import Any, Optional


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


class NodeUpdate(BaseModel):
    topic: Optional[str] = None
    summary: Optional[str] = None
    details: Optional[str] = None
    position_x: Optional[float] = None
    position_y: Optional[float] = None
    node_type: Optional[str] = None
    color: Optional[str] = None
    subtopics: Optional[Any] = None


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


class NodeBulkUpdate(BaseModel):
    nodes: list[NodeBulkItem]
