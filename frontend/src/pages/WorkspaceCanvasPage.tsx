import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useLocation, useParams } from 'react-router-dom'
import { AppTopBar } from '../components/AppTopBar'
import { NodeColorField } from '../components/workspace/NodeColorField'
import { MindMapCanvas } from '../components/workspace/MindMapCanvas'
import { CANVAS_H, CANVAS_W } from '../lib/canvasConstants'
import {
  bulkUpdateNodes,
  createLink,
  createNode,
  deleteNode,
  deleteLink,
  getSession,
  postSessionPromptStream,
  restoreLink,
  restoreNode,
  updateLink,
  updateNode,
  type LinkLineStyle,
  type LinkOut,
  type LinkUpdatePayload,
  type NodeOut,
  type SessionDetail,
  type ResearchSource,
} from '../lib/api'
import { layoutStackedNodes } from '../lib/graphLayout'
import { buildManualLinkPayload, buildManualNodePayload, buildNodeStylePatch } from '../lib/manualGraph'
import { readNodeRadiusPx } from '../lib/nodeDisplay'
import { nodeOrbStyle } from '../lib/nodeOrbStyle'
import { markSignedIn } from '../lib/auth'
import { recordSessionOpened } from '../lib/sessionRecent'

interface ChatMessage {
  id: string
  role: 'user' | 'system'
  content: string
  timestamp: string
}

interface DeleteUndoEntry {
  node: NodeOut
  links: LinkOut[]
}

interface HistoryEntry {
  before: SessionDetail
  after: SessionDetail
  syncForward: () => Promise<unknown>
  syncBackward: () => Promise<unknown>
  localForward?: () => void
  localBackward?: () => void
}

type RightPanelMode = 'none' | 'ai' | 'nodes' | 'sources'
type NodesPanelView = 'catalog' | 'detail'

function removeNodeDeterministic(session: SessionDetail, nodeId: number): SessionDetail {
  return {
    ...session,
    nodes: session.nodes.filter((n) => n.id !== nodeId),
    links: session.links.filter((l) => l.parent_id !== nodeId && l.child_id !== nodeId),
  }
}

function cloneSession(session: SessionDetail): SessionDetail {
  return {
    ...session,
    nodes: (session.nodes ?? []).map((node) => ({ ...node })),
    links: (session.links ?? []).map((link) => ({ ...link })),
    messages: (session.messages ?? []).map((message) => ({ ...message })),
  }
}

function applyNodePatchDeterministic(session: SessionDetail, nodeId: number, patch: Partial<NodeOut>): SessionDetail {
  return {
    ...session,
    nodes: session.nodes.map((node) => (node.id === nodeId ? { ...node, ...patch } : node)),
  }
}

function addNodeDeterministic(session: SessionDetail, node: NodeOut): SessionDetail {
  if (session.nodes.some((item) => item.id === node.id)) return session
  return { ...session, nodes: [...session.nodes, node].sort((a, b) => a.id - b.id) }
}

function addLinkDeterministic(session: SessionDetail, link: LinkOut): SessionDetail {
  const existing = session.links.find((item) => item.id === link.id)
  if (existing) return session
  if (session.links.some((item) => item.parent_id === link.parent_id && item.child_id === link.child_id)) {
    return session
  }
  return { ...session, links: [...session.links, link].sort((a, b) => a.id - b.id) }
}

function removeLinkDeterministic(session: SessionDetail, linkId: number): SessionDetail {
  return { ...session, links: session.links.filter((link) => link.id !== linkId) }
}

function applyLinkPatchDeterministic(session: SessionDetail, linkId: number, patch: Partial<LinkOut>): SessionDetail {
  return {
    ...session,
    links: session.links.map((link) => (link.id === linkId ? { ...link, ...patch } : link)),
  }
}

function RailFace({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <span className={`rail-icon ${className}`.trim()}>{children}</span>
}

function LinkStyleGlyph({ kind }: { kind: LinkLineStyle }) {
  const common = { fill: 'none', stroke: 'currentColor', strokeLinecap: 'round' as const }
  if (kind === 'solid') return <path d='M4 12h16' strokeWidth='2.2' {...common} />
  if (kind === 'dashed')
    return (
      <g {...common} strokeWidth='2.2'>
        <path d='M4 12h5' />
        <path d='M10 12h5' />
        <path d='M16 12h5' />
      </g>
    )
  if (kind === 'dotted')
    return (
      <g fill='currentColor' stroke='none'>
        <circle cx='6' cy='12' r='1.4' />
        <circle cx='12' cy='12' r='1.4' />
        <circle cx='18' cy='12' r='1.4' />
      </g>
    )
  return <path d='M4 12h16' strokeWidth='4' {...common} />
}

function nodeTitleCharLimit(radiusPx: number): number {
  const diameter = radiusPx * 2
  const charsPerLine = Math.max(5, Math.floor((diameter * 0.72) / 7))
  const lines = Math.max(2, Math.min(4, Math.floor(diameter / 36)))
  return Math.max(12, Math.min(96, charsPerLine * lines))
}

function nodePanelCopy(mode: SessionDetail['mode']) {
  if (mode === 'plan') {
    return {
      catalogTitle: 'Plan nodes',
      catalogSubtitle: 'Every task and dependency on this map.',
      detailKicker: 'Plan item',
      summaryLabel: 'Outcome',
      detailsLabel: 'Reasoning',
      subtopicsLabel: 'Steps / checkpoints',
      emptyDetails: 'No plan detail has been saved for this node yet.',
    }
  }
  return {
    catalogTitle: 'Research nodes',
    catalogSubtitle: 'Every concept and explanation on this map.',
    detailKicker: 'Research note',
    summaryLabel: 'Summary',
    detailsLabel: 'Deep dive',
    subtopicsLabel: 'Subtopics / notes',
    emptyDetails: 'No research detail has been saved for this node yet.',
  }
}

function renderSubtopics(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .map((item) => {
        if (typeof item === 'string') return item
        if (item && typeof item === 'object') {
          const record = item as Record<string, unknown>
          const label = record.title ?? record.topic ?? record.label ?? record.name
          const text = record.summary ?? record.details ?? record.description
          return [label, text].filter(Boolean).join(': ')
        }
        return String(item)
      })
      .filter(Boolean)
  }
  if (value && typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>).map(([key, item]) => `${key}: ${String(item)}`)
  }
  if (typeof value === 'string' && value.trim()) return [value.trim()]
  return []
}

function parseSourcesFromSession(session: SessionDetail | undefined): ResearchSource[] {
  if (!session?.messages?.length) return []
  const rows = session.messages.filter((m) => m.role === 'sources')
  if (!rows.length) return []
  const last = rows[rows.length - 1]
  try {
    const j = JSON.parse(last.content) as { sources?: ResearchSource[] }
    return Array.isArray(j.sources) ? j.sources : []
  } catch {
    return []
  }
}

function orderedNodesForCatalog(session: SessionDetail): NodeOut[] {
  const byId = new Map(session.nodes.map((node) => [node.id, node]))
  const children = new Map<number, number[]>()
  const childIds = new Set<number>()
  for (const link of session.links) {
    children.set(link.parent_id, [...(children.get(link.parent_id) ?? []), link.child_id])
    childIds.add(link.child_id)
  }
  const roots = session.nodes
    .filter((node) => !childIds.has(node.id))
    .sort((a, b) => a.depth - b.depth || a.id - b.id)
  const out: NodeOut[] = []
  const seen = new Set<number>()
  const visit = (node: NodeOut) => {
    if (seen.has(node.id)) return
    seen.add(node.id)
    out.push(node)
    ;(children.get(node.id) ?? [])
      .map((id) => byId.get(id))
      .filter((item): item is NodeOut => Boolean(item))
      .sort((a, b) => a.depth - b.depth || a.id - b.id)
      .forEach(visit)
  }
  roots.forEach(visit)
  session.nodes
    .filter((node) => !seen.has(node.id))
    .sort((a, b) => a.depth - b.depth || a.id - b.id)
    .forEach(visit)
  return out
}

