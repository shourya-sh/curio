import { useCallback, useEffect, useRef, useState } from 'react'
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
  getSession,
  updateNode,
  type NodeOut,
  type SessionDetail,
} from '../lib/api'
import { layoutStackedNodes } from '../lib/graphLayout'
import { buildManualLinkPayload, buildManualNodePayload, buildNodeStylePatch } from '../lib/manualGraph'
import { readNodeRadiusPx } from '../lib/nodeDisplay'
import { recordSessionOpened } from '../lib/sessionRecent'

interface ChatMessage {
  id: string
  role: 'user' | 'system'
  content: string
  timestamp: string
}

function RailFace({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <span className={`rail-icon ${className}`.trim()}>{children}</span>
}

export function WorkspaceCanvasPage() {
  const { sessionId = '' } = useParams()
  const location = useLocation()
  const queryClient = useQueryClient()
  const [chatInput, setChatInput] = useState('')
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([])
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [hoveredId, setHoveredId] = useState<number | null>(null)
  const [manualOpen, setManualOpen] = useState(false)
  const [aiMode, setAiMode] = useState(false)
  const [placeNodeMode, setPlaceNodeMode] = useState(false)
  const [connectMode, setConnectMode] = useState(false)
  const [errorBanner, setErrorBanner] = useState<string | null>(null)
  const [pendingPos, setPendingPos] = useState<Map<number, { x: number; y: number }>>(() => new Map())
  const layoutStateRef = useRef<{ sid: string; done: boolean }>({ sid: '', done: false })

  const sessionQuery = useQuery<SessionDetail>({
    queryKey: ['session', sessionId],
    queryFn: () => getSession(sessionId),
    enabled: sessionId.length > 0,
    placeholderData: (previous) => previous,
  })
  const session = sessionQuery.data ?? null
  const loading = sessionQuery.isPending && !session
  const sid = session ? Number(session.id) : 0

  const invalidateSession = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ['session', sessionId] })
  }, [queryClient, sessionId])

  const mutUpdateNode = useMutation({
    mutationFn: (v: { id: number; patch: Parameters<typeof updateNode>[2] }) =>
      updateNode(sid, v.id, v.patch),
    onError: (e: Error) => setErrorBanner(e.message),
    onSuccess: () => {
      setErrorBanner(null)
      invalidateSession()
    },
  })

  const mutCreateNode = useMutation({
    mutationFn: (payload: { sid: number; body: Parameters<typeof createNode>[1] }) =>
      createNode(payload.sid, payload.body),
    onError: (e: Error) => setErrorBanner(e.message),
    onSuccess: () => {
      setErrorBanner(null)
      setPlaceNodeMode(false)
      invalidateSession()
    },
  })

  const mutLink = useMutation({
    mutationFn: (p: { parent_id: number; child_id: number }) => createLink(sid, p),
    onError: (e: Error) => setErrorBanner(e.message),
    onSuccess: () => {
      setErrorBanner(null)
      invalidateSession()
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

  const onSelect = useCallback((id: number | null) => {
    setSelectedId(id)
    setAiMode(false)
  }, [])

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
      mutUpdateNode.mutate(
        { id, patch: { position_x: x, position_y: y } },
        {
          onSettled: () => {
            setPendingPos((m) => {
              const nmap = new Map(m)
              nmap.delete(id)
              return nmap
            })
          },
        },
      )
    },
    [mutUpdateNode, session?.nodes],
  )

  const onConnectWire = useCallback(
    (fromId: number, toId: number) => {
      const payload = buildManualLinkPayload(fromId, toId)
      if (!payload) return
      mutLink.mutate(payload)
    },
    [mutLink],
  )

  const onPlaceNodeComplete = useCallback(
    (cx: number, cy: number, radiusPx: number) => {
      if (!session) return
      const body = buildManualNodePayload(session.mode, {
        centerX: cx,
        centerY: cy,
        radiusPx,
      })
      void mutCreateNode.mutateAsync({ sid: Number(session.id), body })
    },
    [mutCreateNode, session],
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
          content: 'Streaming assistant is not connected. Your map saves to the project as you work.',
          timestamp: new Date().toLocaleTimeString(),
        },
      ]
    })
  }, [session, initialPrompt])

  const sendChat = () => {
    if (!chatInput.trim()) return
    setChatMessages((prev) => [
      ...prev,
      { id: `u-${Date.now()}`, role: 'user' as const, content: chatInput.trim(), timestamp: new Date().toLocaleTimeString() },
    ])
    setChatInput('')
  }

  const showRightPanel = Boolean(aiMode)
  const mainClassName = `mindforge-main${!showRightPanel ? ' mindforge-main--no-right' : ''}`
  const focusedNode: NodeOut | null =
    session && (hoveredId != null || selectedId != null)
      ? session.nodes.find((n) => n.id === (hoveredId ?? selectedId)) ?? null
      : null
  const focusedStyle = focusedNode
    ? {
        left: `${(focusedNode.position_x / CANVAS_W) * 100}%`,
        top: `${Math.max(8, ((focusedNode.position_y - readNodeRadiusPx(focusedNode) - 56) / CANVAS_H) * 100)}%`,
      }
    : undefined

  const toggleManual = () => {
    setManualOpen((o) => {
      if (o) {
        setPlaceNodeMode(false)
        setConnectMode(false)
      }
      return !o
    })
  }

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

      <main className={mainClassName}>
        <div className='mf-rail-column'>
          <div className={`mf-manual-flyout${manualOpen ? ' is-open' : ''}`} aria-hidden={!manualOpen}>
            <button
              type='button'
              className={`mf-fly-btn${placeNodeMode ? ' active' : ''}`}
              title='Add node — press and drag on the canvas to size the circle'
              disabled={!manualOpen}
              onClick={() => {
                setConnectMode(false)
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
              title='Connect — drag from one node to another'
              disabled={!manualOpen}
              onClick={() => {
                setPlaceNodeMode(false)
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
            <button type='button' className='rail-item' disabled>
              <span className='rail-icon-box'>
                <RailFace>◍</RailFace>
              </span>
              <span className='rail-label'>Nodes</span>
            </button>
            <button type='button' className='rail-item' disabled>
              <span className='rail-icon-box'>
                <RailFace>⌁</RailFace>
              </span>
              <span className='rail-label'>Links</span>
            </button>
            <button type='button' className='rail-item' disabled>
              <span className='rail-icon-box'>
                <RailFace>▤</RailFace>
              </span>
              <span className='rail-label'>Sources</span>
            </button>
            <button
              type='button'
              className='rail-item'
              onClick={() => {
                setAiMode((a) => !a)
              }}
              aria-pressed={aiMode}
            >
              <span className='rail-icon-box'>
                <span className='rail-icon' aria-hidden>
                  ✧
                </span>
              </span>
              <span className='rail-label'>AI</span>
            </button>
            <button type='button' className='rail-item' disabled>
              <span className='rail-icon-box'>
                <RailFace>↺</RailFace>
              </span>
              <span className='rail-label'>History</span>
            </button>
          </aside>
        </div>

        <section className='mf-canvas mf-canvas--live'>
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
                connectMode={connectMode}
                placeNodeMode={placeNodeMode}
                onSelect={onSelect}
                onHoverNode={setHoveredId}
                onDragEnd={onDragEnd}
                onConnectWire={onConnectWire}
                onPlaceNodeComplete={onPlaceNodeComplete}
                pendingPosition={pendingPos}
              />
              {focusedNode ? (
                <div className='mf-node-style-pop' style={focusedStyle}>
                  <div className='mf-node-style-pop__row'>
                    <span>Style</span>
                    <span className='mf-node-style-pop__name'>{focusedNode.topic || 'Untitled'}</span>
                  </div>
                  <NodeColorField
                    nodeId={focusedNode.id}
                    value={focusedNode.color ?? null}
                    onChange={(hex) =>
                      mutUpdateNode.mutate({ id: focusedNode.id, patch: buildNodeStylePatch({ color: hex }) })
                    }
                  />
                  <label className='mf-node-style-pop__size'>
                    <span>Size</span>
                    <input
                      type='range'
                      min={28}
                      max={100}
                      step={1}
                      value={readNodeRadiusPx(focusedNode)}
                      onChange={(e) =>
                        mutUpdateNode.mutate({
                          id: focusedNode.id,
                          patch: buildNodeStylePatch({ radiusPx: Number(e.target.value) }),
                        })
                      }
                    />
                  </label>
                </div>
              ) : null}
            </>
          )}
        </section>

        {showRightPanel ? (
        <aside className='mf-chat' aria-label='Inspector'>
          {aiMode ? (
            <div className='mf-right-stack'>
              <div className='mf-chat-header'>
                <h2>Assistant</h2>
                <span>Local only · {session?.mode === 'plan' ? 'Plan' : 'Research'}</span>
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
                  placeholder='Notes…'
                  rows={2}
                />
                <button type='button' onClick={sendChat}>
                  Send
                </button>
              </div>
            </div>
          ) : null}
        </aside>
        ) : null}
      </main>
    </div>
  )
}
