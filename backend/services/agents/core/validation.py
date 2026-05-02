from services.agents.draft_models import GraphDraft, GraphEdgeDraft, GraphNodeDraft, SourceDraft


def _topic_key(topic: str) -> str:
    return " ".join(topic.lower().strip().split())


def filter_draft(
    draft: GraphDraft,
    *,
    mode: str,
    max_nodes: int = 18,
    max_fanout: int = 6,
) -> GraphDraft:
    """Deterministic quality gate after LLM stages."""
    seen_topics: set[str] = set()
    nodes: list[GraphNodeDraft] = []
    used_ids: set[str] = set()

    for node in draft.nodes:
        topic = node.topic.strip()
        if not topic:
            continue
        key = _topic_key(topic)
        if key in seen_topics:
            continue
        if mode == "research" and len((node.details or "").strip()) < 20:
            details_blank = not (node.details or "").strip()
            summary_short = len((node.summary or "").strip()) < 20
            if details_blank and summary_short:
                continue
        seen_topics.add(key)
        node.topic = topic[:255]
        node.summary = (node.summary or "").strip()
        node.details = (node.details or "").strip()
        nodes.append(node)
        used_ids.add(node.temp_id)
        if len(nodes) >= max_nodes:
            break

    edges: list[GraphEdgeDraft] = []
    edge_keys: set[tuple[str, str]] = set()
    fanout: dict[str, int] = {}
    for edge in draft.edges:
        if edge.parent_temp_id == edge.child_temp_id:
            continue
        if edge.parent_temp_id not in used_ids or edge.child_temp_id not in used_ids:
            continue
        key = (edge.parent_temp_id, edge.child_temp_id)
        if key in edge_keys:
            continue
        if fanout.get(edge.parent_temp_id, 0) >= max_fanout:
            continue
        edge_keys.add(key)
        fanout[edge.parent_temp_id] = fanout.get(edge.parent_temp_id, 0) + 1
        edges.append(edge)

    # Ensure disconnected drafts still become a readable tree.
    if nodes and not edges:
        root = nodes[0].temp_id
        edges = [
            GraphEdgeDraft(parent_temp_id=root, child_temp_id=node.temp_id, edge_kind="hierarchy")
            for node in nodes[1:]
        ]

    sources: list[SourceDraft] = []
    for s in draft.sources or []:
        title = (s.title or "").strip()
        if not title:
            continue
        temp_ids: list[str] = []
        for tid in s.node_temp_ids or []:
            tid_norm = (str(tid) if tid is not None else "").strip()
            if tid_norm in used_ids:
                temp_ids.append(tid_norm)
        if not temp_ids:
            continue
        sources.append(
            SourceDraft(
                title=title[:500],
                url=(s.url or "").strip()[:2048],
                publisher=(s.publisher or "").strip()[:500],
                year=(s.year or "").strip()[:32],
                summary=(s.summary or "").strip()[:4000],
                excerpt=(s.excerpt or "").strip()[:800],
                relevance=(s.relevance or "").strip()[:2000],
                node_temp_ids=temp_ids,
            )
        )
        if len(sources) >= 12:
            break

    return GraphDraft(
        nodes=nodes,
        edges=edges,
        assistant_summary=draft.assistant_summary,
        sources=sources,
    )
