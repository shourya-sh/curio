"""Gemini function-calling tool declarations for the agentic mind-map loop."""

from google.genai import types

create_node_decl = types.FunctionDeclaration(
    name="create_node",
    description=(
        "Create a new node on the mind map. Returns the real database ID so you can "
        "reference it in subsequent create_link or add_sources calls. "
        "If parent_node_id is set, a parent→child link is auto-created."
    ),
    parameters=types.Schema(
        type="OBJECT",
        properties={
            "topic": types.Schema(type="STRING", description="Short display label for the node (max 255 chars)."),
            "summary": types.Schema(type="STRING", description="One-line summary of this node."),
            "details": types.Schema(type="STRING", description="Multi-sentence explanation with depth."),
            "subtopics": types.Schema(
                type="ARRAY",
                items=types.Schema(type="STRING"),
                description="Bullet-point sub-items inside this node.",
            ),
            "parent_node_id": types.Schema(
                type="INTEGER",
                description="Real DB id of the parent node. Omit for root nodes.",
            ),
            "palette_role": types.Schema(
                type="STRING",
                description="Color role: root, branch_a, branch_b, branch_c, branch_d, branch_e, emphasis, neutral.",
            ),
        },
        required=["topic", "summary", "details"],
    ),
)

create_link_decl = types.FunctionDeclaration(
    name="create_link",
    description=(
        "Create a cross-link between two existing nodes (for non-parent-child relationships). "
        "Parent→child links are already created by create_node when parent_node_id is set."
    ),
    parameters=types.Schema(
        type="OBJECT",
        properties={
            "parent_id": types.Schema(type="INTEGER", description="Real DB id of the source node."),
            "child_id": types.Schema(type="INTEGER", description="Real DB id of the target node."),
            "edge_kind": types.Schema(
                type="STRING",
                description="Edge type: hierarchy, prerequisite, sequence_next, supporting, optional, critical.",
            ),
        },
        required=["parent_id", "child_id"],
    ),
)

add_sources_decl = types.FunctionDeclaration(
    name="add_sources",
    description=(
        "Attach research sources / references to the mind map. Each source must reference "
        "real node IDs (not temp IDs) returned by earlier create_node calls."
    ),
    parameters=types.Schema(
        type="OBJECT",
        properties={
            "sources": types.Schema(
                type="ARRAY",
                items=types.Schema(
                    type="OBJECT",
                    properties={
                        "title": types.Schema(type="STRING", description="Work title, chapter, or article name."),
                        "url": types.Schema(type="STRING", description="Canonical URL if known."),
                        "publisher": types.Schema(type="STRING", description="Publisher or institution."),
                        "year": types.Schema(type="STRING", description="Publication year if known."),
                        "summary": types.Schema(type="STRING", description="2-4 sentence summary."),
                        "excerpt": types.Schema(type="STRING", description="Short excerpt or paraphrase."),
                        "relevance": types.Schema(type="STRING", description="Why this source matters."),
                        "node_ids": types.Schema(
                            type="ARRAY",
                            items=types.Schema(type="INTEGER"),
                            description="Real DB node IDs this source supports.",
                        ),
                    },
                    required=["title", "node_ids"],
                ),
                description="List of sources with real node IDs.",
            ),
        },
        required=["sources"],
    ),
)

done_decl = types.FunctionDeclaration(
    name="done",
    description="Signal that the mind map is complete. Call this when you are finished creating all nodes, links, and sources.",
    parameters=types.Schema(
        type="OBJECT",
        properties={
            "summary": types.Schema(type="STRING", description="1-2 sentence recap of what was built."),
        },
        required=["summary"],
    ),
)

ALL_TOOLS = [types.Tool(function_declarations=[create_node_decl, create_link_decl, add_sources_decl, done_decl])]

# Disable Gemini's automatic function calling (AFC) — we manage the loop ourselves.
TOOL_CONFIG = types.ToolConfig(
    function_calling_config=types.FunctionCallingConfig(mode="ANY"),
)
