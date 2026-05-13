import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import { AppTopBar } from '../components/AppTopBar'
import { CurioGenerationOverlay, type GenerationOverlayStep } from '../components/CurioGenerationOverlay'
import { NodeColorField } from '../components/workspace/NodeColorField'
import { MindMapCanvas, type MindMapCanvasHandle, type ViewportSnapshot } from '../components/workspace/MindMapCanvas'
import { LayoutModePanel } from '../components/workspace/LayoutModePanel'
import { CANVAS_H, CANVAS_W } from '../lib/canvasConstants'
import {
  bulkUpdateNodes,
  createLink,
  createNode,
  deleteNode,
  deleteLink,
  getSession,
  postSessionPromptStream,
  relayoutSession,
  restoreLink,
  restoreNode,
  updateLink,
  updateNode,
  type LayoutMode,
  type LinkLineStyle,
  type LinkOut,
  type LinkUpdatePayload,
  type NodeOut,
  type SessionDetail,
  type MessageOut,
  type ResearchSource,
  type SessionPromptEvent,
} from '../lib/api'

import { humanizeAgentToolName, isAbortError } from '../lib/generationUi'
import { buildManualLinkPayload, buildManualNodePayload, buildNodeUpdateFromStyleDelta } from '../lib/manualGraph'
import { readNodeRadiusPx } from '../lib/nodeDisplay'
import { nodeOrbStyle } from '../lib/nodeOrbStyle'
import { recordSessionOpened } from '../lib/sessionRecent'

interface ChatMessage {
  id: string
  role: 'user' | 'system'
  content: string
  timestamp: string
}

function formatChatTimestamp(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) {
    return new Date().toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' })
  }
  return d.toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' })
}

/** Two-stroke close icon (avoids Unicode × for consistent shape at any size). */
function UiDismissX({ size = 16 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox='0 0 24 24'
      fill='none'
      stroke='currentColor'
      strokeWidth='2.25'
      strokeLinecap='round'
      aria-hidden
      style={{ display: 'block' }}
    >
      <path d='M6 6l12 12M18 6L6 18' />
    </svg>
  )
}

function chatRowsFromSessionMessages(messages: MessageOut[] | undefined): ChatMessage[] {
  const list = messages ?? []
  const sorted = [...list].sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime() || a.id - b.id,
  )
  return sorted
    .filter((m) => m.role === 'user' || m.role === 'system')
    .map((m) => ({
      id: `m-${m.id}`,
      role: m.role === 'user' ? ('user' as const) : ('system' as const),
      content: m.content,
      timestamp: formatChatTimestamp(m.created_at),
    }))
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

interface GenerationBaseline {
  session: SessionDetail
  chatMessages: ChatMessage[]
  sourcesList: ResearchSource[]
}

type RightPanelMode = 'none' | 'ai' | 'nodes' | 'sources'
type NodesPanelView = 'catalog' | 'detail'
type DockPopover = null | 'manual' | 'layout' | 'position'
type DockPosition = 'top' | 'bottom' | 'left' | 'right'
const VALID_DOCK_POSITIONS: DockPosition[] = ['top', 'bottom', 'left', 'right']
const DOCK_POSITION_STORAGE_KEY = 'curio:dockPosition'

function loadDockPosition(): DockPosition {
  if (typeof window === 'undefined') return 'bottom'
  const saved = window.localStorage.getItem(DOCK_POSITION_STORAGE_KEY)
  return (VALID_DOCK_POSITIONS as string[]).includes(saved ?? '') ? (saved as DockPosition) : 'bottom'
}

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

function updateNodePosition(session: SessionDetail, nodeId: number, x: number, y: number): SessionDetail {
  return {
    ...session,
    nodes: session.nodes.map((n) =>
      n.id === nodeId
        ? { ...n, position_x: x, position_y: y, original_position_x: x, original_position_y: y }
        : n,
    ),
  }
}

/** One home-screen auto prompt per session (Strict Mode double-mount; never cleared on React Query cache updates). */
const workspaceHomeAutoPromptOnce = new Set<string>()

type WorkspaceNavigateState = {
  initialPrompt?: string
  centerNodeId?: number
  mode?: string
  title?: string
}

