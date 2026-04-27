import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useLocation, useParams } from 'react-router-dom'
import { AppTopBar } from '../components/AppTopBar'
import { getSession, type SessionDetail } from '../lib/api'
import { recordSessionOpened } from '../lib/sessionRecent'

interface ChatMessage {
  id: string
  role: 'user' | 'system'
  content: string
  timestamp: string
}

export function WorkspaceCanvasPage() {
  const { sessionId = '' } = useParams()
  const location = useLocation()
  const [chatInput, setChatInput] = useState('')
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([])

  const sessionQuery = useQuery<SessionDetail>({
    queryKey: ['session', sessionId],
    queryFn: () => getSession(sessionId),
    enabled: sessionId.length > 0,
    placeholderData: (previous) => previous,
  })
  const session = sessionQuery.data ?? null
  const loading = sessionQuery.isPending && !session

  const rootNode = useMemo(() => {
    if (!session?.nodes?.length) return null
    return [...session.nodes].sort((a, b) => a.depth - b.depth)[0]
  }, [session])

  const initialPrompt: string = location.state?.initialPrompt ?? rootNode?.topic ?? ''

  const generatedNodes = useMemo(() => {
    const words = initialPrompt
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((word) => word.length > 3)

    const unique = Array.from(new Set(words)).slice(0, 4)

    const defaults = ['Foundations', 'Use Cases', 'Risks', 'Metrics']
    const labels = unique.length >= 4 ? unique : defaults

    return labels.map((label, index) => ({
      id: `seed-${index}`,
      label: label[0].toUpperCase() + label.slice(1),
    }))
  }, [initialPrompt])

  const sendChat = () => {
    if (!chatInput.trim()) return
    const message: ChatMessage = {
      id: `u-${Date.now()}`,
      role: 'user',
      content: chatInput.trim(),
      timestamp: new Date().toLocaleTimeString(),
    }
    setChatMessages((prev) => [...prev, message])
    setChatInput('')
  }

  useEffect(() => {
    if (sessionQuery.error) {
      const message =
        sessionQuery.error instanceof Error
          ? sessionQuery.error.message
          : 'Failed to load session.'
      setChatMessages([
        {
          id: 'err',
          role: 'system',
          content: message,
          timestamp: new Date().toLocaleTimeString(),
        },
      ])
      return
    }
    if (!session) return
    localStorage.setItem('curio:lastSessionId', String(session.id))
    recordSessionOpened(session.id)
    setChatMessages([
      {
        id: `sys-${session.id}`,
        role: 'system',
        content:
          'Session created. AI expansion is disabled for now; manual node editing is next.',
        timestamp: new Date().toLocaleTimeString(),
      },
    ])
  }, [session, sessionQuery.error])

  useEffect(() => {
    if (!initialPrompt) return
    setChatMessages([
      {
        id: 'starter-user',
        role: 'user',
        content: initialPrompt,
        timestamp: new Date().toLocaleTimeString(),
      },
      {
        id: 'starter-system',
        role: 'system',
        content:
          'Great starting prompt. AI generation is disabled for now, but your workspace is ready for manual expansion.',
        timestamp: new Date().toLocaleTimeString(),
      },
    ])
  }, [initialPrompt])

  return (
    <div className='mindforge-shell'>
      <AppTopBar activeItem='workspace' workspaceSessionId={sessionId} />

      <main className='mindforge-main'>
        <aside className='mf-left-rail'>
          <button type='button' className='rail-item active'>
            <span className='rail-icon-box'>
              <span className='rail-icon'>◍</span>
            </span>
            <span className='rail-label'>Nodes</span>
          </button>
          <button type='button' className='rail-item'>
            <span className='rail-icon-box'>
              <span className='rail-icon'>⌁</span>
            </span>
            <span className='rail-label'>Links</span>
          </button>
          <button type='button' className='rail-item'>
            <span className='rail-icon-box'>
              <span className='rail-icon'>▤</span>
            </span>
            <span className='rail-label'>Sources</span>
          </button>
          <button type='button' className='rail-item'>
            <span className='rail-icon-box'>
              <span className='rail-icon'>✦</span>
            </span>
            <span className='rail-label'>AI</span>
          </button>
          <button type='button' className='rail-item'>
            <span className='rail-icon-box'>
              <span className='rail-icon'>↺</span>
            </span>
            <span className='rail-label'>History</span>
          </button>
        </aside>

        <section className='mf-canvas'>
          <div className='mf-grid' />
          <div className='mf-node root'>
            <span className='node-chip'>Core</span>
            <h3>{rootNode?.topic ?? initialPrompt ?? 'Your topic'}</h3>
            <p>{loading ? 'Syncing session...' : session?.title ?? 'Untitled project'}</p>
          </div>

          <div className='mf-node orb orb-1'>
            <span>{generatedNodes[0]?.label}</span>
          </div>
          <div className='mf-node orb orb-2'>
            <span>{generatedNodes[1]?.label}</span>
          </div>
          <div className='mf-node orb orb-3'>
            <span>{generatedNodes[2]?.label}</span>
          </div>
          <div className='mf-node orb orb-4'>
            <span>{generatedNodes[3]?.label}</span>
          </div>

          <svg className='mf-links' viewBox='0 0 1200 720' preserveAspectRatio='none'>
            <path d='M610 350 C500 300 410 240 310 220' />
            <path d='M610 350 C700 300 795 240 900 220' />
            <path d='M610 350 C545 420 475 500 380 560' />
            <path d='M610 350 C690 420 770 500 860 560' />
          </svg>
        </section>

        <aside className='mf-chat'>
          <div className='mf-chat-header'>
            <h2>Research Assistant</h2>
            <span>{session?.mode === 'plan' ? 'Plan mode' : 'Research mode'}</span>
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
              onChange={(event) => setChatInput(event.target.value)}
              placeholder='Ask a follow-up question...'
              rows={2}
            />
            <button type='button' onClick={sendChat}>
              Send
            </button>
          </div>
        </aside>
      </main>
    </div>
  )
}
