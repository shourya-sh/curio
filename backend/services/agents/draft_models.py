from typing import Any

from pydantic import BaseModel, Field


PaletteRole = str
EdgeKind = str


class GraphNodeDraft(BaseModel):
    temp_id: str = Field(description="Stable temporary id, unique in this response, such as n1.")
    topic: str
    summary: str = ""
    details: str = ""
    subtopics: Any = Field(default_factory=list)
    palette_role: PaletteRole = "neutral"
    layout_hint: str | None = None
    depth_hint: int | None = None


class GraphEdgeDraft(BaseModel):
    parent_temp_id: str
    child_temp_id: str
    edge_kind: EdgeKind = "hierarchy"
    relation: str = ""


class SourceDraft(BaseModel):
    title: str = Field(description="Work title, chapter, or article name.")
    url: str = Field(default="", description="Canonical URL if known; otherwise empty.")
    publisher: str = Field(default="", description="Publisher, journal, university, or author institution.")
    year: str = Field(default="", description="Publication year if known.")
    summary: str = Field(default="", description="2-4 sentences: what this source establishes and how it supports the map.")
    excerpt: str = Field(
        default="",
        description="Short quoted or paraphrased passage (<= 400 chars) illustrating the claim.",
    )
    relevance: str = Field(default="", description="1-2 sentences on why this source matters for the cited nodes.")
    node_temp_ids: list[str] = Field(
        default_factory=list,
        description='Temp ids from this response (e.g. "n2", "n5") for every node this source substantiates; at least one required.',
    )


class GraphDraft(BaseModel):
    nodes: list[GraphNodeDraft] = Field(default_factory=list)
    edges: list[GraphEdgeDraft] = Field(default_factory=list)
    assistant_summary: str = ""
    sources: list[SourceDraft] = Field(
        default_factory=list,
        description="4-8 substantive references with rich metadata for the Sources panel.",
    )


class StructuredNode(BaseModel):
    temp_id: str
    topic: str
    summary: str = ""
    details: str = ""
    subtopics: Any = Field(default_factory=list)
    depth: int = 0
    position_x: float = 0
    position_y: float = 0
    color: str | None = None


class StructuredEdge(BaseModel):
    parent_temp_id: str
    child_temp_id: str
    edge_kind: EdgeKind = "hierarchy"
    relation: str = ""
    color: str | None = None
    line_style: str = "solid"


class StructuredGraph(BaseModel):
    nodes: list[StructuredNode] = Field(default_factory=list)
    edges: list[StructuredEdge] = Field(default_factory=list)
    assistant_summary: str = ""
    sources: list[SourceDraft] = Field(default_factory=list)