function resolveHomeSeedAnchorId(
  nodes: NodeOut[],
  seed: string,
  explicitId: number | undefined,
): number | null {
  if (explicitId != null && nodes.some((n) => n.id === explicitId)) {
    return explicitId
  }
  const t = seed.trim()
  if (nodes.length === 1) return nodes[0].id
  const match = nodes.find((n) => n.topic.trim() === t)
  return match?.id ?? null
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

function sourcesLinkedToNode(nodeId: number, sources: ResearchSource[]): ResearchSource[] {
  return sources.filter((s) => (s.node_ids ?? []).includes(nodeId))
}

function sourceNodeLabel(
  nodeId: number,
  topicSnapshot: string | undefined,
  session: SessionDetail | undefined,
): string {
  const live = session?.nodes.find((n) => n.id === nodeId)?.topic?.trim()
  if (live) return live
  const snap = topicSnapshot?.trim()
  if (snap) return snap
  return `Node #${nodeId}`
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
  const { workspaceSlug = '' } = useParams()
  const location = useLocation()
  const navigate = useNavigate()
  const navigateState = (location.state as WorkspaceNavigateState | null) ?? null
  const initialPrompt = navigateState?.initialPrompt ?? ''
  const centerNodeIdFromNav = navigateState?.centerNodeId
  const queryClient = useQueryClient()
  const [chatInput, setChatInput] = useState('')
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([])
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [hoveredId, setHoveredId] = useState<number | null>(null)
  const [selectedLinkId, setSelectedLinkId] = useState<number | null>(null)
  const [selectedLinkPos, setSelectedLinkPos] = useState<{ left: number; top: number }>({ left: 0, top: 0 })
  const [dockPopover, setDockPopover] = useState<DockPopover>(null)
  const [dockOpen, setDockOpen] = useState(true)
  const [dockPosition, setDockPosition] = useState<DockPosition>(loadDockPosition)
  const [viewportInfo, setViewportInfo] = useState<ViewportSnapshot>({ scale: 1, handToolActive: false })
  const mindMapRef = useRef<MindMapCanvasHandle | null>(null)
  const onViewportChange = useCallback((snap: ViewportSnapshot) => {
    setViewportInfo((prev) =>
      prev.scale === snap.scale && prev.handToolActive === snap.handToolActive ? prev : snap,
    )
  }, [])

  useEffect(() => {
    try {
      window.localStorage.setItem(DOCK_POSITION_STORAGE_KEY, dockPosition)
    } catch {
      /* localStorage may be unavailable; ignore */
    }
  }, [dockPosition])

  const dockIsVertical = dockPosition === 'left' || dockPosition === 'right'
  // Reserve extra room on whichever side the dock occupies so Fit doesn't drop
  // nodes behind the floating bar. ~108px is enough for the bar + its 18px gap.
  const fitInset = useMemo(() => {
    const base = 56
    const reserved = dockIsVertical ? 132 : 108
    return {
      top: dockPosition === 'top' ? reserved : base,
      bottom: dockPosition === 'bottom' ? reserved : base,
      left: dockPosition === 'left' ? reserved : base,
      right: dockPosition === 'right' ? reserved : base,
    }
  }, [dockIsVertical, dockPosition])

  const setDockPositionAndClose = useCallback((next: DockPosition) => {
    setDockPosition(next)
    setDockPopover(null)
    // Re-fit on the next tick once the layout has updated so the new inset is honored.
    setTimeout(() => setFitContentNonce((x) => x + 1), 0)
  }, [])
  const [rightPanelMode, setRightPanelMode] = useState<RightPanelMode>('none')
  const [sourcesList, setSourcesList] = useState<ResearchSource[]>([])
  const [nodesPanelView, setNodesPanelView] = useState<NodesPanelView>('catalog')
  const [panelNodeId, setPanelNodeId] = useState<number | null>(null)
  const [streaming, setStreaming] = useState(false)
  const [generationSteps, setGenerationSteps] = useState<GenerationOverlayStep[]>([])
  const [generationKind, setGenerationKind] = useState<'context' | 'expand'>('context')
  const [placeNodeMode, setPlaceNodeMode] = useState(false)
  const [connectMode, setConnectMode] = useState(false)
  const [layoutSwitching, setLayoutSwitching] = useState(false)
  const [errorBanner, setErrorBanner] = useState<string | null>(null)
  const [pendingPos] = useState<Map<number, { x: number; y: number }>>(() => new Map())
  const [fitContentNonce, setFitContentNonce] = useState(0)
  const [history, setHistory] = useState<HistoryEntry[]>([])
  const [historyIndex, setHistoryIndex] = useState(-1)
  const [deleteConfirm, setDeleteConfirm] = useState<DeleteUndoEntry | null>(null)
  const [linkDeleteConfirm, setLinkDeleteConfirm] = useState<LinkOut | null>(null)
  const [renamingNodeId, setRenamingNodeId] = useState<number | null>(null)
  const [renameDraft, setRenameDraft] = useState('')
  const syncChainRef = useRef<Promise<void>>(Promise.resolve())
  const historyRef = useRef<HistoryEntry[]>([])
  const historyIndexRef = useRef(-1)
  const canvasRef = useRef<HTMLElement | null>(null)
  const linkPopWrapRef = useRef<HTMLDivElement | null>(null)
  const linkLocalStyleMigratedRef = useRef(false)
  const [linkPopSubmenu, setLinkPopSubmenu] = useState<'color' | 'style' | null>(null)
  const [linkPopPos, setLinkPopPos] = useState<{ left: number; top: number }>({ left: 0, top: 0 })
  const promptAbortRef = useRef<AbortController | null>(null)
  const generationBaselineRef = useRef<GenerationBaseline | null>(null)
  const generationStartedSlugRef = useRef('')
  const genStepSeqRef = useRef(0)
  const chatMessagesRef = useRef<ChatMessage[]>([])
  const sourcesListRef = useRef<ResearchSource[]>([])
  const workspacePageMountedRef = useRef(true)
  const dirtyPositionsRef = useRef<Map<number, { x: number; y: number }>>(new Map())
  const dirtyFlushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // --- Node detail editing ---
  const [editingField, setEditingField] = useState<'summary' | 'details' | 'subtopics' | null>(null)
  const [editingValue, setEditingValue] = useState('')

  // --- Streaming animation ---
  const streamingNodeIdsRef = useRef<Set<number>>(new Set())
  const streamingLinkIdsRef = useRef<Set<number>>(new Set())

  const [animatePositions, setAnimatePositions] = useState(false)

  useEffect(() => {
    chatMessagesRef.current = chatMessages
  }, [chatMessages])

  useEffect(() => {
    sourcesListRef.current = sourcesList
  }, [sourcesList])

  useEffect(() => {
    workspacePageMountedRef.current = true
    return () => {
      workspacePageMountedRef.current = false
      // Flush any pending dirty positions on unmount
      if (dirtyFlushTimerRef.current) clearTimeout(dirtyFlushTimerRef.current)
      const dirty = dirtyPositionsRef.current
      if (dirty.size > 0) {
        const items = Array.from(dirty.entries()).map(([id, pos]) => ({
          id, position_x: pos.x, position_y: pos.y,
          original_position_x: pos.x, original_position_y: pos.y,
        }))
        dirtyPositionsRef.current = new Map()
        const sid = sessionQuery.data?.id
        if (sid) void bulkUpdateNodes(sid, { nodes: items }).catch(() => {})
      }
    }
  }, [])

  useEffect(() => {
    return () => {
      promptAbortRef.current?.abort()
      promptAbortRef.current = null
    }
  }, [])

  // Reset editing state when the inspected node changes
  useEffect(() => { setEditingField(null) }, [panelNodeId, selectedId])

  useEffect(() => {
    promptAbortRef.current?.abort()
    promptAbortRef.current = null
  }, [workspaceSlug])

  const autoFitDoneRef = useRef<string | null>(null)

  useEffect(() => {
    setFitContentNonce(0)
    autoFitDoneRef.current = null
  }, [workspaceSlug])

  const sessionQuery = useQuery<SessionDetail>({
    queryKey: ['session', workspaceSlug],
    queryFn: () => getSession(workspaceSlug),
    enabled: workspaceSlug.length > 0,
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

  useEffect(() => {
    if (!session?.slug) return
    if (workspaceSlug === session.slug) return
    if (workspaceSlug === String(session.id)) {
      navigate(`/workspace/${session.slug}`, { replace: true, state: location.state })
    }
  }, [session, workspaceSlug, navigate, location.state])

  const sessionMessagesLen = sessionQuery.data?.messages?.length ?? 0
  const sessionLastMsgId = sessionQuery.data?.messages?.[sessionMessagesLen - 1]?.id ?? 0
  const chatHydrationDep = `${sessionQuery.data?.id ?? workspaceSlug}:${sessionMessagesLen}:${sessionLastMsgId}:${sessionQuery.data ? 'loaded' : 'pending'}`
  const loading = sessionQuery.isPending && !session
  const invalidateSession = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ['session', workspaceSlug] })
  }, [queryClient, workspaceSlug])

  useEffect(() => {
    if (!workspaceSlug || !session || linkLocalStyleMigratedRef.current) return
    const key = `curio:linkStyles:${workspaceSlug}`
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
  }, [session, workspaceSlug, invalidateSession])

  // Hydrate sources from session messages — only recompute when messages actually change
  const prevSourcesDepRef = useRef('')
  useEffect(() => {
    const dep = `${session?.id}:${session?.messages?.length ?? 0}`
    if (dep === prevSourcesDepRef.current) return
    prevSourcesDepRef.current = dep
    setSourcesList(parseSourcesFromSession(session ?? undefined))
  }, [session])

  // Hydrate chat messages from DB — only recompute when message count/IDs change
  const prevChatDepRef = useRef('')
  useEffect(() => {
    if (!sessionQuery.data || !workspaceSlug) return
    if (chatHydrationDep === prevChatDepRef.current) return
    prevChatDepRef.current = chatHydrationDep
    const fromDb = chatRowsFromSessionMessages(sessionQuery.data.messages)
    const trimmedSeed = initialPrompt.trim()
    if (fromDb.length === 0 && trimmedSeed) {
      const now = formatChatTimestamp(new Date().toISOString())
      setChatMessages([{ id: 'seed', role: 'user', content: trimmedSeed, timestamp: now }])
      return
    }
    setChatMessages(fromDb)
  }, [workspaceSlug, initialPrompt, chatHydrationDep, sessionQuery.data])

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
    if (sessionQuery.error) {
      const message =
        sessionQuery.error instanceof Error
          ? sessionQuery.error.message
          : 'Failed to load session.'
      setErrorBanner(message)
      return
    }
    if (!session) return
    localStorage.setItem('curio:lastSessionId', session.slug)
    recordSessionOpened(session.slug)
  }, [session, sessionQuery.error])

  // Auto-fit the canvas the first time a session loads with nodes so the user
  // always sees the whole graph on open, the same as clicking the Fit button.
  // Without this, the viewport sits at (0, 0) while nodes live near the center
  // of the 12000x7200 logical canvas, making the map appear empty.
  const sessionLoadedNodeCount = sessionQuery.data?.nodes?.length ?? 0
  useEffect(() => {
    if (!workspaceSlug) return
    if (autoFitDoneRef.current === workspaceSlug) return
    if (sessionLoadedNodeCount === 0) return
    autoFitDoneRef.current = workspaceSlug
    setFitContentNonce((x) => x + 1)
  }, [workspaceSlug, sessionLoadedNodeCount])

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
        queryClient.setQueryData<SessionDetail>(['session', workspaceSlug], cloneSession(entry.before))
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
        queryClient.setQueryData<SessionDetail>(['session', workspaceSlug], cloneSession(entry.after))
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
  }, [enqueueHistorySync, queryClient, session, workspaceSlug])

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
      if (connectMode) {
        e.preventDefault()
        setConnectMode(false)
        return
      }
      if (placeNodeMode) {
        e.preventDefault()
        setPlaceNodeMode(false)
        return
      }
      if (linkPopSubmenu != null) {
        e.preventDefault()
        setLinkPopSubmenu(null)
        return
      }
      if (selectedLinkId != null) {
        e.preventDefault()
        setSelectedLinkId(null)
        return
      }
      if (dockPopover != null) {
        e.preventDefault()
        setDockPopover(null)
        setPlaceNodeMode(false)
        setConnectMode(false)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [
    connectMode,
    deleteConfirm,
    dockPopover,
    linkPopSubmenu,
    linkDeleteConfirm,
    placeNodeMode,
    renamingNodeId,
    selectedLinkId,
  ])

  const onSelect = useCallback((id: number | null) => {
    setDockPopover(null)
    setSelectedId(id)
    setSelectedLinkId(null)
    if (id != null) {
      setPanelNodeId(id)
      setNodesPanelView('detail')
      setRightPanelMode('nodes')
    }
  }, [])

  const onSelectLink = useCallback((id: number | null, pos?: { x: number; y: number }) => {
    setDockPopover(null)
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
      const current = queryClient.getQueryData<SessionDetail>(['session', workspaceSlug])
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
      queryClient.setQueryData<SessionDetail>(['session', workspaceSlug], after)
      const sid = Number(session.id)
      const entry: HistoryEntry = {
        before,
        after,
        syncForward: () => mutUpdateNode.mutateAsync({ sid, id: nodeId, patch }),
        syncBackward: () => mutUpdateNode.mutateAsync({ sid, id: nodeId, patch: beforePatch }),
      }
      commitHistoryEntry(entry)
    },
    [commitHistoryEntry, mutUpdateNode, queryClient, session, workspaceSlug],
  )

  const handleNodeStyleDelta = useCallback(
    (
      nodeId: number,
      delta: Parameters<typeof buildNodeUpdateFromStyleDelta>[1] & { clearManualRadius?: boolean },
    ) => {
      const current = queryClient.getQueryData<SessionDetail>(['session', workspaceSlug])
      const node = current?.nodes.find((item) => item.id === nodeId)
      if (!node) return
      const patch = buildNodeUpdateFromStyleDelta(node, delta)
      if (Object.keys(patch).length === 0) return
      applyTrackedNodePatch(nodeId, patch)
    },
    [applyTrackedNodePatch, queryClient, workspaceSlug],
  )

  const applyTrackedLinkPatch = useCallback(
    (linkId: number, patch: LinkUpdatePayload) => {
      if (!session) return
      const current = queryClient.getQueryData<SessionDetail>(['session', workspaceSlug])
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
      queryClient.setQueryData<SessionDetail>(['session', workspaceSlug], after)
      const sid = Number(session.id)
      commitHistoryEntry({
        before,
        after,
        syncForward: () => mutUpdateLink.mutateAsync({ sid, id: linkId, patch }),
        syncBackward: () => mutUpdateLink.mutateAsync({ sid, id: linkId, patch: beforePatch }),
      })
    },
    [commitHistoryEntry, mutUpdateLink, queryClient, session, workspaceSlug],
  )

  const flushDirtyPositions = useCallback(async () => {
    if (!session) return
    const dirty = dirtyPositionsRef.current
    if (dirty.size === 0) return
    const items = Array.from(dirty.entries()).map(([id, pos]) => ({
      id,
      position_x: pos.x,
      position_y: pos.y,
      original_position_x: pos.x,
      original_position_y: pos.y,
    }))
    dirtyPositionsRef.current = new Map()
    await bulkUpdateNodes(session.id, { nodes: items }).catch((e: Error) => {
      setErrorBanner(e.message)
    })
  }, [session])

  const onDragEnd = useCallback(
    (id: number, x: number, y: number) => {
      if (id < 0) return
      const n = session?.nodes.find((o) => o.id === id)
      if (!n) return
      if (Math.abs(n.position_x - x) < 0.01 && Math.abs(n.position_y - y) < 0.01) return
      // Optimistic local update (no history entry)
      queryClient.setQueryData<SessionDetail>(['session', workspaceSlug], (cur) =>
        cur ? applyNodePatchDeterministic(cur, id, { position_x: x, position_y: y }) : cur,
      )
      dirtyPositionsRef.current.set(id, { x, y })
      if (dirtyFlushTimerRef.current) clearTimeout(dirtyFlushTimerRef.current)
      dirtyFlushTimerRef.current = setTimeout(flushDirtyPositions, 500)
    },
    [flushDirtyPositions, queryClient, session?.nodes, workspaceSlug],
  )

  const handleFitView = useCallback(() => {
    // Just zoom-to-fit the canvas without resetting node positions
    setFitContentNonce((x) => x + 1)
  }, [])

  useEffect(() => {
    const isTypingTarget = (target: EventTarget | null) => {
      const el = target as HTMLElement | null
      const tag = el?.tagName?.toLowerCase()
      return tag === 'input' || tag === 'textarea' || tag === 'select' || Boolean(el?.isContentEditable)
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.repeat) return
      if (e.ctrlKey || e.metaKey || e.altKey) return
      if (isTypingTarget(e.target)) return
      const key = e.key.length === 1 ? e.key.toLowerCase() : e.key
      if (key === 'm') {
        if (!session) return
        e.preventDefault()
        if (!viewportInfo.handToolActive) {
          setConnectMode(false)
          setPlaceNodeMode(false)
        }
        mindMapRef.current?.setHandTool(!viewportInfo.handToolActive)
        return
      }
      if (key === 'f') {
        if (!session) return
        e.preventDefault()
        mindMapRef.current?.resetView()
        mindMapRef.current?.fit()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [session, viewportInfo.handToolActive])

  const handleLayoutModeChange = useCallback(
    async (mode: LayoutMode) => {
      if (!session || layoutSwitching) return
      if (session.layout_mode === mode) return
      setLayoutSwitching(true)
      setErrorBanner(null)
      // Optimistic mode update so the panel highlight responds instantly.
      queryClient.setQueryData<SessionDetail>(['session', workspaceSlug], (current) =>
        current ? { ...current, layout_mode: mode } : current,
      )
      try {
        await flushDirtyPositions()
        const result = await relayoutSession(session.id, mode)
        queryClient.setQueryData<SessionDetail>(['session', workspaceSlug], (current) => {
          if (!current) return current
          const byId = new Map(result.moved.map((n) => [n.id, n]))
          return {
            ...current,
            layout_mode: result.layout_mode,
            nodes: current.nodes.map((node) => byId.get(node.id) ?? node),
          }
        })
        setAnimatePositions(true)
        setTimeout(() => setAnimatePositions(false), 600)
        setFitContentNonce((x) => x + 1)
      } catch (error) {
        // Roll back the optimistic switch on failure.
        queryClient.setQueryData<SessionDetail>(['session', workspaceSlug], (current) =>
          current ? { ...current, layout_mode: session.layout_mode } : current,
        )
        const message = error instanceof Error ? error.message : 'Failed to switch layout mode.'
        setErrorBanner(message)
      } finally {
        setLayoutSwitching(false)
      }
    },
    [flushDirtyPositions, layoutSwitching, queryClient, session, workspaceSlug],
  )

  const onConnectWire = useCallback(
    (fromId: number, toId: number) => {
      if (!session) return
      setSelectedLinkId(null)
      const payload = buildManualLinkPayload(fromId, toId)
      if (!payload) return
      const before = queryClient.getQueryData<SessionDetail>(['session', workspaceSlug])
      if (!before) return
      const sid = Number(session.id)

      // Optimistic: add temp link immediately
      const tempLinkId = -(Date.now())
      const tempLink: LinkOut = {
        id: tempLinkId,
        session_id: sid,
        parent_id: fromId,
        child_id: toId,
        color: null,
        line_style: 'solid',
        created_at: new Date().toISOString(),
      }
      const optimistic = addLinkDeterministic(cloneSession(before), tempLink)
      queryClient.setQueryData<SessionDetail>(['session', workspaceSlug], optimistic)
      setConnectMode(false)

      void mutLink
        .mutateAsync({ sid, body: payload })
        .then((createdLink) => {
          // Swap temp link for real link
          queryClient.setQueryData<SessionDetail>(['session', workspaceSlug], (current) => {
            if (!current) return current
            return {
              ...current,
              links: current.links.map((l) => (l.id === tempLinkId ? createdLink : l)),
            }
          })
          commitHistoryEntry({
            before,
            after: queryClient.getQueryData<SessionDetail>(['session', workspaceSlug])!,
            syncForward: () => restoreLink(sid, createdLink),
            syncBackward: () => deleteLink(sid, createdLink.id),
          })
        })
        .catch((error: Error) => {
          // Remove temp link on failure
          queryClient.setQueryData<SessionDetail>(['session', workspaceSlug], (current) => {
            if (!current) return current
            return { ...current, links: current.links.filter((l) => l.id !== tempLinkId) }
          })
          setErrorBanner(error.message)
        })
    },
    [commitHistoryEntry, mutLink, queryClient, session, workspaceSlug],
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
      const before = queryClient.getQueryData<SessionDetail>(['session', workspaceSlug])
      if (!before) return

      // Optimistic: add temp node immediately
      const tempId = -(Date.now())
      const tempNode: NodeOut = {
        id: tempId,
        session_id: Number(session.id),
        topic: body.topic ?? 'New node',
        summary: body.summary ?? null,
        details: body.details ?? null,
        subtopics: body.subtopics ?? { radiusPx },
        depth: body.depth ?? 0,
        position_x: cx,
        position_y: cy,
        original_position_x: cx,
        original_position_y: cy,
        node_type: body.node_type ?? 'manual',
        color: body.color ?? null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }
      const optimistic = addNodeDeterministic(cloneSession(before), tempNode)
      queryClient.setQueryData<SessionDetail>(['session', workspaceSlug], optimistic)

      void mutCreateNode
        .mutateAsync({ sid: Number(session.id), body })
        .then((createdNode) => {
          // Swap temp node for real node
          queryClient.setQueryData<SessionDetail>(['session', workspaceSlug], (current) => {
            if (!current) return current
            return {
              ...current,
              nodes: current.nodes.map((n) => (n.id === tempId ? createdNode : n)),
            }
          })
          commitHistoryEntry({
            before,
            after: queryClient.getQueryData<SessionDetail>(['session', workspaceSlug])!,
            syncForward: () => restoreNode(Number(session.id), createdNode.id, { node: createdNode, links: [] }),
            syncBackward: () => deleteNode(Number(session.id), createdNode.id),
          })
        })
        .catch((error: Error) => {
          // Remove temp node on failure
          queryClient.setQueryData<SessionDetail>(['session', workspaceSlug], (current) => {
            if (!current) return current
            return { ...current, nodes: current.nodes.filter((n) => n.id !== tempId) }
          })
          setErrorBanner(error.message)
        })
    },
    [commitHistoryEntry, mutCreateNode, queryClient, session, workspaceSlug],
  )


  const consumePromptStreamEvent = useCallback(
    (event: SessionPromptEvent) => {
      const nextStepId = () => {
        genStepSeqRef.current += 1
        return `stream-${genStepSeqRef.current}`
      }
      if (event.type === 'status') {
        const msg = (event.data as { message?: string }).message?.trim()
        if (!msg) return
        setGenerationSteps((prev) => [
          ...prev,
          { id: nextStepId(), title: msg, lane: 'pulse' },
        ])
        return
      }
      if (event.type === 'done') {
        return
      }
      if (event.type === 'tool_used') {
        const { tool, args } = event.data as { tool: string; args?: Record<string, unknown> }
        const labelRaw = args?.topic ?? args?.summary ?? args?.name ?? ''
        const label = typeof labelRaw === 'string' ? labelRaw : labelRaw != null ? String(labelRaw) : ''
        const title = humanizeAgentToolName(tool)
        setGenerationSteps((prev) => [
          ...prev,
          {
            id: nextStepId(),
            title,
            detail: label ? (label.length > 140 ? `${label.slice(0, 137)}…` : label) : undefined,
            lane: 'tool',
          },
        ])
        return
      }
      if (event.type === 'node_created') {
        const node = event.data as NodeOut
        queryClient.setQueryData<SessionDetail>(['session', workspaceSlug], (current) =>
          current ? addNodeDeterministic(current, node) : current,
        )
        streamingNodeIdsRef.current.add(node.id)
        return
      }
      if (event.type === 'node_deleted') {
        const { id } = event.data as { id: number }
        queryClient.setQueryData<SessionDetail>(['session', workspaceSlug], (current) =>
          current ? removeNodeDeterministic(current, id) : current,
        )
        return
      }
      if (event.type === 'node_updated') {
        const { id, position_x, position_y } = event.data as { id: number; position_x: number; position_y: number }
        queryClient.setQueryData<SessionDetail>(['session', workspaceSlug], (current) =>
          current ? updateNodePosition(current, id, position_x, position_y) : current,
        )
        return
      }
      if (event.type === 'link_created') {
        const link = event.data as LinkOut
        queryClient.setQueryData<SessionDetail>(['session', workspaceSlug], (current) =>
          current ? addLinkDeterministic(current, link) : current,
        )
        streamingLinkIdsRef.current.add(link.id)
        return
      }
      if (event.type === 'message_created') {
        const message = event.data as { role?: string; content?: string; id?: number; created_at?: string }
        if (!message.content || message.role === 'user') return
        const ts = message.created_at
          ? formatChatTimestamp(message.created_at)
          : formatChatTimestamp(new Date().toISOString())
        setChatMessages((prev) => [
          ...prev,
          {
            id: message.id ? `m-${message.id}` : `m-${Date.now()}`,
            role: message.role === 'user' ? 'user' : 'system',
            content: message.content ?? '',
            timestamp: ts,
          },
        ])
        return
      }
      if (event.type === 'sources_created') {
        const data = event.data as { sources?: ResearchSource[] }
        setSourcesList(data.sources ?? [])
        return
      }
      if (event.type === 'layout_mode_changed') {
        const data = event.data as { layout_mode?: string; reason?: string }
        const nextMode = data.layout_mode as LayoutMode | undefined
        if (!nextMode) return
        queryClient.setQueryData<SessionDetail>(['session', workspaceSlug], (current) =>
          current ? { ...current, layout_mode: nextMode } : current,
        )
        setAnimatePositions(true)
        setTimeout(() => setAnimatePositions(false), 700)
        return
      }
      if (event.type === 'error') {
        const msg = (event.data as { message?: string }).message ?? 'AI request failed.'
        setErrorBanner(msg)
      }
    },
    [queryClient, workspaceSlug],
  )

  const stopGeneration = useCallback(() => {
    const slug = generationStartedSlugRef.current
    const baseline = generationBaselineRef.current
    promptAbortRef.current?.abort()
    if (baseline && slug === workspaceSlug) {
      queryClient.setQueryData<SessionDetail>(['session', workspaceSlug], cloneSession(baseline.session))
      setChatMessages(baseline.chatMessages.map((m) => ({ ...m })))
      setSourcesList(baseline.sourcesList.map((s) => ({ ...s })))
    }
    streamingNodeIdsRef.current = new Set()
    streamingLinkIdsRef.current = new Set()
    setGenerationSteps([])
    setErrorBanner(null)
    void queryClient.invalidateQueries({ queryKey: ['session', workspaceSlug] })
  }, [queryClient, workspaceSlug])

  const runSessionPrompt = useCallback(
    async (prompt: string, anchorNodeId: number | null, opts?: { baseline?: GenerationBaseline }) => {
      if (!workspaceSlug || !session) return
      const snap = queryClient.getQueryData<SessionDetail>(['session', workspaceSlug]) ?? session
      if (!snap) return

      const baseline: GenerationBaseline =
        opts?.baseline ?? {
          session: cloneSession(snap),
          chatMessages: chatMessagesRef.current.map((m) => ({ ...m })),
          sourcesList: sourcesListRef.current.map((s) => ({ ...s })),
        }
      generationBaselineRef.current = baseline
      generationStartedSlugRef.current = workspaceSlug
      genStepSeqRef.current = 0
      setGenerationKind(anchorNodeId != null ? 'expand' : 'context')
      setGenerationSteps([
        {
          id: 'gen-lead-row',
          title: anchorNodeId != null ? 'Expand agent' : 'Context agent',
          detail:
            anchorNodeId != null
              ? 'Growing new branches from your selected topic'
              : 'Shaping the map from your latest message',
          lane: 'lead',
        },
      ])

      setStreaming(true)
      setErrorBanner(null)
      promptAbortRef.current?.abort()
      const ac = new AbortController()
      promptAbortRef.current = ac
      try {
        await flushDirtyPositions()
        await postSessionPromptStream(
          session.id,
          { prompt, anchor_node_id: anchorNodeId },
          consumePromptStreamEvent,
          { signal: ac.signal },
        )
        setFitContentNonce((x) => x + 1)
        setAnimatePositions(true)
        setTimeout(() => setAnimatePositions(false), 600)
        streamingNodeIdsRef.current = new Set()
        streamingLinkIdsRef.current = new Set()
      } catch (error) {
        if (isAbortError(error)) return
        const message = error instanceof Error ? error.message : 'AI request failed.'
        if (workspacePageMountedRef.current) setErrorBanner(message)
        throw error
      } finally {
        if (promptAbortRef.current === ac) {
          promptAbortRef.current = null
          if (workspacePageMountedRef.current) setStreaming(false)
        }
        streamingNodeIdsRef.current = new Set()
        streamingLinkIdsRef.current = new Set()
        setGenerationSteps([])
        generationBaselineRef.current = null
      }
    },
    [workspaceSlug, session, consumePromptStreamEvent, flushDirtyPositions, queryClient],
  )

  useEffect(() => {
    if (!workspaceSlug || !sessionQuery.isSuccess) return
    const trimmedSeed = initialPrompt.trim()
    if (!trimmedSeed) return

    const data = queryClient.getQueryData<SessionDetail>(['session', workspaceSlug])
    if (!data || (data.messages?.length ?? 0) > 0) return

    const anchorId = resolveHomeSeedAnchorId(data.nodes, trimmedSeed, centerNodeIdFromNav)
    if (anchorId == null) return
    const onceKey = String(data.id)
    if (workspaceHomeAutoPromptOnce.has(onceKey)) return
    workspaceHomeAutoPromptOnce.add(onceKey)

    setSelectedId(anchorId)
    void runSessionPrompt(trimmedSeed, anchorId).catch(() => {
      workspaceHomeAutoPromptOnce.delete(onceKey)
    })
  }, [centerNodeIdFromNav, initialPrompt, queryClient, runSessionPrompt, workspaceSlug, sessionQuery.isSuccess])

  const sendChat = async () => {
    const prompt = chatInput.trim()
    if (!prompt || !session || streaming) return
    const snap = queryClient.getQueryData<SessionDetail>(['session', workspaceSlug])
    if (!snap) return
    const baseline: GenerationBaseline = {
      session: cloneSession(snap),
      chatMessages: chatMessages.map((m) => ({ ...m })),
      sourcesList: sourcesList.map((s) => ({ ...s })),
    }
    setChatInput('')
    setChatMessages((prev) => [
      ...prev,
      {
        id: `u-${Date.now()}`,
        role: 'user' as const,
        content: prompt,
        timestamp: formatChatTimestamp(new Date().toISOString()),
      },
    ])
    try {
      // Chat prompts always go to Context Agent (no anchor).
      // Only explicit expand-button clicks send an anchor_node_id.
      await runSessionPrompt(prompt, null, { baseline })
    } catch {
      /* error banner set in runSessionPrompt */
    }
  }

  const showRightPanel = rightPanelMode !== 'none'
  const mainClassName = `mindforge-main${!showRightPanel ? ' mindforge-main--no-right' : ''}`
  const renamingNode = session?.nodes.find((n) => n.id === renamingNodeId) ?? null
  const renameLimit = renamingNode ? nodeTitleCharLimit(readNodeRadiusPx(renamingNode)) : 24
  const selectedLink = session?.links.find((l) => l.id === selectedLinkId) ?? null
  const selectedLinkStyle: LinkLineStyle = (selectedLink?.line_style ?? 'solid') as LinkLineStyle
  const copy = nodePanelCopy(session?.mode ?? 'research')
  const catalogNodes = session ? orderedNodesForCatalog(session) : []
  const panelNode = session?.nodes.find((node) => node.id === (panelNodeId ?? selectedId)) ?? null
  const panelSubtopics = renderSubtopics(panelNode?.subtopics)
  const panelNodeSources = session && panelNode ? sourcesLinkedToNode(panelNode.id, sourcesList) : []
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

  const toggleManualDock = () => {
    setDockPopover((p) => {
      if (p === 'manual') {
        setPlaceNodeMode(false)
        setConnectMode(false)
        return null
      }
      return 'manual'
    })
  }

  const toggleLayoutDock = () => {
    setDockPopover((p) => {
      if (p === 'layout') return null
      setPlaceNodeMode(false)
      setConnectMode(false)
      return 'layout'
    })
  }

  const closeDockPopoverIfClickedAway = (e: React.MouseEvent<HTMLElement>) => {
    if (dockPopover == null) return
    const target = e.target as HTMLElement
    if (target.closest('.mf-bottom-dock')) return
    if (target.closest('.mf-link-pop-wrap')) return
    setDockPopover(null)
    setPlaceNodeMode(false)
    setConnectMode(false)
  }

  const confirmDelete = () => {
    if (!session || !deleteConfirm) return
    const current = queryClient.getQueryData<SessionDetail>(['session', workspaceSlug])
    if (!current) return
    const before = cloneSession(current)
    const after = removeNodeDeterministic(before, deleteConfirm.node.id)
    queryClient.setQueryData<SessionDetail>(['session', workspaceSlug], after)
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
    queryClient.setQueryData<SessionDetail>(['session', workspaceSlug], cloneSession(entry.before))
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
    queryClient.setQueryData<SessionDetail>(['session', workspaceSlug], cloneSession(entry.after))
    entry.localForward?.()
    historyIndexRef.current = nextIndex
    setHistoryIndex(nextIndex)
    enqueueHistorySync(entry.syncForward)
  }

  const openRenameModal = useCallback(
    (nodeId?: number) => {
      const id = nodeId ?? selectedId
      if (id == null || !session) return
      const node = session.nodes.find((n) => n.id === id)
      if (!node) return
      setRenamingNodeId(node.id)
      setRenameDraft(node.topic ?? '')
    },
    [session, selectedId],
  )

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
    setDockPopover(null)
    setRightPanelMode('nodes')
    setNodesPanelView('catalog')
  }, [])

  const openNodeDetail = useCallback((nodeId: number) => {
    setDockPopover(null)
    setSelectedId(nodeId)
    setSelectedLinkId(null)
    setPanelNodeId(nodeId)
    setNodesPanelView('detail')
    setRightPanelMode('nodes')
  }, [])

  const closeInspectorPanel = useCallback(() => {
    setRightPanelMode('none')
  }, [])

  const closeManualFlyout = useCallback(() => {
    setDockPopover(null)
    setPlaceNodeMode(false)
    setConnectMode(false)
  }, [])

  const confirmDeleteLink = useCallback(() => {
    if (!session || !linkDeleteConfirm) return
    const current = queryClient.getQueryData<SessionDetail>(['session', workspaceSlug])
    if (!current) return
    const link = current.links.find((l) => l.id === linkDeleteConfirm.id)
    if (!link) {
      setLinkDeleteConfirm(null)
      setSelectedLinkId(null)
      return
    }
    const before = cloneSession(current)
    const after = removeLinkDeterministic(before, link.id)
    queryClient.setQueryData<SessionDetail>(['session', workspaceSlug], after)
    setSelectedLinkId(null)
    setLinkPopSubmenu(null)
    commitHistoryEntry({
      before,
      after,
      syncForward: () => deleteLink(Number(session.id), link.id),
      syncBackward: () => restoreLink(Number(session.id), link),
    })
    setLinkDeleteConfirm(null)
  }, [commitHistoryEntry, linkDeleteConfirm, queryClient, session, workspaceSlug])

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
      <AppTopBar activeItem='workspace' workspaceSessionId={session?.slug ?? workspaceSlug} />

      {errorBanner ? (
        <div className='ws-error-banner' role='alert'>
          {errorBanner}
          <button type='button' onClick={() => setErrorBanner(null)} aria-label='Dismiss'>
            <UiDismissX size={18} />
          </button>
        </div>
      ) : null}

      <main className={mainClassName} onClickCapture={closeDockPopoverIfClickedAway}>
        <div className='mf-workspace-center'>
        <section ref={canvasRef} className='mf-canvas mf-canvas--live'>
          {loading ? (
            <p className='mf-canvas-hint'>Loading project…</p>
          ) : !session ? (
            <p className='mf-canvas-hint'>Session not found.</p>
          ) : (
            <>
              {session.nodes.length === 0 ? (
                <p className='mf-canvas-hint'>
                  Empty map. Tap + in the bottom bar, choose Add node, then press and drag on the canvas to set the circle size.
                </p>
              ) : null}
              <MindMapCanvas
                ref={mindMapRef}
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
                fitContentNonce={fitContentNonce}
                onFitView={handleFitView}
                animatePositions={animatePositions}
                streamingNodeIds={streamingNodeIdsRef.current}
                newLinkIds={streamingLinkIdsRef.current}
                onViewportChange={onViewportChange}
                fitInset={fitInset}
                hoveredNodeId={hoveredId}
                onNodeStyleDelta={handleNodeStyleDelta}
                onRequestRename={openRenameModal}
              />
              {streaming ? (
                <CurioGenerationOverlay
                  open
                  headline={generationKind === 'expand' ? 'Expanding your map' : 'Generating your map'}
                  kicker={
                    session.mode === 'plan'
                      ? 'Plan mode · agents are structuring your ideas'
                      : 'Research mode · agents are building your map'
                  }
                  steps={generationSteps}
                  onStop={stopGeneration}
                  recoveryHint='Stop discards this run and restores your canvas and chat to how they looked before you sent.'
                />
              ) : null}
            </>
          )}
        </section>

        {dockOpen ? (
        <nav
          className={`mf-bottom-dock mf-bottom-dock--${dockPosition}${dockIsVertical ? ' mf-bottom-dock--vertical' : ''}`}
          aria-label='Workspace tools'
          data-orientation={dockIsVertical ? 'vertical' : 'horizontal'}
        >
          <div className='mf-bottom-dock__inner'>
            <div className='mf-bottom-dock__tools'>
              <div className='mf-dock-slot'>
                <button
                  type='button'
                  className={`mf-dock-btn${dockPopover === 'manual' || placeNodeMode || connectMode ? ' active' : ''}`}
                  title='Manual tools — add nodes and connections'
                  aria-pressed={dockPopover === 'manual'}
                  disabled={!session}
                  onClick={toggleManualDock}
                >
                  <svg width='22' height='22' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2.2' aria-hidden>
                    <circle cx='12' cy='12' r='9' />
                    <path d='M12 8v8M8 12h8' strokeLinecap='round' />
                  </svg>
                  <span className='mf-dock-btn__hint'>Manual</span>
                </button>
                <div
                  className={`mf-dock-pop mf-dock-pop--manual${dockPopover === 'manual' ? ' is-open' : ''}`}
                  aria-hidden={dockPopover !== 'manual'}
                >
                  <button
                    type='button'
                    className='mf-dock-pop__close'
                    title='Close'
                    aria-label='Close manual tools'
                    disabled={dockPopover !== 'manual'}
                    onClick={closeManualFlyout}
                  >
                    <UiDismissX />
                  </button>
                  <button
                    type='button'
                    className={`mf-fly-btn${placeNodeMode ? ' active' : ''}`}
                    title='Add node — press and drag on the canvas to size the circle'
                    disabled={dockPopover !== 'manual'}
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
                    disabled={dockPopover !== 'manual'}
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
              </div>

              <button
                type='button'
                className={`mf-dock-btn${rightPanelMode === 'nodes' ? ' active' : ''}`}
                title='Nodes list and details'
                aria-pressed={rightPanelMode === 'nodes'}
                disabled={!session}
                onClick={openNodesCatalog}
              >
                <svg width='22' height='22' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2' aria-hidden>
                  <path d='M8 6h13M8 12h13M8 18h13' strokeLinecap='round' />
                  <path d='M4 6h.01M4 12h.01M4 18h.01' strokeLinecap='round' strokeWidth='3' />
                </svg>
                <span className='mf-dock-btn__hint'>Nodes</span>
              </button>
              <button
                type='button'
                className={`mf-dock-btn${rightPanelMode === 'sources' ? ' active' : ''}`}
                title='Research sources'
                aria-pressed={rightPanelMode === 'sources'}
                disabled={!session}
                onClick={() => {
                  setDockPopover(null)
                  setRightPanelMode((m) => (m === 'sources' ? 'none' : 'sources'))
                }}
              >
                <svg width='22' height='22' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2' aria-hidden>
                  <path d='M7 4h7l3 3v13a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z' strokeLinejoin='round' />
                  <path d='M14 4v3h3M9 12h6M9 16h6' strokeLinecap='round' />
                </svg>
                <span className='mf-dock-btn__hint'>Sources</span>
              </button>
              <button
                type='button'
                className={`mf-dock-btn${rightPanelMode === 'ai' ? ' active' : ''}`}
                title='AI assistant'
                aria-pressed={rightPanelMode === 'ai'}
                disabled={!session}
                onClick={() => {
                  setDockPopover(null)
                  setRightPanelMode((mode) => (mode === 'ai' ? 'none' : 'ai'))
                }}
              >
                <svg width='22' height='22' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2' aria-hidden>
                  <path d='M12 3l1.2 3.6L17 8l-3.8 1.4L12 13l-1.2-3.6L7 8l3.8-1.4L12 3z' strokeLinejoin='round' />
                  <path d='M5 19l.7-2M19 19l-.7-2' strokeLinecap='round' />
                </svg>
                <span className='mf-dock-btn__hint'>AI</span>
              </button>

              <div className='mf-dock-slot'>
                <button
                  type='button'
                  className={`mf-dock-btn${dockPopover === 'layout' ? ' active' : ''}`}
                  title='Layout pattern'
                  aria-pressed={dockPopover === 'layout'}
                  disabled={!session || layoutSwitching || streaming}
                  onClick={toggleLayoutDock}
                >
                  <svg width='22' height='22' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2' aria-hidden>
                    <rect x='4' y='4' width='7' height='7' rx='1.5' />
                    <rect x='13' y='4' width='7' height='7' rx='1.5' />
                    <rect x='4' y='13' width='7' height='7' rx='1.5' />
                    <rect x='13' y='13' width='7' height='7' rx='1.5' />
                  </svg>
                  <span className='mf-dock-btn__hint'>Layout</span>
                </button>
                <div
                  className={`mf-dock-pop mf-dock-pop--layout${dockPopover === 'layout' ? ' is-open' : ''}`}
                  aria-hidden={dockPopover !== 'layout'}
                >
                  <button
                    type='button'
                    className='mf-dock-pop__close'
                    title='Close'
                    aria-label='Close layout options'
                    disabled={dockPopover !== 'layout'}
                    onClick={() => setDockPopover(null)}
                  >
                    <UiDismissX />
                  </button>
                  {session ? (
                    <LayoutModePanel
                      value={session.layout_mode}
                      onChange={handleLayoutModeChange}
                      disabled={layoutSwitching || streaming}
                      compact
                    />
                  ) : null}
                </div>
              </div>
            </div>

            <div className='mf-bottom-dock__history'>
              <button
                type='button'
                className={`mf-dock-btn mf-dock-btn--icon${canUndo ? '' : ' muted'}`}
                title={canUndo ? 'Undo (Ctrl+Z)' : 'Nothing to undo'}
                aria-label='Undo'
                disabled={!canUndo}
                onClick={undoAction}
              >
                <svg width='22' height='22' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2' aria-hidden>
                  <path d='M9 14 4 9l5-5' strokeLinecap='round' strokeLinejoin='round' />
                  <path d='M4 9h10.5a4.5 4.5 0 0 1 0 9H12' strokeLinecap='round' />
                </svg>
              </button>
              <button
                type='button'
                className={`mf-dock-btn mf-dock-btn--icon${canRedo ? '' : ' muted'}`}
                title={canRedo ? 'Redo (Ctrl+Y)' : 'Nothing to redo'}
                aria-label='Redo'
                disabled={!canRedo}
                onClick={redoAction}
              >
                <svg width='22' height='22' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2' aria-hidden>
                  <path d='M15 14l5-5-5-5' strokeLinecap='round' strokeLinejoin='round' />
                  <path d='M20 9H9.5a4.5 4.5 0 0 0 0 9H12' strokeLinecap='round' />
                </svg>
              </button>
            </div>

            <div className='mf-bottom-dock__view'>
              <button
                type='button'
                className={`mf-dock-btn mf-dock-btn--icon${viewportInfo.handToolActive ? ' active' : ''}`}
                title={viewportInfo.handToolActive ? 'Pan tool on — drag to move the canvas' : 'Pan tool — drag to move the canvas'}
                aria-label='Pan tool'
                aria-pressed={viewportInfo.handToolActive}
                disabled={!session}
                onClick={() => mindMapRef.current?.setHandTool(!viewportInfo.handToolActive)}
              >
                <svg width='20' height='20' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2' strokeLinecap='round' strokeLinejoin='round' aria-hidden>
                  <path d='M14.5 4.5 12 2 9.5 4.5M12 2v6M14.5 19.5 12 22l-2.5-2.5M12 22v-6M4.5 9.5 2 12l2.5 2.5M2 12h6M19.5 9.5 22 12l-2.5 2.5M22 12h-6' />
                </svg>
              </button>
              <button
                type='button'
                className='mf-dock-btn mf-dock-btn--icon'
                title='Zoom out'
                aria-label='Zoom out'
                disabled={!session}
                onClick={() => mindMapRef.current?.zoomOut()}
              >
                <svg width='20' height='20' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2.2' strokeLinecap='round' aria-hidden>
                  <path d='M5 12h14' />
                </svg>
              </button>
              <span className='mf-dock-zoom' aria-live='polite'>{Math.round(viewportInfo.scale * 100)}%</span>
              <button
                type='button'
                className='mf-dock-btn mf-dock-btn--icon'
                title='Zoom in'
                aria-label='Zoom in'
                disabled={!session}
                onClick={() => mindMapRef.current?.zoomIn()}
              >
                <svg width='20' height='20' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2.2' strokeLinecap='round' aria-hidden>
                  <path d='M12 5v14M5 12h14' />
                </svg>
              </button>
              <button
                type='button'
                className='mf-dock-btn mf-dock-btn--icon'
                title='Fit to view'
                aria-label='Fit to view'
                disabled={!session}
                onClick={() => mindMapRef.current?.fit()}
              >
                <svg width='20' height='20' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2' strokeLinecap='round' strokeLinejoin='round' aria-hidden>
                  <path d='M4 9V5a1 1 0 0 1 1-1h4M20 9V5a1 1 0 0 0-1-1h-4M4 15v4a1 1 0 0 0 1 1h4M20 15v4a1 1 0 0 1-1 1h-4' />
                </svg>
              </button>
            </div>

            <div className='mf-dock-slot'>
              <button
                type='button'
                className={`mf-dock-btn mf-dock-btn--icon${dockPopover === 'position' ? ' active' : ''}`}
                title='Move the bar — top, bottom, left, or right'
                aria-label='Move the bar'
                aria-pressed={dockPopover === 'position'}
                onClick={() => setDockPopover((p) => (p === 'position' ? null : 'position'))}
              >
                <svg width='20' height='20' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='1.8' strokeLinecap='round' strokeLinejoin='round' aria-hidden>
                  <rect x='3.5' y='3.5' width='17' height='17' rx='3' />
                  <path d='M12 7v10M7 12h10' opacity='0.55' strokeDasharray='1.6 2.4' />
                </svg>
              </button>
              <div
                className={`mf-dock-pop mf-dock-pop--position${dockPopover === 'position' ? ' is-open' : ''}`}
                aria-hidden={dockPopover !== 'position'}
                role='group'
                aria-label='Bar position'
              >
                <button
                  type='button'
                  className='mf-dock-pop__close'
                  title='Close'
                  aria-label='Close bar position picker'
                  disabled={dockPopover !== 'position'}
                  onClick={() => setDockPopover(null)}
                >
                  <UiDismissX />
                </button>
                <p className='mf-dock-pop__title'>Place bar</p>
                <div className='mf-position-grid'>
                  <button
                    type='button'
                    className={`mf-position-tile mf-position-tile--top${dockPosition === 'top' ? ' active' : ''}`}
                    aria-pressed={dockPosition === 'top'}
                    title='Top'
                    onClick={() => setDockPositionAndClose('top')}
                  >
                    <svg viewBox='0 0 32 24' aria-hidden>
                      <rect x='1.5' y='1.5' width='29' height='21' rx='3' className='mf-position-tile__frame' />
                      <rect x='6' y='4.5' width='20' height='3.5' rx='1.75' className='mf-position-tile__pill' />
                    </svg>
                    <span>Top</span>
                  </button>
                  <button
                    type='button'
                    className={`mf-position-tile mf-position-tile--right${dockPosition === 'right' ? ' active' : ''}`}
                    aria-pressed={dockPosition === 'right'}
                    title='Right'
                    onClick={() => setDockPositionAndClose('right')}
                  >
                    <svg viewBox='0 0 32 24' aria-hidden>
                      <rect x='1.5' y='1.5' width='29' height='21' rx='3' className='mf-position-tile__frame' />
                      <rect x='24' y='4.5' width='3.5' height='15' rx='1.75' className='mf-position-tile__pill' />
                    </svg>
                    <span>Right</span>
                  </button>
                  <button
                    type='button'
                    className={`mf-position-tile mf-position-tile--bottom${dockPosition === 'bottom' ? ' active' : ''}`}
                    aria-pressed={dockPosition === 'bottom'}
                    title='Bottom'
                    onClick={() => setDockPositionAndClose('bottom')}
                  >
                    <svg viewBox='0 0 32 24' aria-hidden>
                      <rect x='1.5' y='1.5' width='29' height='21' rx='3' className='mf-position-tile__frame' />
                      <rect x='6' y='16' width='20' height='3.5' rx='1.75' className='mf-position-tile__pill' />
                    </svg>
                    <span>Bottom</span>
                  </button>
                  <button
                    type='button'
                    className={`mf-position-tile mf-position-tile--left${dockPosition === 'left' ? ' active' : ''}`}
                    aria-pressed={dockPosition === 'left'}
                    title='Left'
                    onClick={() => setDockPositionAndClose('left')}
                  >
                    <svg viewBox='0 0 32 24' aria-hidden>
                      <rect x='1.5' y='1.5' width='29' height='21' rx='3' className='mf-position-tile__frame' />
                      <rect x='4.5' y='4.5' width='3.5' height='15' rx='1.75' className='mf-position-tile__pill' />
                    </svg>
                    <span>Left</span>
                  </button>
                </div>
              </div>
            </div>

            <button
              type='button'
              className='mf-bottom-dock__close'
              title='Hide controls'
              aria-label='Hide workspace controls'
              onClick={() => {
                setDockPopover(null)
                setDockOpen(false)
              }}
            >
              <UiDismissX size={18} />
            </button>
          </div>
        </nav>
        ) : (
          <button
            type='button'
            className={`mf-bottom-dock-handle mf-bottom-dock-handle--${dockPosition}`}
            title='Show workspace controls'
            aria-label='Show workspace controls'
            onClick={() => setDockOpen(true)}
          >
            <span className='mf-bottom-dock-handle__grip' aria-hidden />
          </button>
        )}
        {session && selectedLink ? (
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
        </div>

        {showRightPanel ? (
        <aside className='mf-chat' aria-label='Inspector'>
          {rightPanelMode === 'ai' ? (
            <div className='mf-right-stack'>
              <div className='mf-chat-header mf-panel-header-row'>
                <div className='mf-panel-header-row__main'>
                  <h2>Assistant</h2>
                  <span>{streaming ? 'Thinking…' : session?.mode === 'plan' ? 'Plan' : 'Research'}</span>
                </div>
                <button
                  type='button'
                  className='mf-panel-close'
                  onClick={closeInspectorPanel}
                  aria-label='Close panel'
                >
                  <UiDismissX size={20} />
                </button>
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
                  <div className='mf-chat-header mf-node-panel-header mf-panel-header-row'>
                    <div className='mf-panel-header-row__main'>
                      <p className='mf-detail-kicker'>{session?.mode === 'plan' ? 'Planning' : 'Research'}</p>
                      <h2>{copy.catalogTitle}</h2>
                      <span>{copy.catalogSubtitle}</span>
                    </div>
                    <button
                      type='button'
                      className='mf-panel-close'
                      onClick={closeInspectorPanel}
                      aria-label='Close panel'
                    >
                      <UiDismissX size={20} />
                    </button>
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
                    <div className='mf-detail-header-actions'>
                      <button type='button' className='mf-detail-back' onClick={() => setNodesPanelView('catalog')}>
                        ← Back to nodes
                      </button>
                      <button
                        type='button'
                        className='mf-panel-close'
                        onClick={closeInspectorPanel}
                        aria-label='Close panel'
                      >
                        <UiDismissX size={20} />
                      </button>
                    </div>
                    <p className='mf-detail-kicker'>{copy.detailKicker}</p>
                    <h2 className='mf-detail-title'>{panelNode?.topic || 'Select a node'}</h2>
                    {panelNode ? <span className='mf-node-depth-pill'>Depth {panelNode.depth}</span> : null}
                  </div>
                  <div className='mf-detail-scroll'>
                    {panelNode ? (
                      <>
                        <section className='mf-detail-block'>
                          <h3>{copy.summaryLabel}</h3>
                          {editingField === 'summary' ? (
                            <textarea
                              className='mf-detail-edit'
                              value={editingValue}
                              onChange={(e) => setEditingValue(e.target.value)}
                              onBlur={() => {
                                applyTrackedNodePatch(panelNode.id, { summary: editingValue })
                                setEditingField(null)
                              }}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); e.currentTarget.blur() }
                                if (e.key === 'Escape') { setEditingField(null) }
                              }}
                              autoFocus
                              rows={3}
                            />
                          ) : (
                            <p
                              className='mf-detail-text mf-detail-text--editable'
                              onClick={() => { setEditingField('summary'); setEditingValue(panelNode.summary || '') }}
                            >
                              {panelNode.summary || 'No summary saved yet.'}
                            </p>
                          )}
                        </section>
                        <section className='mf-detail-block'>
                          <h3>{copy.detailsLabel}</h3>
                          {editingField === 'details' ? (
                            <textarea
                              className='mf-detail-edit'
                              value={editingValue}
                              onChange={(e) => setEditingValue(e.target.value)}
                              onBlur={() => {
                                applyTrackedNodePatch(panelNode.id, { details: editingValue })
                                setEditingField(null)
                              }}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); e.currentTarget.blur() }
                                if (e.key === 'Escape') { setEditingField(null) }
                              }}
                              autoFocus
                              rows={5}
                            />
                          ) : (
                            <p
                              className='mf-detail-text mf-detail-text--editable'
                              onClick={() => { setEditingField('details'); setEditingValue(panelNode.details || '') }}
                            >
                              {panelNode.details || copy.emptyDetails}
                            </p>
                          )}
                        </section>
                        <section className='mf-detail-block'>
                          <h3>
                            {copy.subtopicsLabel}
                            {Array.isArray(panelNode.subtopics) && !('radiusPx' in (panelNode.subtopics as object)) && editingField !== 'subtopics' ? (
                              <button
                                type='button'
                                className='mf-detail-edit-btn'
                                onClick={() => {
                                  setEditingField('subtopics')
                                  setEditingValue(panelSubtopics.join('\n'))
                                }}
                              >
                                Edit
                              </button>
                            ) : null}
                          </h3>
                          {editingField === 'subtopics' ? (
                            <textarea
                              className='mf-detail-edit'
                              value={editingValue}
                              onChange={(e) => setEditingValue(e.target.value)}
                              onBlur={() => {
                                const lines = editingValue.split('\n').map(s => s.trim()).filter(Boolean)
                                applyTrackedNodePatch(panelNode.id, { subtopics: lines })
                                setEditingField(null)
                              }}
                              onKeyDown={(e) => {
                                if (e.key === 'Escape') { setEditingField(null) }
                              }}
                              autoFocus
                              rows={6}
                              placeholder='One subtopic per line'
                            />
                          ) : panelSubtopics.length ? (
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
                          <h3>Sources</h3>
                          {panelNodeSources.length ? (
                            <ul className='mf-node-sources-list'>
                              {panelNodeSources.map((src, idx) => (
                                <li key={`${src.title}-${idx}`}>
                                  <span className='mf-node-sources-list__title'>{src.title}</span>
                                  {src.url ? (
                                    <a
                                      className='mf-node-sources-list__link'
                                      href={src.url}
                                      target='_blank'
                                      rel='noreferrer noopener'
                                    >
                                      Open link
                                    </a>
                                  ) : null}
                                  {src.summary ? (
                                    <p className='mf-node-sources-list__summary'>{src.summary}</p>
                                  ) : null}
                                </li>
                              ))}
                            </ul>
                          ) : (
                            <p className='mf-muted'>
                              {session?.mode === 'plan'
                                ? 'No references are linked to this plan item yet. Run the assistant to attach documents to specific nodes.'
                                : 'No references are linked to this node yet. After an AI run, sources appear here when they cite this topic.'}
                            </p>
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
              <div className='mf-chat-header mf-node-panel-header mf-panel-header-row'>
                <div className='mf-panel-header-row__main'>
                  <p className='mf-detail-kicker'>{session?.mode === 'plan' ? 'Planning' : 'Research'}</p>
                  <h2>Sources</h2>
                  <span>
                    Each entry is tied to one or more nodes on the map. Use the chips to jump to that part of the graph.
                  </span>
                </div>
                <button
                  type='button'
                  className='mf-panel-close'
                  onClick={closeInspectorPanel}
                  aria-label='Close panel'
                >
                  <UiDismissX size={20} />
                </button>
              </div>
              <div className='mf-sources-scroll'>
                {sourcesList.length === 0 ? (
                  <div className='mf-right-empty'>
                    <p className='mf-right-empty__title'>No sources yet</p>
                    <h2>Run the AI on a research prompt</h2>
                    <p className='mf-right-empty__copy'>
                      After you send a prompt, citations with node-level links, summaries, excerpts, and relevance notes
                      appear here.
                    </p>
                  </div>
                ) : (
                  sourcesList.map((src, idx) => {
                    const ids = src.node_ids ?? []
                    const topics = src.node_topics ?? []
                    return (
                      <article key={`${src.title}-${idx}`} className='mf-source-card'>
                        <h3>{src.title}</h3>
                        {ids.length ? (
                          <div className='mf-source-nodes' role='group' aria-label='Nodes this source supports'>
                            <span className='mf-source-nodes__label'>For nodes</span>
                            <div className='mf-source-nodes__chips'>
                              {ids.map((nodeId, i) => (
                                <button
                                  key={`${nodeId}-${i}`}
                                  type='button'
                                  className='mf-source-node-chip'
                                  onClick={() => openNodeDetail(nodeId)}
                                >
                                  {sourceNodeLabel(nodeId, topics[i], session ?? undefined)}
                                </button>
                              ))}
                            </div>
                          </div>
                        ) : (
                          <p className='mf-source-nodes mf-source-nodes--legacy'>
                            <span className='mf-source-nodes__label'>Nodes</span>
                            <span className='mf-muted'>Not linked to specific nodes (older session).</span>
                          </p>
                        )}
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
                    )
                  })
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
              You can instantly undo/redo with Ctrl+Z / Ctrl+Y or the Undo/Redo buttons in the bottom bar.
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
              You can instantly undo/redo with Ctrl+Z / Ctrl+Y or the Undo/Redo buttons in the bottom bar.
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
