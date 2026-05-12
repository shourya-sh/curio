import { useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate } from 'react-router-dom'
import { AppTopBar } from '../components/AppTopBar'
import { CurioGenerationOverlay, type GenerationOverlayStep } from '../components/CurioGenerationOverlay'
import { DecorativePageBackground } from '../components/DecorativePageBackground'
import { createNode, createSession, deleteSession, listSessions, type SessionListItem } from '../lib/api'
import { isAbortError } from '../lib/generationUi'
import { sessionListQueryKey } from '../lib/queryClient'
import { formatSessionUpdatedAt } from '../lib/sessionDisplay'
import { readRecentSessionRefs, recordSessionOpened } from '../lib/sessionRecent'
import { workspacePathSegment } from '../lib/workspaceRouting'

type HomeMode = 'research' | 'plan'

export function DashboardHomePage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [selectedMode, setSelectedMode] = useState<HomeMode | null>(null)
  const [prompt, setPrompt] = useState('')
  const [showEmptyModal, setShowEmptyModal] = useState(false)
  const [showNamingModal, setShowNamingModal] = useState(false)
  const [projectTitle, setProjectTitle] = useState('')
  const [homeGenPhase, setHomeGenPhase] = useState(0)
  const createAbortRef = useRef<AbortController | null>(null)

  const sessionsQuery = useQuery({
    queryKey: sessionListQueryKey,
    queryFn: listSessions,
    placeholderData: (previous) => previous,
  })
  const sessions = sessionsQuery.data ?? []
  const sessionsLoading = sessionsQuery.isPending && sessions.length === 0

  const createProjectMutation = useMutation({
    mutationFn: async (variables: { title: string; mode: HomeMode; prompt: string }) => {
      const signal = createAbortRef.current?.signal
      const session = await createSession(
        {
          title: variables.title,
          mode: variables.mode,
          slug_source: variables.prompt.trim() || undefined,
        },
        { signal },
      )
      try {
        const centerNode = await createNode(
          workspacePathSegment(session),
          {
            topic: variables.prompt,
            summary:
              variables.mode === 'research' ? 'Initial research focus' : 'Initial planning focus',
            details: variables.prompt,
          },
          { signal },
        )
        return { session, variables, centerNodeId: centerNode.id }
      } catch (error) {
        if (isAbortError(error)) {
          try {
            await deleteSession(workspacePathSegment(session))
          } catch {
            /* best-effort cleanup */
          }
        }
        throw error
      }
    },
    onMutate: async (variables) => {
      createAbortRef.current = new AbortController()
      await queryClient.cancelQueries({ queryKey: sessionListQueryKey })
      const previousSessions =
        queryClient.getQueryData<SessionListItem[]>(sessionListQueryKey) ?? []
      const optimisticId = -Date.now()
      const nowIso = new Date().toISOString()
      const optimisticSession: SessionListItem = {
        id: optimisticId,
        slug: '',
        title: variables.title,
        mode: variables.mode,
        created_at: nowIso,
        updated_at: nowIso,
      }
      queryClient.setQueryData<SessionListItem[]>(sessionListQueryKey, [
        optimisticSession,
        ...previousSessions,
      ])
      return { previousSessions, optimisticId }
    },
    onError: (error, _variables, context) => {
      if (context) {
        queryClient.setQueryData(sessionListQueryKey, context.previousSessions)
      }
      if (isAbortError(error)) return
      const message =
        error instanceof Error ? error.message : 'Failed to create project session.'
      window.alert(message)
    },
    onSuccess: ({ session, variables, centerNodeId }, _submitted, context) => {
      queryClient.setQueryData<SessionListItem[]>(sessionListQueryKey, (current = []) => {
        const next = current.map((item) =>
          item.id === context?.optimisticId ? { ...item, ...session } : item,
        )
        if (!next.some((item) => item.id === session.id)) {
          next.unshift(session)
        }
        return next
      })

      localStorage.setItem('curio:lastSessionId', session.slug)
      recordSessionOpened(session.slug)
      navigate(`/workspace/${session.slug}`, {
        state: {
          mode: variables.mode,
          title: variables.title,
          initialPrompt: variables.prompt,
          centerNodeId,
        },
      })
      setShowNamingModal(false)
    },
    onSettled: () => {
      createAbortRef.current = null
      void queryClient.invalidateQueries({ queryKey: sessionListQueryKey })
    },
  })

  const submitting = createProjectMutation.isPending

  useEffect(() => {
    if (!submitting) {
      setHomeGenPhase(0)
      return
    }
    setHomeGenPhase(0)
    const id = window.setTimeout(() => setHomeGenPhase(1), 800)
    return () => window.clearTimeout(id)
  }, [submitting])

  const homeGenSteps = useMemo((): GenerationOverlayStep[] => {
    if (!submitting) return []
    return [
      {
        id: 'home-ws',
        title: 'Workspace agent',
        detail: 'Creating your project shell and slug',
        lane: 'lead',
      },
      {
        id: 'home-node',
        title: 'Map seed agent',
        detail:
          homeGenPhase >= 1
            ? 'Placing your first topic as the center orbit'
            : 'Waiting for workspace…',
        lane: 'pulse',
      },
    ]
  }, [submitting, homeGenPhase])

  const cancelCreateProject = () => {
    createAbortRef.current?.abort()
  }
  const promptRef = useRef<HTMLTextAreaElement | null>(null)
  const titleInputRef = useRef<HTMLInputElement | null>(null)
  const handlePromptChange = (value: string) => {
    setPrompt(value)
    if (!promptRef.current) return
    promptRef.current.style.height = '0px'
    promptRef.current.style.height = `${Math.min(promptRef.current.scrollHeight, 220)}px`
  }


  const modeLabel =
    selectedMode === 'research'
      ? 'Research mode'
      : selectedMode === 'plan'
        ? 'Plan mode'
        : ''
  const modeIcon = selectedMode === 'research' ? 'R' : selectedMode === 'plan' ? 'P' : ''
  const canSend = prompt.trim().length > 0 && !submitting && selectedMode !== null
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
    if (!selectedMode) return
    if (!prompt.trim()) {
      setShowEmptyModal(true)
      return
    }
    setProjectTitle(suggestedTitle)
    setShowNamingModal(true)
  }

  const submitProject = async () => {
    const title = projectTitle.trim()
    if (!prompt.trim() || !title || submitting || !selectedMode) return

    try {
      await createProjectMutation.mutateAsync({
        title,
        mode: selectedMode,
        prompt: prompt.trim(),
      })
    } catch (error) {
      if (!isAbortError(error)) throw error
    }
  }

  useEffect(() => {
    if (!showNamingModal) return
    titleInputRef.current?.focus()
    titleInputRef.current?.select()
  }, [showNamingModal])

  const recentProjectsToShow = useMemo(() => {
    const recentRefs = readRecentSessionRefs()
    const ordered: SessionListItem[] = []
    const seen = new Set<number>()
    for (const ref of recentRefs) {
      const row = sessions.find((s) => s.slug === ref || String(s.id) === ref)
      if (row && !seen.has(row.id)) {
        ordered.push(row)
        seen.add(row.id)
      }
    }
    const rest = sessions
      .filter((s) => !seen.has(s.id))
      .slice()
      .sort(
        (a, b) =>
          new Date(b.updated_at ?? b.created_at).getTime() -
          new Date(a.updated_at ?? a.created_at).getTime(),
      )
    return [...ordered, ...rest].slice(0, 6)
  }, [sessions])

  const topBarWorkspaceSegment = useMemo(() => {
    const refs = readRecentSessionRefs()
    const stored = localStorage.getItem('curio:lastSessionId')
    const candidates = [...refs, ...(stored ? [stored] : [])]
    for (const r of candidates) {
      const row = sessions.find((s) => s.slug === r || String(s.id) === r)
      if (row) return workspacePathSegment(row)
    }
    return sessions[0] ? workspacePathSegment(sessions[0]) : null
  }, [sessions])

  return (
    <div className='app-shell'>
      <AppTopBar activeItem='home' workspaceSessionId={topBarWorkspaceSegment} />

      <main className='workspace-grid-bg'>
        <DecorativePageBackground />

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

          <div className={`prompt-composer ${selectedMode ? '' : 'no-mode'}`}>
            {selectedMode ? (
              <div className='composer-mode-pill'>
                <span className={`mode-dot ${selectedMode}`}>{modeIcon}</span>
                <span>{modeLabel}</span>
              </div>
            ) : null}
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
            <Link to='/library' className='view-all'>
              View all
            </Link>
          </div>

          {sessionsLoading ? (
            <div className='empty-project-state'>
              <p className='empty-kicker'>Loading</p>
              <h4>Fetching your projects</h4>
              <p>Pulling maps from your workspace.</p>
            </div>
          ) : recentProjectsToShow.length === 0 ? (
            <div className='empty-project-state'>
              <p className='empty-kicker'>No projects yet</p>
              <h4>Create your first Project</h4>
              <p>
                Pick a mode, write your first prompt, then click Send. You will name the
                project before entering the canvas.
              </p>
            </div>
          ) : (
            <div className='library-grid recent-projects-grid'>
              {recentProjectsToShow.map((project, index) => (
                <article key={project.id} className='library-project-card'>
                  <Link to={`/workspace/${workspacePathSegment(project)}`} className='project-card-link'>
                    <div className='project-thumb'>
                      <span className={`project-mode-pill ${project.mode}`}>
                        {project.mode === 'plan' ? 'Plan mode' : 'Research mode'}
                      </span>
                      <div className='thumb-orb orb-a' />
                      <div className='thumb-orb orb-b' />
                      <div className='thumb-orb orb-c' />
                      <div className='thumb-label'>Project #{index + 1}</div>
                    </div>
                    <div className='project-meta'>
                      <h3>{project.title}</h3>
                      <p>{formatSessionUpdatedAt(project.updated_at, project.created_at)}</p>
                    </div>
                  </Link>
                </article>
              ))}
            </div>
          )}
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

      {submitting ? (
        <CurioGenerationOverlay
          open
          fixed
          home
          headline='Spinning up your project'
          kicker='Curio is provisioning your workspace and first map node.'
          steps={homeGenSteps}
          onStop={cancelCreateProject}
          recoveryHint='Stop cancels creation, rolls back the project list, and removes a partially created workspace on the server when needed.'
        />
      ) : null}
    </div>
  )
}
