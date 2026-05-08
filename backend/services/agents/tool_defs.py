"""Gemini function-calling tool declarations for the Context Agent.

The Context Agent is the brain/router — it sees the full graph and decides
what to do: think, delete nodes, expand a node, create new nodes, create a
root, reorganize layout, or signal done.
"""

from google.genai import types

# ── Context Agent Tools ──

think_decl = types.FunctionDeclaration(
    name="think",
    description=(
        "Reason about the current graph and the user's request before acting. "
        "No side effects — just structured thinking that gets logged. "
        "Always call this FIRST before any other tool."
    ),
    parameters=types.Schema(
        type="OBJECT",
        properties={
            "reasoning": types.Schema(
                type="STRING",
                description="Your analysis: what exists in the graph, what the user wants, and your plan of action.",
            ),
        },
        required=["reasoning"],
    ),
)

delete_nodes_decl = types.FunctionDeclaration(
    name="delete_nodes",
    description=(
        "Delete one or more nodes from the mind map. Also removes their links. "
        "Remaining siblings of deleted nodes will be repositioned automatically."
    ),
    parameters=types.Schema(
        type="OBJECT",
        properties={
            "node_ids": types.Schema(
                type="ARRAY",
                items=types.Schema(type="INTEGER"),
                description="Real DB IDs of nodes to delete.",
            ),
        },
        required=["node_ids"],
    ),
)

expand_node_decl = types.FunctionDeclaration(
    name="expand_node",
    description=(
        "Expand a specific node: generate subtopics and fill their details. "
        "Delegates to the Expand Agent which picks subtopics then hands off "
        "to the Research/Plan worker. Children are repositioned automatically."
    ),
    parameters=types.Schema(
        type="OBJECT",
        properties={
            "node_id": types.Schema(type="INTEGER", description="Real DB ID of the node to expand."),
            "prompt": types.Schema(
                type="STRING",
                description="Optional guidance for expansion (e.g. 'focus on economic impacts').",
            ),
        },
        required=["node_id"],
    ),
)

create_nodes_decl = types.FunctionDeclaration(
    name="create_nodes",
    description=(
        "Create new nodes under one or more parents. Each group is a parent with "
        "its children's topic labels. The Research/Plan worker will fill details. "
        "Use this when you know exactly which nodes to add (instead of expand_node)."
    ),
    parameters=types.Schema(
        type="OBJECT",
        properties={
            "groups": types.Schema(
                type="ARRAY",
                items=types.Schema(
                    type="OBJECT",
                    properties={
                        "parent_id": types.Schema(type="INTEGER", description="Real DB ID of the parent node."),
                        "children": types.Schema(
                            type="ARRAY",
                            items=types.Schema(type="STRING"),
                            description="Topic labels for new child nodes.",
                        ),
                    },
                    required=["parent_id", "children"],
                ),
                description="List of [parent, children...] groups.",
            ),
        },
        required=["groups"],
    ),
)

create_root_decl = types.FunctionDeclaration(
    name="create_root",
    description=(
        "Create a root node for the mind map. Use when: (1) the graph is empty "
        "(first prompt), or (2) user wants a second/separate mind map root."
    ),
    parameters=types.Schema(
        type="OBJECT",
        properties={
            "topic": types.Schema(type="STRING", description="Short display label for the root node."),
            "summary": types.Schema(type="STRING", description="One-line summary of this root."),
        },
        required=["topic", "summary"],
    ),
)

reorganize_decl = types.FunctionDeclaration(
    name="reorganize",
    description=(
        "Reposition the entire graph layout. Only call when the user explicitly "
        "asks to reorganize, rearrange, or clean up the layout. "
        "Walks all parents top-down and repositions their children. Root stays in place."
    ),
    parameters=types.Schema(
        type="OBJECT",
        properties={},
    ),
)

done_decl = types.FunctionDeclaration(
    name="done",
    description="Signal that you are finished. Call this as your final tool call.",
    parameters=types.Schema(
        type="OBJECT",
        properties={
            "summary": types.Schema(type="STRING", description="1-2 sentence recap of what was done."),
        },
        required=["summary"],
    ),
)

CONTEXT_TOOLS = [
    types.Tool(
        function_declarations=[
            think_decl,
            delete_nodes_decl,
            expand_node_decl,
            create_nodes_decl,
            create_root_decl,
            reorganize_decl,
            done_decl,
        ]
    )
]

CONTEXT_TOOL_CONFIG = types.ToolConfig(
    function_calling_config=types.FunctionCallingConfig(mode="ANY"),
)
