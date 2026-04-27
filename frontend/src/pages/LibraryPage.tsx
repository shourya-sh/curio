import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { AppTopBar } from '../components/AppTopBar'
import { DecorativePageBackground } from '../components/DecorativePageBackground'
import {
  deleteSession,
  listSessions,
  type SessionListItem,
  updateSessionTitle,
} from '../lib/api'
import { sessionListQueryKey } from '../lib/queryClient'
import { formatSessionUpdatedAt } from '../lib/sessionDisplay'
import { readRecentSessionIds, removeSessionFromRecent } from '../lib/sessionRecent'

export function LibraryPage() {
  const queryClient = useQueryClient()
  const [search, setSearch] = useState('')
  const [renameTarget, setRenameTarget] = useState<SessionListItem | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [deleteTarget, setDeleteTarget] = useState<SessionListItem | null>(null)

  const sessionsQuery = useQuery({
    queryKey: sessionListQueryKey,
    queryFn: listSessions,
    placeholderData: (previous) => previous,
  })
  const projects = sessionsQuery.data ?? []
  const loading = sessionsQuery.isPending && projects.length === 0

  const renameMutation = useMutation({
    mutationFn: ({ projectId, nextTitle }: { projectId: number; nextTitle: string }) =>
      updateSessionTitle(projectId, nextTitle),
    onMutate: async ({ projectId, nextTitle }) => {
      await queryClient.cancelQueries({ queryKey: sessionListQueryKey })
      const previousProjects =
        queryClient.getQueryData<SessionListItem[]>(sessionListQueryKey) ?? []
      queryClient.setQueryData<SessionListItem[]>(sessionListQueryKey, (current = []) =>
        current.map((item) =>
          item.id === projectId
            ? { ...item, title: nextTitle, updated_at: new Date().toISOString() }
            : item,
        ),
      )
      return { previousProjects }
    },
    onError: (error, _variables, context) => {
      if (context) {
        queryClient.setQueryData(sessionListQueryKey, context.previousProjects)
      }
      const message = error instanceof Error ? error.message : 'Failed to rename project.'
      window.alert(message)
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: sessionListQueryKey })
    },
  })

  const deleteMutation = useMutation({
    mutationFn: ({ projectId }: { projectId: number }) => deleteSession(projectId),
    onMutate: async ({ projectId }) => {
      await queryClient.cancelQueries({ queryKey: sessionListQueryKey })
      const previousProjects =
        queryClient.getQueryData<SessionListItem[]>(sessionListQueryKey) ?? []
      queryClient.setQueryData<SessionListItem[]>(sessionListQueryKey, (current = []) =>
        current.filter((item) => item.id !== projectId),
      )
      removeSessionFromRecent(projectId)
      const stored = localStorage.getItem('curio:lastSessionId')
      if (stored === String(projectId)) {
        localStorage.removeItem('curio:lastSessionId')
      }
      return { previousProjects }
    },
    onError: (error, _variables, context) => {
      if (context) {
        queryClient.setQueryData(sessionListQueryKey, context.previousProjects)
      }
      const message = error instanceof Error ? error.message : 'Failed to delete project.'
      window.alert(message)
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: sessionListQueryKey })
    },
  })

  const busyProjectId =
    (renameMutation.isPending ? renameMutation.variables?.projectId : null) ??
    (deleteMutation.isPending ? deleteMutation.variables?.projectId : null)

  const filteredProjects = useMemo(() => {
    const query = search.trim().toLowerCase()
    if (!query) return projects
    return projects.filter((project) => project.title.toLowerCase().includes(query))
  }, [projects, search])

  const workspaceSessionId = useMemo(() => {
    const recentFirst = readRecentSessionIds()[0]
    const stored = localStorage.getItem('curio:lastSessionId')
    const storedNum = stored != null && !Number.isNaN(Number(stored)) ? Number(stored) : null
    return recentFirst ?? storedNum ?? projects[0]?.id ?? null
  }, [projects])

  const openRenameModal = (project: SessionListItem) => {
    if (busyProjectId !== null) return
    setRenameTarget(project)
    setRenameValue(project.title)
  }

  const handleRename = async () => {
    const project = renameTarget
    if (!project || busyProjectId !== null) return

    const nextTitle = renameValue.trim()
    if (!nextTitle || nextTitle === project.title) return

    await renameMutation.mutateAsync({ projectId: project.id, nextTitle })
    setRenameTarget(null)
    setRenameValue('')
  }

  const openDeleteModal = (project: SessionListItem) => {
    if (busyProjectId !== null) return
    setDeleteTarget(project)
  }

  const handleDelete = async () => {
    const project = deleteTarget
    if (!project || busyProjectId !== null) return

    await deleteMutation.mutateAsync({ projectId: project.id })
    setDeleteTarget(null)
  }

  return (
    <div className='app-shell library-shell'>
      <AppTopBar activeItem='library' workspaceSessionId={workspaceSessionId} />

      <main className='library-grid-bg'>
        <DecorativePageBackground />

        <section className='library-content'>
          <div className='library-header'>
            <h1>Library</h1>
            <p>Search and reopen any Curio project.</p>
          </div>

          <div className='library-search-wrap'>
            <input
              type='search'
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder='Search projects by name'
              aria-label='Search projects by name'
            />
          </div>

          {loading ? (
            <div className='library-empty-state'>
              <h3>Loading projects...</h3>
            </div>
          ) : projects.length === 0 ? (
            <div className='library-empty-state'>
              <h3>Create your first project</h3>
              <p>Start from Home and generate your first Curio map.</p>
              <Link to='/' className='library-empty-action'>
                Go to Home
              </Link>
            </div>
          ) : filteredProjects.length === 0 ? (
            <div className='library-empty-state'>
              <h3>No projects found</h3>
              <p>Try a different name, or create a new map from Home.</p>
            </div>
          ) : (
            <div className='library-grid'>
              {filteredProjects.map((project, index) => (
                <article key={project.id} className='library-project-card'>
                  <Link to={`/workspace/${project.id}`} className='project-card-link'>
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
                  <div className='project-actions'>
                    <button
                      type='button'
                      className='project-action secondary'
                      onClick={() => openRenameModal(project)}
                      disabled={busyProjectId !== null}
                    >
                      Rename
                    </button>
                    <button
                      type='button'
                      className='project-action danger'
                      onClick={() => openDeleteModal(project)}
                      disabled={busyProjectId !== null}
                    >
                      Delete
                    </button>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      </main>

      {renameTarget ? (
        <div className='modal-overlay' role='dialog' aria-modal='true'>
          <div className='modal-card'>
            <h4>Rename project</h4>
            <p>Choose a new name for this project.</p>
            <p className='modal-session-updated'>
              {formatSessionUpdatedAt(renameTarget.updated_at, renameTarget.created_at)}
            </p>
            <input
              type='text'
              value={renameValue}
              onChange={(event) => setRenameValue(event.target.value)}
              onKeyDown={(event) => {
                if (event.key !== 'Enter') return
                event.preventDefault()
                const trimmed = renameValue.trim()
                if (
                  busyProjectId !== null ||
                  trimmed.length === 0 ||
                  trimmed === renameTarget.title
                ) {
                  return
                }
                void handleRename()
              }}
              placeholder='Enter a project title'
              autoFocus
            />
            <div className='modal-actions'>
              <button
                type='button'
                className='secondary'
                onClick={() => {
                  if (busyProjectId !== null) return
                  setRenameTarget(null)
                  setRenameValue('')
                }}
                disabled={busyProjectId !== null}
              >
                Cancel
              </button>
              <button
                type='button'
                onClick={() => void handleRename()}
                disabled={
                  busyProjectId !== null ||
                  renameValue.trim().length === 0 ||
                  renameValue.trim() === renameTarget.title
                }
              >
                {busyProjectId === renameTarget.id ? 'Saving...' : 'Save name'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {deleteTarget ? (
        <div className='modal-overlay' role='dialog' aria-modal='true'>
          <div className='modal-card'>
            <h4>Delete project?</h4>
            <p>
              This will permanently remove <strong>{deleteTarget.title}</strong> and its linked
              nodes/messages.
            </p>
            <div className='modal-actions'>
              <button
                type='button'
                className='secondary'
                onClick={() => {
                  if (busyProjectId !== null) return
                  setDeleteTarget(null)
                }}
                disabled={busyProjectId !== null}
              >
                Cancel
              </button>
              <button
                type='button'
                className='danger'
                onClick={() => void handleDelete()}
                disabled={busyProjectId !== null}
              >
                {busyProjectId === deleteTarget.id ? 'Deleting...' : 'Delete project'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