export function WorkspaceCanvasPage() {
  const { sessionId = '' } = useParams()
  const location = useLocation()
  const queryClient = useQueryClient()
  const [chatInput, setChatInput] = useState('')
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([])
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [hoveredId, setHoveredId] = useState<number | null>(null)
  const [selectedLinkId, setSelectedLinkId] = useState<number | null>(null)
  const [selectedLinkPos, setSelectedLinkPos] = useState<{ left: number; top: number }>({ left: 0, top: 0 })
  const [manualOpen, setManualOpen] = useState(false)
  const [rightPanelMode, setRightPanelMode] = useState<RightPanelMode>('none')
  const [sourcesList, setSourcesList] = useState<ResearchSource[]>([])
  const [nodesPanelView, setNodesPanelView] = useState<NodesPanelView>('catalog')
  const [panelNodeId, setPanelNodeId] = useState<number | null>(null)
  const [streaming, setStreaming] = useState(false)
  const [placeNodeMode, setPlaceNodeMode] = useState(false)
  const [connectMode, setConnectMode] = useState(false)
  const [errorBanner, setErrorBanner] = useState<string | null>(null)
  const [pendingPos, setPendingPos] = useState<Map<number, { x: number; y: number }>>(() => new Map())
  const [history, setHistory] = useState<HistoryEntry[]>([])
  const [historyIndex, setHistoryIndex] = useState(-1)
  const [deleteConfirm, setDeleteConfirm] = useState<DeleteUndoEntry | null>(null)
  const [linkDeleteConfirm, setLinkDeleteConfirm] = useState<LinkOut | null>(null)
  const [renamingNodeId, setRenamingNodeId] = useState<number | null>(null)
  const [renameDraft, setRenameDraft] = useState('')
  const [stylePopPlacement, setStylePopPlacement] = useState<'top' | 'bottom'>('top')
  const [stylePopPos, setStylePopPos] = useState<{ left: number; top: number }>({ left: 0, top: 0 })
  const layoutStateRef = useRef<{ sid: string; done: boolean }>({ sid: '', done: false })
  const syncChainRef = useRef<Promise<void>>(Promise.resolve())
  const historyRef = useRef<HistoryEntry[]>([])
  const historyIndexRef = useRef(-1)
  const canvasRef = useRef<HTMLElement | null>(null)
  const stylePopRef = useRef<HTMLDivElement | null>(null)
  const linkPopWrapRef = useRef<HTMLDivElement | null>(null)
  const linkLocalStyleMigratedRef = useRef(false)
  const [linkPopSubmenu, setLinkPopSubmenu] = useState<'color' | 'style' | null>(null)
  const [linkPopPos, setLinkPopPos] = useState<{ left: number; top: number }>({ left: 0, top: 0 })

  useEffect(() => {
    markSignedIn()
  }, [])

  const sessionQuery = useQuery<SessionDetail>({
    queryKey: ['session', sessionId],
    queryFn: () => getSession(sessionId),
    enabled: sessionId.length > 0,
    placeholderData: (previous) => previous,
  })
  const session = sessionQuery.data
    ? {
        ...sessionQuery.data,
        nodes: sessionQuery.data.nodes ?? [],
        links: sessionQuery.data.links ?? [],
        messages: sessionQuery.data.messages ?? [],
      }
    : null
  const loading = sessionQuery.isPending && !session
  const invalidateSession = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ['session', sessionId] })
  }, [queryClient, sessionId])

  useEffect(() => {
    if (!sessionId || !session || linkLocalStyleMigratedRef.current) return
    const key = `curio:linkStyles:${sessionId}`
    const raw = localStorage.getItem(key)
    if (!raw) {
      linkLocalStyleMigratedRef.current = true
      return
    }
    linkLocalStyleMigratedRef.current = true
    let parsed: Array<[number, LinkLineStyle]>
    try {
      parsed = JSON.parse(raw) as Array<[number, LinkLineStyle]>
    } catch {
      localStorage.removeItem(key)
      return
    }
    const sid = Number(session.id)
    void (async () => {
      try {
        for (const [linkId, style] of parsed) {
          const row = session.links.find((l) => l.id === linkId)
          if (!row) continue
          const current = (row.line_style ?? 'solid') as string
          if (current === style) continue
          await updateLink(sid, linkId, { line_style: style })
        }
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Failed to migrate saved link styles.'
        setErrorBanner(message)
      } finally {
        localStorage.removeItem(key)
        invalidateSession()
      }
    })()
  }, [session, sessionId, invalidateSession])

  useEffect(() => {
    setSourcesList(parseSourcesFromSession(session ?? undefined))
  }, [session])

  const canUndo = historyIndex >= 0
  const canRedo = historyIndex < history.length - 1

  useEffect(() => {
    historyRef.current = history
  }, [history])

  useEffect(() => {
    historyIndexRef.current = historyIndex
  }, [historyIndex])

  const enqueueHistorySync = useCallback(
    (runner: () => Promise<unknown>) => {
      syncChainRef.current = syncChainRef.current
        .then(async () => {
          await runner()
        })
        .catch((error: unknown) => {
          const message = error instanceof Error ? error.message : 'Failed to sync history action.'
          setErrorBanner(message)
          invalidateSession()
        })
    },
    [invalidateSession],
  )

  const commitHistoryEntry = useCallback(
    (entry: HistoryEntry) => {
      setHistory((current) => {
        const next = current.slice(0, historyIndexRef.current + 1)
        next.push(entry)
        historyRef.current = next
        return next
      })
      setHistoryIndex(() => {
        const nextIndex = historyIndexRef.current + 1
        historyIndexRef.current = nextIndex
        return nextIndex
      })
      enqueueHistorySync(entry.syncForward)
    },
    [enqueueHistorySync],
  )

  const mutUpdateNode = useMutation({
    mutationFn: (v: { sid: number; id: number; patch: Parameters<typeof updateNode>[2] }) =>
      updateNode(v.sid, v.id, v.patch),
    onError: (e: Error) => setErrorBanner(e.message),
    onSuccess: () => {
      setErrorBanner(null)
    },
  })

  const mutUpdateLink = useMutation({
    mutationFn: (v: { sid: number; id: number; patch: LinkUpdatePayload }) => updateLink(v.sid, v.id, v.patch),
    onError: (e: Error) => setErrorBanner(e.message),
    onSuccess: () => {
      setErrorBanner(null)
    },
  })

  const mutCreateNode = useMutation({
    mutationFn: (payload: { sid: number; body: Parameters<typeof createNode>[1] }) =>
      createNode(payload.sid, payload.body),
    onError: (e: Error) => setErrorBanner(e.message),
    onSuccess: () => {
      setErrorBanner(null)
    },
  })

  const mutLink = useMutation({
    mutationFn: (p: { sid: number; body: Parameters<typeof createLink>[1] }) =>
      createLink(p.sid, p.body),
    onError: (e: Error) => setErrorBanner(e.message),
    onSuccess: () => {
      setErrorBanner(null)
    },
  })

  const mutDeleteNode = useMutation({
    mutationFn: (v: { sid: number; id: number }) => deleteNode(v.sid, v.id),
    onError: (e: Error) => {
      setErrorBanner(e.message)
    },
    onSuccess: () => {
      setErrorBanner(null)
    },
  })

  const mutRestoreNode = useMutation({
    mutationFn: (v: { sid: number; entry: DeleteUndoEntry }) =>
      restoreNode(v.sid, v.entry.node.id, { node: v.entry.node, links: v.entry.links }),
    onError: (e: Error) => {
      setErrorBanner(e.message)
    },
    onSuccess: () => {
      setErrorBanner(null)
    },
  })

  useEffect(() => {
    if (!sessionId || !session) return
    const st = layoutStateRef.current
    if (st.sid !== sessionId) {
      layoutStateRef.current = { sid: sessionId, done: false }
    }
    if (layoutStateRef.current.done) return
    const items = layoutStackedNodes(session.nodes)
    if (items.length === 0) {
      layoutStateRef.current.done = true
      return
    }
    layoutStateRef.current.done = true
    void bulkUpdateNodes(Number(sessionId), { nodes: items })
      .then(() => {
        setErrorBanner(null)
        void queryClient.invalidateQueries({ queryKey: ['session', sessionId] })
      })
      .catch((e: Error) => {
        setErrorBanner(e.message)
        layoutStateRef.current.done = false
      })
  }, [sessionId, session, queryClient])

  useEffect(() => {
    if (sessionQuery.error) {
      const message =
        sessionQuery.error instanceof Error
          ? sessionQuery.error.message
          : 'Failed to load session.'
      setErrorBanner(message)
      return
    }
    if (!session) return
    localStorage.setItem('curio:lastSessionId', String(session.id))
    recordSessionOpened(session.id)
  }, [session, sessionQuery.error])

  useEffect(() => {
    if (!session) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return
      const target = e.target as HTMLElement | null
      const tag = target?.tagName?.toLowerCase()
      const isTypingTarget =
        tag === 'input' ||
        tag === 'textarea' ||
        tag === 'select' ||
        Boolean(target?.isContentEditable)
      if (isTypingTarget) return
      const key = e.key.toLowerCase()
      const wantsUndo = key === 'z' && !e.shiftKey
      const wantsRedo = key === 'y' || (key === 'z' && e.shiftKey)
      if (wantsUndo) {
        const currentIndex = historyIndexRef.current
        const entry = historyRef.current[currentIndex]
        if (!entry) return
        e.preventDefault()
        queryClient.setQueryData<SessionDetail>(['session', sessionId], cloneSession(entry.before))
        entry.localBackward?.()
        const nextIndex = currentIndex - 1
        historyIndexRef.current = nextIndex
        setHistoryIndex(nextIndex)
        enqueueHistorySync(entry.syncBackward)
      } else if (wantsRedo) {
        const nextIndex = historyIndexRef.current + 1
        const entry = historyRef.current[nextIndex]
        if (!entry) return
        e.preventDefault()
        queryClient.setQueryData<SessionDetail>(['session', sessionId], cloneSession(entry.after))
        entry.localForward?.()
        historyIndexRef.current = nextIndex
        setHistoryIndex(nextIndex)
        enqueueHistorySync(entry.syncForward)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [enqueueHistorySync, queryClient, session, sessionId])

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      const target = e.target as HTMLElement | null
      const tag = target?.tagName?.toLowerCase()
      const isTypingTarget =
        tag === 'input' ||
        tag === 'textarea' ||
        tag === 'select' ||
        Boolean(target?.isContentEditable)
      if (isTypingTarget) return
      if (renamingNodeId != null) {
        setRenamingNodeId(null)
        e.preventDefault()
        return
      }
      if (deleteConfirm) {
        setDeleteConfirm(null)
        e.preventDefault()
        return
      }
      if (linkDeleteConfirm) {
        setLinkDeleteConfirm(null)
        e.preventDefault()
        return
      }
      e.preventDefault()
      if (connectMode) setConnectMode(false)
      if (placeNodeMode) setPlaceNodeMode(false)
      setLinkPopSubmenu(null)
      setSelectedLinkId(null)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [connectMode, deleteConfirm, linkDeleteConfirm, placeNodeMode, renamingNodeId])

  const onSelect = useCallback((id: number | null) => {
    setSelectedId(id)
    setSelectedLinkId(null)
    if (id != null) {
      setPanelNodeId(id)
      setNodesPanelView('detail')
      setRightPanelMode('nodes')
    }
  }, [])

  const onSelectLink = useCallback((id: number | null, pos?: { x: number; y: number }) => {
    setSelectedLinkId(id)
    if (pos && canvasRef.current) {
      const rect = canvasRef.current.getBoundingClientRect()
      setSelectedLinkPos({
        left: (pos.x / CANVAS_W) * rect.width,
        top: (pos.y / CANVAS_H) * rect.height,
      })
    }
    if (id != null) {
      setSelectedId(null)
      setHoveredId(null)
      setRightPanelMode('none')
    }
  }, [])

  const applyTrackedNodePatch = useCallback(
    (nodeId: number, patch: Parameters<typeof updateNode>[2]) => {
      if (!session) return
      const current = queryClient.getQueryData<SessionDetail>(['session', sessionId])
      if (!current) return
      const target = current.nodes.find((item) => item.id === nodeId)
      if (!target) return
      const beforePatch: Parameters<typeof updateNode>[2] = {}
      const targetRecord = target as unknown as Record<string, unknown>
      ;(Object.keys(patch) as Array<keyof Parameters<typeof updateNode>[2]>).forEach((key) => {
        ;(beforePatch as Record<string, unknown>)[String(key)] = targetRecord[String(key)]
      })
      const before = cloneSession(current)
      const after = applyNodePatchDeterministic(before, nodeId, patch as Partial<NodeOut>)
      queryClient.setQueryData<SessionDetail>(['session', sessionId], after)
      const sid = Number(session.id)
      const entry: HistoryEntry = {
        before,
        after,
        syncForward: () => mutUpdateNode.mutateAsync({ sid, id: nodeId, patch }),
        syncBackward: () => mutUpdateNode.mutateAsync({ sid, id: nodeId, patch: beforePatch }),
      }
      commitHistoryEntry(entry)
    },
    [commitHistoryEntry, mutUpdateNode, queryClient, session, sessionId],
  )

  const applyTrackedLinkPatch = useCallback(
    (linkId: number, patch: LinkUpdatePayload) => {
      if (!session) return
      const current = queryClient.getQueryData<SessionDetail>(['session', sessionId])
      if (!current) return
      const target = current.links.find((item) => item.id === linkId)
      if (!target) return
      const targetRecord = target as unknown as Record<string, unknown>
      const hasChange = (Object.keys(patch) as Array<keyof LinkUpdatePayload>).some((key) => {
        if (patch[key] === undefined) return false
        return targetRecord[String(key)] !== patch[key]
      })
      if (!hasChange) return
      const beforePatch: LinkUpdatePayload = {}
      ;(Object.keys(patch) as Array<keyof LinkUpdatePayload>).forEach((key) => {
        if (patch[key] === undefined) return
        ;(beforePatch as Record<string, unknown>)[String(key)] = targetRecord[String(key)]
      })
      const before = cloneSession(current)
      const after = applyLinkPatchDeterministic(before, linkId, patch as Partial<LinkOut>)
      queryClient.setQueryData<SessionDetail>(['session', sessionId], after)
      const sid = Number(session.id)
      commitHistoryEntry({
        before,
        after,
        syncForward: () => mutUpdateLink.mutateAsync({ sid, id: linkId, patch }),
        syncBackward: () => mutUpdateLink.mutateAsync({ sid, id: linkId, patch: beforePatch }),
      })
    },
    [commitHistoryEntry, mutUpdateLink, queryClient, session, sessionId],
  )

  const onDragEnd = useCallback(
    (id: number, x: number, y: number) => {
      const n = session?.nodes.find((o) => o.id === id)
      if (!n) return
      if (Math.abs(n.position_x - x) < 0.01 && Math.abs(n.position_y - y) < 0.01) return
      setPendingPos((m) => {
        const nmap = new Map(m)
        nmap.set(id, { x, y })
        return nmap
      })
      applyTrackedNodePatch(id, { position_x: x, position_y: y })
      setPendingPos((m) => {
        const nmap = new Map(m)
        nmap.delete(id)
        return nmap
      })
    },
    [applyTrackedNodePatch, session?.nodes],
  )

  const onConnectWire = useCallback(
    (fromId: number, toId: number) => {
      if (!session) return
      setSelectedLinkId(null)
      const payload = buildManualLinkPayload(fromId, toId)
      if (!payload) return
      const before = queryClient.getQueryData<SessionDetail>(['session', sessionId])
      if (!before) return
      const sid = Number(session.id)
      void mutLink
        .mutateAsync({ sid, body: payload })
        .then((createdLink) => {
          const beforeSnapshot = cloneSession(before)
          const afterSnapshot = addLinkDeterministic(beforeSnapshot, createdLink)
          queryClient.setQueryData<SessionDetail>(['session', sessionId], afterSnapshot)
          setConnectMode(false)
          commitHistoryEntry({
            before: beforeSnapshot,
            after: afterSnapshot,
            syncForward: () => restoreLink(sid, createdLink),
            syncBackward: () => deleteLink(sid, createdLink.id),
          })
        })
        .catch((error: Error) => {
          setErrorBanner(error.message)
          invalidateSession()
        })
    },
    [commitHistoryEntry, invalidateSession, mutLink, queryClient, session, sessionId],
  )

  const onPlaceNodeComplete = useCallback(
    (cx: number, cy: number, radiusPx: number) => {
      if (!session) return
      setPlaceNodeMode(false)
      const body = buildManualNodePayload(session.mode, {
        centerX: cx,
        centerY: cy,
        radiusPx,
      })
      const before = queryClient.getQueryData<SessionDetail>(['session', sessionId])
      if (!before) return
      void mutCreateNode
        .mutateAsync({ sid: Number(session.id), body })
        .then((createdNode) => {
          const beforeSnapshot = cloneSession(before)
          const afterSnapshot = addNodeDeterministic(beforeSnapshot, createdNode)
          queryClient.setQueryData<SessionDetail>(['session', sessionId], afterSnapshot)
          commitHistoryEntry({
            before: beforeSnapshot,
            after: afterSnapshot,
            syncForward: () => restoreNode(Number(session.id), createdNode.id, { node: createdNode, links: [] }),
            syncBackward: () => deleteNode(Number(session.id), createdNode.id),
          })
        })
        .catch((error: Error) => {
          setErrorBanner(error.message)
          invalidateSession()
        })
    },
    [commitHistoryEntry, invalidateSession, mutCreateNode, queryClient, session, sessionId],
  )

  const initialPrompt: string = location.state?.initialPrompt ?? ''

  useEffect(() => {
    if (!session || !initialPrompt) return
    setChatMessages((prev) => {
      if (prev.some((m) => m.id === 'seed')) return prev
      return [
        { id: 'seed', role: 'user' as const, content: initialPrompt, timestamp: new Date().toLocaleTimeString() },
        {
          id: 'seed2',
          role: 'system' as const,
          content: 'Ready to build this map with AI. Send a prompt or select a node to expand from there.',
          timestamp: new Date().toLocaleTimeString(),
        },
      ]
    })
  }, [session, initialPrompt])

  const sendChat = async () => {
    const prompt = chatInput.trim()
    if (!prompt || !session || streaming) return
    setChatInput('')
    setStreaming(true)
    setErrorBanner(null)
    setChatMessages((prev) => [
      ...prev,
      { id: `u-${Date.now()}`, role: 'user' as const, content: prompt, timestamp: new Date().toLocaleTimeString() },
    ])
    try {
      await postSessionPromptStream(Number(session.id), { prompt, anchor_node_id: selectedId }, (event) => {
        if (event.type === 'status') {
          const message = (event.data as { message?: string }).message
          if (message) {
            setChatMessages((prev) => [
              ...prev,
              { id: `s-${Date.now()}-${prev.length}`, role: 'system', content: message, timestamp: new Date().toLocaleTimeString() },
            ])
          }
          return
        }
        if (event.type === 'node_created') {
          const node = event.data as NodeOut
          queryClient.setQueryData<SessionDetail>(['session', sessionId], (current) =>
            current ? addNodeDeterministic(current, node) : current,
          )
          return
        }
        if (event.type === 'link_created') {
          const link = event.data as LinkOut
          queryClient.setQueryData<SessionDetail>(['session', sessionId], (current) =>
            current ? addLinkDeterministic(current, link) : current,
          )
          return
        }
        if (event.type === 'message_created') {
          const message = event.data as { role?: string; content?: string; id?: number }
          if (!message.content || message.role === 'user') return
          setChatMessages((prev) => [
            ...prev,
            {
              id: message.id ? `m-${message.id}` : `m-${Date.now()}`,
              role: message.role === 'user' ? 'user' : 'system',
              content: message.content ?? '',
              timestamp: new Date().toLocaleTimeString(),
            },
          ])
          return
        }
        if (event.type === 'sources_created') {
          const data = event.data as { sources?: ResearchSource[] }
          setSourcesList(data.sources ?? [])
          return
        }
        if (event.type === 'error') {
          const message = (event.data as { message?: string }).message ?? 'AI request failed.'
          setErrorBanner(message)
        }
      })
      invalidateSession()
    } catch (error) {
      const message = error instanceof Error ? error.message : 'AI request failed.'
      setErrorBanner(message)
    } finally {
      setStreaming(false)
    }
  }

  const showRightPanel = rightPanelMode !== 'none'
  const mainClassName = `mindforge-main${!showRightPanel ? ' mindforge-main--no-right' : ''}`
  const focusedNode: NodeOut | null =
    session && selectedLinkId == null && !connectMode && !placeNodeMode && (hoveredId != null || selectedId != null)
      ? session.nodes.find((n) => n.id === (hoveredId ?? selectedId)) ?? null
      : null
  const focusedStyle = focusedNode
    ? {
        left: `${stylePopPos.left}px`,
        top: `${stylePopPos.top}px`,
      }
    : undefined
  const renamingNode = session?.nodes.find((n) => n.id === renamingNodeId) ?? null
  const renameLimit = renamingNode ? nodeTitleCharLimit(readNodeRadiusPx(renamingNode)) : 24
  const selectedLink = session?.links.find((l) => l.id === selectedLinkId) ?? null
  const selectedLinkStyle: LinkLineStyle = (selectedLink?.line_style ?? 'solid') as LinkLineStyle
  const copy = nodePanelCopy(session?.mode ?? 'research')
  const catalogNodes = session ? orderedNodesForCatalog(session) : []
  const panelNode = session?.nodes.find((node) => node.id === (panelNodeId ?? selectedId)) ?? null
  const panelSubtopics = renderSubtopics(panelNode?.subtopics)
  const contextLinks = session && panelNode
    ? session.links
        .filter((link) => link.parent_id === panelNode.id || link.child_id === panelNode.id)
        .map((link) => {
          const otherId = link.parent_id === panelNode.id ? link.child_id : link.parent_id
          const other = session.nodes.find((node) => node.id === otherId)
          return other ? { link, other, direction: link.parent_id === panelNode.id ? 'Child' : 'Parent' } : null
        })
        .filter((item): item is { link: LinkOut; other: NodeOut; direction: 'Child' | 'Parent' } => Boolean(item))
    : []

  useLayoutEffect(() => {
    if (!focusedNode || !canvasRef.current || !stylePopRef.current) return

    const updatePosition = () => {
      const canvasEl = canvasRef.current
      const popEl = stylePopRef.current
      if (!canvasEl || !popEl) return
      const canvasRect = canvasEl.getBoundingClientRect()

      const xRatio = focusedNode.position_x / CANVAS_W
      const yRatio = focusedNode.position_y / CANVAS_H
      const nodeX = canvasRect.left + xRatio * canvasRect.width
      const nodeY = canvasRect.top + yRatio * canvasRect.height
      const nodeRadius = readNodeRadiusPx(focusedNode) * (canvasRect.width / CANVAS_W)
      const gap = 12

      const popRect = popEl.getBoundingClientRect()
      const topCandidate = nodeY - nodeRadius - popRect.height - gap
      const bottomCandidate = nodeY + nodeRadius + gap
      const placeTop = topCandidate >= canvasRect.top + 8
      let popTopViewport = placeTop
        ? topCandidate
        : Math.min(bottomCandidate, canvasRect.bottom - popRect.height - 8)
      let centerViewport = nodeX

      const halfW = popRect.width / 2
      centerViewport = Math.min(canvasRect.right - halfW - 8, Math.max(canvasRect.left + halfW + 8, centerViewport))
      popTopViewport = Math.min(
        canvasRect.bottom - popRect.height - 8,
        Math.max(canvasRect.top + 8, popTopViewport),
      )

      setStylePopPlacement(placeTop ? 'top' : 'bottom')
      setStylePopPos({
        left: centerViewport - canvasRect.left,
        top: popTopViewport - canvasRect.top,
      })
    }

    updatePosition()
    const raf = requestAnimationFrame(updatePosition)
    window.addEventListener('resize', updatePosition)
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', updatePosition)
    }
  }, [focusedNode])

  useEffect(() => {
    setLinkPopSubmenu(null)
  }, [selectedLinkId])

  useLayoutEffect(() => {
    if (!selectedLink || !canvasRef.current || !linkPopWrapRef.current) return
    const canvas = canvasRef.current
    const wrap = linkPopWrapRef.current
    const pad = 8
    const ax = selectedLinkPos.left
    const ay = selectedLinkPos.top

    const place = () => {
      const cw = canvas.clientWidth
      const ch = canvas.clientHeight
      const rect = wrap.getBoundingClientRect()
      const w = rect.width
      const h = rect.height
      let left = ax - w / 2
      let top = ay - h - 12
      if (top < pad) top = ay + 14
      left = Math.max(pad, Math.min(left, cw - w - pad))
      top = Math.max(pad, Math.min(top, ch - h - pad))
      setLinkPopPos({ left, top })
    }

    place()
    const id = requestAnimationFrame(place)
    window.addEventListener('resize', place)
    return () => {
      cancelAnimationFrame(id)
      window.removeEventListener('resize', place)
    }
  }, [selectedLink, selectedLinkId, selectedLinkPos, linkPopSubmenu])

  useEffect(() => {
    if (linkPopSubmenu == null) return
    const onDoc = (e: MouseEvent) => {
      if (linkPopWrapRef.current?.contains(e.target as Node)) return
      setLinkPopSubmenu(null)
    }
    document.addEventListener('pointerdown', onDoc)
    return () => document.removeEventListener('pointerdown', onDoc)
  }, [linkPopSubmenu])

  const toggleManual = () => {
    setManualOpen((o) => {
      if (o) {
        setPlaceNodeMode(false)
        setConnectMode(false)
      }
      return !o
    })
  }

  const closeManualIfClickedAway = (e: React.MouseEvent<HTMLElement>) => {
    if (!manualOpen) return
    const target = e.target as HTMLElement
    if (target.closest('.mf-rail-column')) return
    setManualOpen(false)
  }

  const confirmDelete = () => {
    if (!session || !deleteConfirm) return
    const current = queryClient.getQueryData<SessionDetail>(['session', sessionId])
    if (!current) return
    const before = cloneSession(current)
    const after = removeNodeDeterministic(before, deleteConfirm.node.id)
    queryClient.setQueryData<SessionDetail>(['session', sessionId], after)
    setSelectedId((value) => (value === deleteConfirm.node.id ? null : value))
    setHoveredId((value) => (value === deleteConfirm.node.id ? null : value))
    const entry: HistoryEntry = {
      before,
      after,
      syncForward: () => mutDeleteNode.mutateAsync({ sid: Number(session.id), id: deleteConfirm.node.id }),
      syncBackward: () => mutRestoreNode.mutateAsync({ sid: Number(session.id), entry: deleteConfirm }),
    }
    commitHistoryEntry(entry)
    setDeleteConfirm(null)
  }

  const undoAction = () => {
    const currentIndex = historyIndexRef.current
    const entry = historyRef.current[currentIndex]
    if (!entry) return
    queryClient.setQueryData<SessionDetail>(['session', sessionId], cloneSession(entry.before))
    entry.localBackward?.()
    const nextIndex = currentIndex - 1
    historyIndexRef.current = nextIndex
    setHistoryIndex(nextIndex)
    enqueueHistorySync(entry.syncBackward)
  }

  const redoAction = () => {
    const nextIndex = historyIndexRef.current + 1
    const entry = historyRef.current[nextIndex]
    if (!entry) return
    queryClient.setQueryData<SessionDetail>(['session', sessionId], cloneSession(entry.after))
    entry.localForward?.()
    historyIndexRef.current = nextIndex
    setHistoryIndex(nextIndex)
    enqueueHistorySync(entry.syncForward)
  }

  const openRenameModal = () => {
    if (!focusedNode) return
    setRenamingNodeId(focusedNode.id)
    setRenameDraft(focusedNode.topic ?? '')
  }

  const submitRename = () => {
    if (!session || !renamingNode) return
    const topic = renameDraft.trim().slice(0, renameLimit)
    if (!topic || topic === renamingNode.topic) {
      setRenamingNodeId(null)
      return
    }
    applyTrackedNodePatch(renamingNode.id, { topic })
    setRenamingNodeId(null)
  }

  const requestDeleteSelectedLink = useCallback(() => {
    if (!session || selectedLinkId == null) return
    const link = session.links.find((l) => l.id === selectedLinkId)
    if (!link) return
    setLinkDeleteConfirm(link)
  }, [selectedLinkId, session])

  const openNodesCatalog = useCallback(() => {
    setRightPanelMode('nodes')
    setNodesPanelView('catalog')
  }, [])

  const openNodeDetail = useCallback((nodeId: number) => {
    setSelectedId(nodeId)
    setSelectedLinkId(null)
    setPanelNodeId(nodeId)
    setNodesPanelView('detail')
    setRightPanelMode('nodes')
  }, [])

  const confirmDeleteLink = useCallback(() => {
    if (!session || !linkDeleteConfirm) return
    const current = queryClient.getQueryData<SessionDetail>(['session', sessionId])
    if (!current) return
    const link = current.links.find((l) => l.id === linkDeleteConfirm.id)
    if (!link) {
      setLinkDeleteConfirm(null)
      setSelectedLinkId(null)
      return
    }
    const before = cloneSession(current)
    const after = removeLinkDeterministic(before, link.id)
    queryClient.setQueryData<SessionDetail>(['session', sessionId], after)
    setSelectedLinkId(null)
    setLinkPopSubmenu(null)
    commitHistoryEntry({
      before,
      after,
      syncForward: () => deleteLink(Number(session.id), link.id),
      syncBackward: () => restoreLink(Number(session.id), link),
    })
    setLinkDeleteConfirm(null)
  }, [commitHistoryEntry, linkDeleteConfirm, queryClient, session, sessionId])

  useEffect(() => {
    if (!session || (selectedId == null && selectedLinkId == null)) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Backspace' && e.key !== 'Delete') return
      const target = e.target as HTMLElement | null
      const tag = target?.tagName?.toLowerCase()
      const isTypingTarget =
        tag === 'input' ||
        tag === 'textarea' ||
        tag === 'select' ||
        Boolean(target?.isContentEditable)
      if (isTypingTarget || mutDeleteNode.isPending) return
      if (deleteConfirm || linkDeleteConfirm) return
      if (selectedLinkId != null) {
        e.preventDefault()
        requestDeleteSelectedLink()
        return
      }
      if (selectedId == null) return
      e.preventDefault()
      const node = session.nodes.find((n) => n.id === selectedId)
      if (!node) return
      const links = session.links.filter((l) => l.parent_id === selectedId || l.child_id === selectedId)
      setDeleteConfirm({ node, links })
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [deleteConfirm, linkDeleteConfirm, mutDeleteNode, requestDeleteSelectedLink, selectedId, selectedLinkId, session])

  return (
    <div className='mindforge-shell'>
      <AppTopBar activeItem='workspace' workspaceSessionId={sessionId} />

      {errorBanner ? (
        <div className='ws-error-banner' role='alert'>
          {errorBanner}
          <button type='button' onClick={() => setErrorBanner(null)} aria-label='Dismiss'>
            ×
          </button>
        </div>
      ) : null}

      <main className={mainClassName} onClickCapture={closeManualIfClickedAway}>
        <div className='mf-rail-column'>
          <div className={`mf-manual-flyout${manualOpen ? ' is-open' : ''}`} aria-hidden={!manualOpen}>
            <button
              type='button'
              className={`mf-fly-btn${placeNodeMode ? ' active' : ''}`}
              title='Add node — press and drag on the canvas to size the circle'
              disabled={!manualOpen}
              onClick={() => {
                setConnectMode(false)
                setSelectedLinkId(null)
                setPlaceNodeMode((p) => !p)
              }}
            >
              <svg width='20' height='20' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2' aria-hidden>
                <circle cx='12' cy='12' r='9' />
                <path d='M12 8v8M8 12h8' strokeLinecap='round' />
              </svg>
            </button>
            <button
              type='button'
              className={`mf-fly-btn${connectMode ? ' active' : ''}`}
              title='Connect — click two nodes or drag between nodes'
              disabled={!manualOpen}
              onClick={() => {
                setPlaceNodeMode(false)
                setHoveredId(null)
                setSelectedId(null)
                setSelectedLinkId(null)
                setConnectMode((c) => !c)
              }}
            >
              <svg width='20' height='20' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2' aria-hidden>
                <path
                  d='M10 13a5 5 0 0 1 0-7l1-1a5 5 0 0 1 7 7l-1 1M14 11a5 5 0 0 1 0 7l-1 1a5 5 0 0 1-7-7l1-1'
                  strokeLinecap='round'
                />
              </svg>
            </button>
          </div>

          <aside className='mf-left-rail' aria-label='Tools'>
            <button
              type='button'
              className={`rail-item${manualOpen ? ' active' : ''}`}
              onClick={toggleManual}
              aria-pressed={manualOpen}
            >
              <span className='rail-icon-box'>
                <span className='rail-icon rail-icon--lg' aria-hidden>
                  +
                </span>
              </span>
              <span className='rail-label'>Manual</span>
            </button>
            <button
              type='button'
              className={`rail-item${rightPanelMode === 'nodes' ? ' active' : ''}`}
              onClick={openNodesCatalog}
              aria-pressed={rightPanelMode === 'nodes'}
            >
              <span className='rail-icon-box'>
                <RailFace>◍</RailFace>
              </span>
              <span className='rail-label'>Nodes</span>
            </button>
            <button
              type='button'
              className={`rail-item${rightPanelMode === 'sources' ? ' active' : ''}`}
              aria-pressed={rightPanelMode === 'sources'}
              onClick={() => setRightPanelMode((m) => (m === 'sources' ? 'none' : 'sources'))}
            >
              <span className='rail-icon-box'>
                <RailFace>▤</RailFace>
              </span>
              <span className='rail-label'>Sources</span>
            </button>
            <button
              type='button'
              className={`rail-item${rightPanelMode === 'ai' ? ' active' : ''}`}
              onClick={() => {
                setRightPanelMode((mode) => (mode === 'ai' ? 'none' : 'ai'))
              }}
              aria-pressed={rightPanelMode === 'ai'}
            >
              <span className='rail-icon-box'>
                <span className='rail-icon' aria-hidden>
                  ✧
                </span>
              </span>
              <span className='rail-label'>AI</span>
            </button>
            <div className='rail-split'>
              <button
                type='button'
                className={`rail-item rail-item--split${canUndo ? ' active' : ''}`}
                onClick={undoAction}
                disabled={!canUndo}
                title={canUndo ? 'Undo (Ctrl+Z)' : 'Nothing to undo'}
              >
                <span className='rail-icon-box'>
                  <RailFace>↺</RailFace>
                </span>
                <span className='rail-label'>Undo</span>
              </button>
              <button
                type='button'
                className={`rail-item rail-item--split${canRedo ? ' active' : ''}`}
                onClick={redoAction}
                disabled={!canRedo}
                title={canRedo ? 'Redo (Ctrl+Y)' : 'Nothing to redo'}
              >
                <span className='rail-icon-box'>
                  <RailFace>↻</RailFace>
                </span>
                <span className='rail-label'>Redo</span>
              </button>
            </div>
          </aside>
        </div>

        <section ref={canvasRef} className='mf-canvas mf-canvas--live'>
          {loading ? (
            <p className='mf-canvas-hint'>Loading project…</p>
          ) : !session ? (
            <p className='mf-canvas-hint'>Session not found.</p>
          ) : (
            <>
              {session.nodes.length === 0 ? (
                <p className='mf-canvas-hint'>
                  Empty map. Open Manual → Add node, then press and drag on the canvas to draw the circle size you want.
                </p>
              ) : null}
              <MindMapCanvas
                nodes={session.nodes}
                links={session.links}
                selectedId={selectedId}
                selectedLinkId={selectedLinkId}
                connectMode={connectMode}
                placeNodeMode={placeNodeMode}
                onSelect={onSelect}
                onSelectLink={onSelectLink}
                onHoverNode={setHoveredId}
                onDragEnd={onDragEnd}
                onConnectWire={onConnectWire}
                onPlaceNodeComplete={onPlaceNodeComplete}
                pendingPosition={pendingPos}
              />
              {focusedNode ? (
                <div
                  ref={stylePopRef}
                  className={`mf-node-style-pop mf-node-style-pop--${stylePopPlacement}`}
                  style={focusedStyle}
                >
                  <div className='mf-node-style-pop__row'>
                    <span>Style</span>
                    <div className='mf-node-style-pop__actions'>
                      <span className='mf-node-style-pop__name'>{focusedNode.topic || 'Untitled'}</span>
                      <button
                        type='button'
                        className='mf-node-style-pop__rename'
                        title='Rename node title'
                        onClick={openRenameModal}
                      >
                        <svg width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2'>
                          <path d='M4 7h16M12 7v12M8 19h8' strokeLinecap='round' strokeLinejoin='round' />
                        </svg>
                      </button>
                    </div>
                  </div>
                  <NodeColorField
                    nodeId={focusedNode.id}
                    value={focusedNode.color ?? null}
                    onChange={(hex) => applyTrackedNodePatch(focusedNode.id, buildNodeStylePatch({ color: hex }))}
                  />
                  <label className='mf-node-style-pop__size'>
                    <span>Size</span>
                    <input
                      type='range'
                      min={28}
                      max={100}
                      step={1}
                      value={readNodeRadiusPx(focusedNode)}
                      onChange={(e) => applyTrackedNodePatch(focusedNode.id, buildNodeStylePatch({ radiusPx: Number(e.target.value) }))}
                    />
                  </label>
                </div>
              ) : null}
              {selectedLink ? (
                <div
                  ref={linkPopWrapRef}
                  className='mf-link-pop-wrap'
                  style={{ left: `${linkPopPos.left}px`, top: `${linkPopPos.top}px` }}
                  onPointerDown={(e) => e.stopPropagation()}
                  role='presentation'
                >
                  <div className='mf-link-toolbar' role='toolbar' aria-label='Connection'>
                    <button
                      type='button'
                      className={`mf-link-toolbar-btn${linkPopSubmenu === 'color' ? ' active' : ''}`}
                      title='Line color'
                      aria-pressed={linkPopSubmenu === 'color'}
                      onClick={() => setLinkPopSubmenu((s) => (s === 'color' ? null : 'color'))}
                    >
                      <svg width='20' height='20' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2' aria-hidden>
                        <path
                          d='M12 3c-4 4-8 7.5-8 11a8 8 0 0 0 16 0c0-3.5-4-7-8-11z'
                          strokeLinejoin='round'
                        />
                        <circle cx='12' cy='14' r='2.5' fill='currentColor' stroke='none' opacity='0.35' />
                      </svg>
                    </button>
                    <button
                      type='button'
                      className={`mf-link-toolbar-btn${linkPopSubmenu === 'style' ? ' active' : ''}`}
                      title='Line style'
                      aria-pressed={linkPopSubmenu === 'style'}
                      onClick={() => setLinkPopSubmenu((s) => (s === 'style' ? null : 'style'))}
                    >
                      <svg width='20' height='20' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2' aria-hidden>
                        <path d='M5 19L19 5' strokeLinecap='round' />
                        <circle cx='6' cy='18' r='2.5' fill='currentColor' />
                        <circle cx='18' cy='6' r='2.5' fill='currentColor' />
                      </svg>
                    </button>
                    <button
                      type='button'
                      className='mf-link-toolbar-btn mf-link-toolbar-btn--danger'
                      title='Delete connection'
                      onClick={requestDeleteSelectedLink}
                    >
                      <svg width='20' height='20' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2' aria-hidden>
                        <path d='M3 6h18M8 6V4h8v2M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M10 11v6M14 11v6' strokeLinecap='round' strokeLinejoin='round' />
                      </svg>
                    </button>
                  </div>
                  {linkPopSubmenu === 'color' ? (
                    <div className='mf-link-submenu mf-link-submenu--color' onPointerDown={(e) => e.stopPropagation()}>
                      <p className='mf-link-submenu__title'>
                        <svg width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2' aria-hidden>
                          <path d='M12 3c-4 4-8 7.5-8 11a8 8 0 0 0 16 0c0-3.5-4-7-8-11z' strokeLinejoin='round' />
                        </svg>
                        Line color
                      </p>
                      <NodeColorField
                        nodeId={selectedLink.id}
                        value={selectedLink.color ?? null}
                        onChange={(hex) => applyTrackedLinkPatch(selectedLink.id, { color: hex })}
                      />
                    </div>
                  ) : null}
                  {linkPopSubmenu === 'style' ? (
                    <div className='mf-link-submenu mf-link-submenu--style' onPointerDown={(e) => e.stopPropagation()}>
                      <p className='mf-link-submenu__title'>
                        <svg width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2' aria-hidden>
                          <path d='M5 19L19 5' strokeLinecap='round' />
                          <circle cx='6' cy='18' r='2' fill='currentColor' />
                          <circle cx='18' cy='6' r='2' fill='currentColor' />
                        </svg>
                        Line style
                      </p>
                      <div className='mf-link-style-grid' role='group' aria-label='Line style'>
                        {(['solid', 'dashed', 'dotted', 'bold'] as LinkLineStyle[]).map((style) => (
                          <button
                            key={style}
                            type='button'
                            className={`mf-link-style-tile${selectedLinkStyle === style ? ' active' : ''}`}
                            title={style}
                            aria-pressed={selectedLinkStyle === style}
                            onClick={() => applyTrackedLinkPatch(selectedLink.id, { line_style: style })}
                          >
                            <svg width='32' height='22' viewBox='0 0 24 24' className='mf-link-style-tile__glyph'>
                              <LinkStyleGlyph kind={style} />
                            </svg>
                            <span className='mf-link-style-tile__label'>{style}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </>
          )}
        </section>

        {showRightPanel ? (
        <aside className='mf-chat' aria-label='Inspector'>
          {rightPanelMode === 'ai' ? (
            <div className='mf-right-stack'>
              <div className='mf-chat-header'>
                <h2>Assistant</h2>
                <span>{streaming ? 'Thinking…' : 'Gemini'} · {session?.mode === 'plan' ? 'Plan' : 'Research'}</span>
              </div>
              <div className='mf-chat-stream'>
                {chatMessages.map((message) => (
                  <article key={message.id} className={`mf-chat-bubble ${message.role}`}>
                    <p>{message.content}</p>
                    <span>{message.timestamp}</span>
                  </article>
                ))}
              </div>
              <div className='mf-chat-input'>
                <textarea
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  placeholder={selectedId ? 'Ask AI to expand the selected node…' : 'Ask AI to build or expand the map…'}
                  rows={2}
                  disabled={streaming}
                />
                <button type='button' onClick={sendChat} disabled={streaming || !chatInput.trim()}>
                  {streaming ? 'Sending…' : 'Send'}
                </button>
              </div>
            </div>
          ) : null}
          {rightPanelMode === 'nodes' ? (
            <div className='mf-right-stack'>
              {nodesPanelView === 'catalog' ? (
                <>
                  <div className='mf-chat-header mf-node-panel-header'>
                    <p className='mf-detail-kicker'>{session?.mode === 'plan' ? 'Planning' : 'Research'}</p>
                    <h2>{copy.catalogTitle}</h2>
                    <span>{copy.catalogSubtitle}</span>
                  </div>
                  <div className='mf-node-catalog'>
                    {catalogNodes.length === 0 ? (
                      <div className='mf-right-empty'>
                        <p className='mf-right-empty__title'>No nodes yet</p>
                        <h2>Start with AI or Manual</h2>
                        <p className='mf-right-empty__copy'>Your nodes will appear here as a readable map outline.</p>
                      </div>
                    ) : (
                      catalogNodes.map((node) => {
                        const orb = nodeOrbStyle(node.color)
                        return (
                          <button
                            key={node.id}
                            type='button'
                            className={`mf-node-list-card${selectedId === node.id ? ' active' : ''}`}
                            onClick={() => openNodeDetail(node.id)}
                          >
                            <span className='mf-node-list-swatch' style={{ background: orb.background, color: orb.color }}>
                              {node.depth}
                            </span>
                            <span className='mf-node-list-copy'>
                              <strong>{node.topic || 'Untitled node'}</strong>
                              <span>{node.summary || (session?.mode === 'plan' ? 'Plan item' : 'Research note')}</span>
                            </span>
                          </button>
                        )
                      })
                    )}
                  </div>
                </>
              ) : (
                <div className='mf-detail-body'>
                  <div className='mf-detail-sticky-header'>
                    <button type='button' className='mf-detail-back' onClick={() => setNodesPanelView('catalog')}>
                      ← Back to nodes
                    </button>
                    <p className='mf-detail-kicker'>{copy.detailKicker}</p>
                    <h2 className='mf-detail-title'>{panelNode?.topic || 'Select a node'}</h2>
                    {panelNode ? <span className='mf-node-depth-pill'>Depth {panelNode.depth}</span> : null}
                  </div>
                  <div className='mf-detail-scroll'>
                    {panelNode ? (
                      <>
                        <section className='mf-detail-block'>
                          <h3>{copy.summaryLabel}</h3>
                          <p className='mf-detail-text'>{panelNode.summary || 'No summary saved yet.'}</p>
                        </section>
                        <section className='mf-detail-block'>
                          <h3>{copy.detailsLabel}</h3>
                          <p className='mf-detail-text'>{panelNode.details || copy.emptyDetails}</p>
                        </section>
                        <section className='mf-detail-block'>
                          <h3>{copy.subtopicsLabel}</h3>
                          {panelSubtopics.length ? (
                            <ul className='mf-node-notes'>
                              {panelSubtopics.map((item, index) => (
                                <li key={`${item}-${index}`}>{item}</li>
                              ))}
                            </ul>
                          ) : (
                            <p className='mf-muted'>No structured notes yet.</p>
                          )}
                        </section>
                        <section className='mf-detail-block'>
                          <h3>Map context</h3>
                          {contextLinks.length ? (
                            <ul className='mf-linklist'>
                              {contextLinks.map(({ link, other, direction }) => (
                                <li key={link.id}>
                                  <button type='button' className='mf-linkrow' onClick={() => openNodeDetail(other.id)}>
                                    {direction}: {other.topic}
                                  </button>
                                </li>
                              ))}
                            </ul>
                          ) : (
                            <p className='mf-muted'>No connected nodes yet.</p>
                          )}
                        </section>
                      </>
                    ) : (
                      <div className='mf-right-empty'>
                        <p className='mf-right-empty__title'>Nothing selected</p>
                        <h2>Pick a node</h2>
                        <p className='mf-right-empty__copy'>Click any node on the canvas or choose one from the node list.</p>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          ) : null}
          {rightPanelMode === 'sources' ? (
            <div className='mf-right-stack'>
              <div className='mf-chat-header mf-node-panel-header'>
                <p className='mf-detail-kicker'>{session?.mode === 'plan' ? 'Planning' : 'Research'}</p>
                <h2>Sources</h2>
                <span>References the assistant used to structure this map.</span>
              </div>
              <div className='mf-sources-scroll'>
                {sourcesList.length === 0 ? (
                  <div className='mf-right-empty'>
                    <p className='mf-right-empty__title'>No sources yet</p>
                    <h2>Run the AI on a research prompt</h2>
                    <p className='mf-right-empty__copy'>
                      After you send a prompt, detailed citations with summaries, excerpts, and relevance notes appear
                      here.
                    </p>
                  </div>
                ) : (
                  sourcesList.map((src, idx) => (
                    <article key={`${src.title}-${idx}`} className='mf-source-card'>
                      <h3>{src.title}</h3>
                      <p className='mf-source-meta'>
                        {[src.publisher, src.year].filter(Boolean).join(' · ')}
                        {src.url ? (
                          <>
                            <br />
                            <a href={src.url} target='_blank' rel='noreferrer noopener'>
                              {src.url}
                            </a>
                          </>
                        ) : null}
                      </p>
                      {src.summary ? <p className='mf-source-body'>{src.summary}</p> : null}
                      {src.excerpt ? <p className='mf-source-excerpt'>{src.excerpt}</p> : null}
                      {src.relevance ? (
                        <p className='mf-detail-hint'>
                          <strong>Relevance:</strong> {src.relevance}
                        </p>
                      ) : null}
                    </article>
                  ))
                )}
              </div>
            </div>
          ) : null}
        </aside>
        ) : null}
      </main>
      {deleteConfirm ? (
        <div className='ws-delete-modal-overlay' role='dialog' aria-modal='true' aria-labelledby='ws-delete-title'>
          <div className='ws-delete-modal-card'>
            <h4 id='ws-delete-title'>Delete this node?</h4>
            <p>
              <strong>{deleteConfirm.node.topic || 'Untitled node'}</strong> will be removed from the graph with{' '}
              {deleteConfirm.links.length} connection{deleteConfirm.links.length === 1 ? '' : 's'}.
            </p>
            <p className='ws-delete-modal-sub'>
              You can instantly undo/redo with Ctrl+Z / Ctrl+Y or the split Undo/Redo control in the rail.
            </p>
            <div className='ws-delete-modal-actions'>
              <button type='button' className='secondary' onClick={() => setDeleteConfirm(null)}>
                Cancel
              </button>
              <button type='button' className='danger' onClick={confirmDelete} disabled={mutDeleteNode.isPending}>
                {mutDeleteNode.isPending ? 'Deleting…' : 'Delete node'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {linkDeleteConfirm ? (
        <div className='ws-delete-modal-overlay' role='dialog' aria-modal='true' aria-labelledby='ws-delete-link-title'>
          <div className='ws-delete-modal-card'>
            <h4 id='ws-delete-link-title'>Delete this connection?</h4>
            <p>
              This removes the link between{' '}
              <strong>
                {session?.nodes.find((n) => n.id === linkDeleteConfirm.parent_id)?.topic || 'Untitled node'}
              </strong>{' '}
              and{' '}
              <strong>
                {session?.nodes.find((n) => n.id === linkDeleteConfirm.child_id)?.topic || 'Untitled node'}
              </strong>
              .
            </p>
            <p className='ws-delete-modal-sub'>
              You can instantly undo/redo with Ctrl+Z / Ctrl+Y or the split Undo/Redo control in the rail.
            </p>
            <div className='ws-delete-modal-actions'>
              <button type='button' className='secondary' onClick={() => setLinkDeleteConfirm(null)}>
                Cancel
              </button>
              <button type='button' className='danger' onClick={confirmDeleteLink}>
                Delete connection
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {renamingNode ? (
        <div className='ws-delete-modal-overlay' role='dialog' aria-modal='true' aria-labelledby='ws-rename-title'>
          <div className='ws-delete-modal-card'>
            <h4 id='ws-rename-title'>Rename node title</h4>
            <p>Update how this node appears on the canvas.</p>
            <input
              value={renameDraft}
              maxLength={renameLimit}
              autoFocus
              onChange={(e) => setRenameDraft(e.target.value.slice(0, renameLimit))}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  submitRename()
                }
              }}
              placeholder='Enter title'
            />
            <p className='ws-delete-modal-sub'>
              {renameDraft.length}/{renameLimit} characters based on current node size.
            </p>
            <div className='ws-delete-modal-actions'>
              <button type='button' className='secondary' onClick={() => setRenamingNodeId(null)}>
                Cancel
              </button>
              <button type='button' onClick={submitRename} disabled={mutUpdateNode.isPending || !renameDraft.trim()}>
                {mutUpdateNode.isPending ? 'Saving…' : 'Save title'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
