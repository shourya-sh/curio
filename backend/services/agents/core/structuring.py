from models.tables import NodeTable
from services import canvas_layout
from services.agents.draft_models import GraphDraft, StructuredEdge, StructuredGraph, StructuredNode
from services.graph_palette import edge_color, line_style, node_color


def organize(*, draft: GraphDraft, mode: str, anchor: NodeTable | None = None) -> StructuredGraph:
    positions = canvas_layout.layout_graph(draft.nodes, draft.edges, anchor=anchor)
    parent_by_child = {edge.child_temp_id: edge.parent_temp_id for edge in draft.edges}
    branch_by_root: dict[str, int] = {}

    nodes: list[StructuredNode] = []
    for index, node in enumerate(draft.nodes):
        pos = positions.get(node.temp_id)
        if not pos:
            continue
        root_id = node.temp_id
        while root_id in parent_by_child:
            root_id = parent_by_child[root_id]
        if root_id not in branch_by_root:
            branch_by_root[root_id] = len(branch_by_root)
        branch_index = branch_by_root[root_id]
        nodes.append(
            StructuredNode(
                temp_id=node.temp_id,
                topic=node.topic.strip()[:255],
                summary=node.summary.strip(),
                details=node.details.strip(),
                subtopics=node.subtopics,
                depth=pos.depth,
                position_x=pos.position_x,
                position_y=pos.position_y,
                color=node_color(mode, node.palette_role, pos.depth, branch_index or index),
            )
        )

    known = {node.temp_id for node in nodes}
    edges: list[StructuredEdge] = []
    for edge in draft.edges:
        if edge.parent_temp_id not in known or edge.child_temp_id not in known:
            continue
        edges.append(
            StructuredEdge(
                parent_temp_id=edge.parent_temp_id,
                child_temp_id=edge.child_temp_id,
                edge_kind=edge.edge_kind,
                relation=edge.relation,
                color=edge_color(mode, edge.edge_kind),
                line_style=line_style(edge.edge_kind),
            )
        )

    return StructuredGraph(
        nodes=nodes,
        edges=edges,
        assistant_summary=draft.assistant_summary,
        sources=list(draft.sources or []),
    )
