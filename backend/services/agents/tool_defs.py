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
                description=(
                    "What exists, what the user is really asking (guiding topic), "
                    "what is still missing vs slop to avoid, and your concrete tool plan."
                ),
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
                description=(
                    "Optional focus for this expansion (angles, constraints, tone, "
                    "what to emphasize). The user's full latest chat message is "
                    "always passed separately to the Expand Agent — use this field "
                    "to steer *this* node (e.g. 'prioritize cold chain and compliance')."
                ),
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
        "Use this when you know exactly which nodes to add (instead of expand_node). "
        "Every child label must be clearly relevant to the user's guiding question "
        "— no filler topics."
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
        "Recompute layout positions for the whole graph using the session's "
        "current layout_mode. Call when the user explicitly asks to clean up "
        "the layout, or right after adding/removing nodes to tidy things."
    ),
    parameters=types.Schema(
        type="OBJECT",
        properties={},
    ),
)

set_layout_mode_decl = types.FunctionDeclaration(
    name="set_layout_mode",
    description=(
        "Pick the visual layout pattern that best fits the map's shape and the "
        "user's intent. The choice is persisted on the session and the graph is "
        "re-laid-out immediately. Choose from:\n"
        "  - radial : sun pattern around the root. Default. Best for hierarchical "
        "knowledge maps where one root branches into many topics.\n"
        "  - tree   : top-down layered (depth = row). Best for clear hierarchies, "
        "step-by-step flows, prerequisites, or strict parent→child structures.\n"
        "  - grid   : compact square packing. Best for dense maps with many "
        "near-peer items and weak hierarchy (e.g. checklists, glossaries).\n"
        "  - web    : force-directed weave. Best when nodes have many cross-links "
        "across branches (interconnected concepts, systems, networks).\n"
        "Only call when switching is clearly better than the current mode. "
        "Skip the call when current mode is already a good fit."
    ),
    parameters=types.Schema(
        type="OBJECT",
        properties={
            "mode": types.Schema(
                type="STRING",
                description="One of: radial, tree, grid, web.",
            ),
            "reason": types.Schema(
                type="STRING",
                description="1 sentence on why this layout fits the prompt + current graph.",
            ),
        },
        required=["mode", "reason"],
    ),
)

done_decl = types.FunctionDeclaration(
    name="done",
    description=(
        "Signal that you are finished. Call this as your final tool call only "
        "after the map adequately addresses the user's guiding question without "
        "adding irrelevant branches."
    ),
    parameters=types.Schema(
        type="OBJECT",
        properties={
            "summary": types.Schema(
                type="STRING",
                description=(
                    "1-2 sentences: what changed in the map. If important caveats, "
                    "limits, or open questions remain **that matter for their stated "
                    "topic**, add one short factual clause (no vague hand-waving)."
                ),
            ),
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
            set_layout_mode_decl,
            done_decl,
        ]
    )
]

CONTEXT_TOOL_CONFIG = types.ToolConfig(
    function_calling_config=types.FunctionCallingConfig(mode="ANY"),
)
