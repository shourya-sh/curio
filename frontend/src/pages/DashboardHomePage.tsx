import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { createNode, createSession } from '../lib/api'

const navItems = ['Workspace', 'Home', 'Library']
type HomeMode = 'research' | 'plan'

export function DashboardHomePage() {
  const navigate = useNavigate()
  const [selectedMode, setSelectedMode] = useState<HomeMode>('research')
  const [prompt, setPrompt] = useState('')
  const [showEmptyModal, setShowEmptyModal] = useState(false)
  const [showNamingModal, setShowNamingModal] = useState(false)
  const [projectTitle, setProjectTitle] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const promptRef = useRef<HTMLTextAreaElement | null>(null)
  const titleInputRef = useRef<HTMLInputElement | null>(null)
  const handlePromptChange = (value: string) => {
    setPrompt(value)
    if (!promptRef.current) return
    promptRef.current.style.height = '0px'
    promptRef.current.style.height = `${Math.min(promptRef.current.scrollHeight, 220)}px`
  }


  const modeLabel = selectedMode === 'research' ? 'Research mode' : 'Plan mode'
  const modeIcon = selectedMode === 'research' ? 'R' : 'P'
  const canSend = prompt.trim().length > 0 && !submitting
  const canCreateProject = projectTitle.trim().length > 0 && !submitting

  const suggestedTitle = useMemo(() => {
    const trimmed = prompt.trim()
    if (!trimmed) {
      return selectedMode === 'research' ? 'New research map' : 'New plan map'
    }
    const base = trimmed.split(/\s+/).slice(0, 5).join(' ')
    return base.length > 0 ? base : 'Untitled map'
  }, [prompt, selectedMode])

  const openNamingModal = () => {
    if (!prompt.trim()) {
      setShowEmptyModal(true)
      return
    }
    setProjectTitle(suggestedTitle)
    setShowNamingModal(true)
  }

  const submitProject = async () => {
    const title = projectTitle.trim()
    if (!prompt.trim() || !title || submitting) return

    setSubmitting(true)
    try {
      const session = await createSession({
        title,
        mode: selectedMode,
      })

      await createNode(session.id, {
        topic: prompt.trim(),
        summary:
          selectedMode === 'research'
            ? 'Initial research focus'
            : 'Initial planning focus',
        details: prompt.trim(),
      })

      navigate(`/workspace/${session.id}`, {
        state: {
          mode: selectedMode,
          title,
          initialPrompt: prompt.trim(),
        },
      })
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Failed to create project session.'
      window.alert(message)
    } finally {
      setSubmitting(false)
      setShowNamingModal(false)
    }
  }

  useEffect(() => {
    if (!showNamingModal) return
    titleInputRef.current?.focus()
    titleInputRef.current?.select()
  }, [showNamingModal])

  return (
    <div className='app-shell'>
      <header className='top-nav'>
        <div className='brand-group'>
          <span className='brand'>Curio</span>
        </div>

        <nav className='main-nav'>
          {navItems.map((item) => (
            <button
              key={item}
              type='button'
              className={`nav-link ${item === 'Home' ? 'selected' : ''}`}
            >
              {item}
            </button>
          ))}
        </nav>

        <div className='nav-actions'>
          <button type='button' className='icon-btn'>
            ?
          </button>
          <button type='button' className='icon-btn'>
            ??
          </button>
          <button type='button' className='avatar-btn'>
            S
          </button>
        </div>
      </header>

      <main className='workspace-grid-bg'>
        <div className='bubble bubble-cyan' />
        <div className='bubble bubble-pink' />
        <div className='bubble bubble-mint' />
        <div className='bubble bubble-lilac' />
        <div className='bubble bubble-peach' />

        <section className='hero'>
          <h1>What&apos;s on your mind?</h1>

          <div className='mode-cards'>
            <button
              type='button'
              className={`mode-card ${selectedMode === 'research' ? 'selected' : ''}`}
              onClick={() => setSelectedMode('research')}
            >
              <div className='mode-icon mode-research'>R</div>
              <div>
                <h2>Research Mode</h2>
                <p>Deep dive into any topic</p>
              </div>
            </button>

            <button
              type='button'
              className={`mode-card ${selectedMode === 'plan' ? 'selected' : ''}`}
              onClick={() => setSelectedMode('plan')}
            >
              <div className='mode-icon mode-plan'>P</div>
              <div>
                <h2>Plan Mode</h2>
                <p>Structure your next project</p>
              </div>
            </button>
          </div>

          <div className='prompt-composer'>
            <div className='composer-mode-pill'>
              <span className={`mode-dot ${selectedMode}`}>{modeIcon}</span>
              <span>{modeLabel}</span>
            </div>
            <textarea
              ref={promptRef}
              placeholder='Start typing a thought or ask a question...'
              aria-label='Ask Curio a question'
              value={prompt}
              onChange={(event) => handlePromptChange(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey && canSend) {
                  event.preventDefault()
                  openNamingModal()
                }
              }}
              rows={1}
            />
            <button
              type='button'
              className='send-btn'
              aria-label='Send prompt'
              onClick={openNamingModal}
              disabled={!canSend}
            >
              Send
            </button>
          </div>
        </section>

        <section className='recent-projects'>
          <div className='section-header'>
            <h3>Recent Projects</h3>
            <button type='button' className='view-all'>
              View all
            </button>
          </div>

          <div className='empty-project-state'>
            <p className='empty-kicker'>No projects yet</p>
            <h4>Create your first Project</h4>
            <p>
              Pick a mode, write your first prompt, then click Send. You will name the
              project before entering the canvas.
            </p>
          </div>
        </section>
      </main>
      {showEmptyModal ? (
        <div className='modal-overlay' role='dialog' aria-modal='true'>
          <div className='modal-card'>
            <h4>Prompt required</h4>
            <p>Write a prompt first so Curio can start your map.</p>
            <button type='button' onClick={() => setShowEmptyModal(false)}>
              Got it
            </button>
          </div>
        </div>
      ) : null}

      {showNamingModal ? (
        <div className='modal-overlay' role='dialog' aria-modal='true'>
          <div className='modal-card'>
            <h4>Name this project</h4>
            <p>You can rename this anytime later.</p>
            <input
              ref={titleInputRef}
              type='text'
              value={projectTitle}
              onChange={(event) => setProjectTitle(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault()
                  if (canCreateProject) {
                    void submitProject()
                  }
                }
              }}
              placeholder='e.g. AI safety fundamentals'
              autoFocus
            />
            <div className='modal-actions'>
              <button
                type='button'
                className='secondary'
                onClick={() => setShowNamingModal(false)}
                disabled={submitting}
              >
                Cancel
              </button>
              <button type='button' onClick={submitProject} disabled={!canCreateProject}>
                {submitting ? 'Creating...' : 'Create project'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
