import { type CSSProperties, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'

type NodeKind = 'center' | 'research' | 'plan' | 'shared'
type IconName =
  | 'spark'
  | 'list'
  | 'branch'
  | 'doc'
  | 'chat'
  | 'network'
  | 'target'
  | 'map'
  | 'flag'
  | 'stack'
  | 'scale'
  | 'check'
  | 'clock'
  | 'canvas'
  | 'link'
  | 'folder'
  | 'people'
  | 'export'
  | 'bolt'
  | 'core'

type LandingNode = {
  id: string
  label: string
  kind: NodeKind
  icon: IconName
  x: number
  y: number
  colorA: string
  colorB: string
  ink: string
}

const NODES: LandingNode[] = [
  {
    id: 'curio',
    label: 'Curio',
    kind: 'center',
    icon: 'core',
    x: 54,
    y: 50,
    colorA: '#d9f3ff',
    colorB: '#ffe0f6',
    ink: '#0f172a',
  },

  { id: 'smartPrompts', label: 'Smart Prompts', kind: 'research', icon: 'spark', x: 21, y: 13, colorA: '#dbe8ff', colorB: '#b9d7ff', ink: '#233c86' },
  { id: 'topicBreakdown', label: 'Topic Breakdown', kind: 'research', icon: 'list', x: 34, y: 30, colorA: '#dff3ff', colorB: '#abdfff', ink: '#16506f' },
  { id: 'subtopicBranching', label: 'Subtopic Branching', kind: 'research', icon: 'branch', x: 40, y: 8, colorA: '#ece4ff', colorB: '#c9b8ff', ink: '#4b3196' },
  { id: 'sourceSummaries', label: 'Source Summaries', kind: 'research', icon: 'doc', x: 66, y: 8, colorA: '#e1fbff', colorB: '#aeeef8', ink: '#0d5b66' },
  { id: 'followupLoops', label: 'Follow-up Loops', kind: 'research', icon: 'chat', x: 85, y: 18, colorA: '#fff0c9', colorB: '#ffd98b', ink: '#7a4a0b' },
  { id: 'knowledgeGraph', label: 'Knowledge Graph', kind: 'research', icon: 'network', x: 72, y: 30, colorA: '#e7edff', colorB: '#b7c4ff', ink: '#273a8f' },

  { id: 'goalDecomposition', label: 'Goal Decomposition', kind: 'plan', icon: 'target', x: 81, y: 50, colorA: '#ffe4f0', colorB: '#ffb6d4', ink: '#8d2456' },
  { id: 'roadmapFraming', label: 'Roadmap Framing', kind: 'plan', icon: 'map', x: 93, y: 40, colorA: '#ffe7d6', colorB: '#ffbd8f', ink: '#8a3c14' },
  { id: 'milestoneSequencing', label: 'Milestone Sequencing', kind: 'plan', icon: 'flag', x: 91, y: 63, colorA: '#fff1bd', colorB: '#ffd66b', ink: '#77510c' },
  { id: 'taskClusterDrafting', label: 'Task Clusters', kind: 'plan', icon: 'stack', x: 71, y: 70, colorA: '#fde5ff', colorB: '#e8b8ff', ink: '#70358d' },
  { id: 'tradeoffMapping', label: 'Tradeoff Mapping', kind: 'plan', icon: 'scale', x: 58, y: 90, colorA: '#ffdfe9', colorB: '#ffa9c4', ink: '#862547' },
  { id: 'decisionTracking', label: 'Decision Tracking', kind: 'plan', icon: 'check', x: 35, y: 88, colorA: '#e9f0ff', colorB: '#c8d6ff', ink: '#34418c' },

  { id: 'sessionHistory', label: 'Session History', kind: 'shared', icon: 'clock', x: 17, y: 78, colorA: '#e3fff4', colorB: '#a8f3d9', ink: '#14624e' },
  { id: 'visualCanvas', label: 'Visual Canvas', kind: 'shared', icon: 'canvas', x: 7, y: 62, colorA: '#dffcf7', colorB: '#9de8dc', ink: '#0f6259' },
  { id: 'interactiveLinks', label: 'Interactive Links', kind: 'shared', icon: 'link', x: 9, y: 43, colorA: '#dcf7ff', colorB: '#a5e6ff', ink: '#155978' },
  { id: 'projectLibrary', label: 'Project Library', kind: 'shared', icon: 'folder', x: 7, y: 23, colorA: '#e8fff0', colorB: '#b3f0c5', ink: '#1c6730' },
  { id: 'collabMapping', label: 'Collaborative Mapping', kind: 'shared', icon: 'people', x: 31, y: 50, colorA: '#eefbe0', colorB: '#c7ef91', ink: '#486915' },
  { id: 'oneClickExport', label: 'One-click Export', kind: 'shared', icon: 'export', x: 53, y: 75, colorA: '#f0ebff', colorB: '#cdbfff', ink: '#4f3a9a' },
  { id: 'focusWorkflows', label: 'Focus Workflows', kind: 'shared', icon: 'bolt', x: 80, y: 83, colorA: '#fef7d1', colorB: '#f9dd72', ink: '#72560a' },
]

type LinkKind = 'primary' | 'secondary' | 'cross'
type LinkSide = 'top' | 'right' | 'bottom' | 'left'

type NodeLink = {
  from: string
  to: string
  kind: LinkKind
  fromSide: LinkSide
  toSide: LinkSide
}

const link = (
  from: string,
  to: string,
  kind: LinkKind,
  fromSide: LinkSide,
  toSide: LinkSide,
): NodeLink => ({ from, to, kind, fromSide, toSide })

const LINKS: NodeLink[] = [
  // Layer 1: Curio connects only to the inner hub ring.
  link('curio', 'topicBreakdown', 'primary', 'left', 'right'),
  link('curio', 'knowledgeGraph', 'primary', 'top', 'bottom'),
  link('curio', 'goalDecomposition', 'primary', 'right', 'left'),
  link('curio', 'taskClusterDrafting', 'primary', 'bottom', 'top'),
  link('curio', 'oneClickExport', 'primary', 'bottom', 'right'),
  link('curio', 'visualCanvas', 'primary', 'left', 'right'),
  link('curio', 'collabMapping', 'primary', 'left', 'right'),

  // Research branch: prompt -> breakdown -> branches/sources -> graph/follow-ups.
  link('topicBreakdown', 'smartPrompts', 'secondary', 'top', 'right'),
  link('topicBreakdown', 'subtopicBranching', 'secondary', 'top', 'bottom'),
  link('topicBreakdown', 'sourceSummaries', 'secondary', 'right', 'left'),
  link('subtopicBranching', 'sourceSummaries', 'secondary', 'right', 'left'),
  link('sourceSummaries', 'knowledgeGraph', 'secondary', 'bottom', 'top'),
  link('knowledgeGraph', 'followupLoops', 'secondary', 'top', 'left'),

  // Planning branch: goals -> roadmaps/milestones -> tasks -> decisions/tradeoffs.
  link('goalDecomposition', 'roadmapFraming', 'secondary', 'top', 'left'),
  link('goalDecomposition', 'milestoneSequencing', 'secondary', 'right', 'left'),
  link('roadmapFraming', 'milestoneSequencing', 'secondary', 'bottom', 'top'),
  link('milestoneSequencing', 'taskClusterDrafting', 'secondary', 'left', 'right'),
  link('taskClusterDrafting', 'tradeoffMapping', 'secondary', 'bottom', 'top'),
  link('tradeoffMapping', 'decisionTracking', 'secondary', 'left', 'right'),
  link('taskClusterDrafting', 'decisionTracking', 'secondary', 'left', 'right'),

  // Shared workspace branch: canvas/history/links/library/collaboration/export.
  link('visualCanvas', 'sessionHistory', 'secondary', 'bottom', 'right'),
  link('visualCanvas', 'interactiveLinks', 'secondary', 'top', 'bottom'),
  link('interactiveLinks', 'projectLibrary', 'secondary', 'top', 'bottom'),
  link('projectLibrary', 'collabMapping', 'secondary', 'right', 'left'),
  link('collabMapping', 'oneClickExport', 'secondary', 'right', 'left'),
  link('oneClickExport', 'focusWorkflows', 'secondary', 'right', 'left'),

  // Cross-branch bridges: the same work can move between research, planning, and output.
  link('knowledgeGraph', 'goalDecomposition', 'cross', 'right', 'left'),
  link('sourceSummaries', 'tradeoffMapping', 'cross', 'bottom', 'top'),
  link('followupLoops', 'roadmapFraming', 'cross', 'bottom', 'top'),
  link('milestoneSequencing', 'oneClickExport', 'cross', 'left', 'right'),
  link('decisionTracking', 'visualCanvas', 'cross', 'left', 'right'),
  link('smartPrompts', 'projectLibrary', 'cross', 'bottom', 'top'),
  link('interactiveLinks', 'subtopicBranching', 'cross', 'top', 'left'),
]

function NodeIcon({ name }: { name: IconName }) {
  const common = {
    fill: 'none',
    stroke: 'currentColor',
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    strokeWidth: 2,
  }

  return (
    <svg viewBox='0 0 24 24' aria-hidden='true' className='landing-node-svg'>
      {name === 'core' ? (
        <>
          <circle cx='12' cy='12' r='4.5' {...common} />
          <path d='M12 2v4.2M12 17.8V22M2 12h4.2M17.8 12H22M4.9 4.9l3 3M16.1 16.1l3 3M19.1 4.9l-3 3M7.9 16.1l-3 3' {...common} />
        </>
      ) : null}
      {name === 'spark' ? <path d='M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3zM18 16l.8 2.2L21 19l-2.2.8L18 22l-.8-2.2L15 19l2.2-.8L18 16z' {...common} /> : null}
      {name === 'list' ? <path d='M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01' {...common} /> : null}
      {name === 'branch' ? <path d='M6 5v6a4 4 0 0 0 4 4h8M6 5a2 2 0 1 0 0 4M18 15a2 2 0 1 0 0 4M14 7h4a2 2 0 0 1 2 2v6' {...common} /> : null}
      {name === 'doc' ? <path d='M7 3h7l4 4v14H7zM14 3v5h5M10 12h6M10 16h6' {...common} /> : null}
      {name === 'chat' ? <path d='M5 5h14v10H9l-4 4zM8 9h8M8 12h5' {...common} /> : null}
      {name === 'network' ? <path d='M12 12l-5-5M12 12l6-4M12 12l-4 6M12 12l6 5M5 5h4v4H5zM16 5h4v4h-4zM6 16h4v4H6zM16 15h4v4h-4z' {...common} /> : null}
      {name === 'target' ? <path d='M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10zM12 13a1 1 0 1 0 0-2 1 1 0 0 0 0 2z' {...common} /> : null}
      {name === 'map' ? <path d='M4 6l5-2 6 2 5-2v14l-5 2-6-2-5 2zM9 4v14M15 6v14' {...common} /> : null}
      {name === 'flag' ? <path d='M6 21V4h11l-2 4 2 4H6' {...common} /> : null}
      {name === 'stack' ? <path d='M12 3l8 4-8 4-8-4zM4 12l8 4 8-4M4 17l8 4 8-4' {...common} /> : null}
      {name === 'scale' ? <path d='M12 4v16M5 7h14M7 7l-3 6h6zM17 7l-3 6h6z' {...common} /> : null}
      {name === 'check' ? <path d='M20 7L10 17l-5-5M4 4h16v16H4z' {...common} /> : null}
      {name === 'clock' ? <path d='M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l4 2' {...common} /> : null}
      {name === 'canvas' ? <path d='M4 5h16v12H4zM8 21h8M12 17v4M8 13l3-3 2 2 3-4' {...common} /> : null}
      {name === 'link' ? <path d='M10 13a5 5 0 0 0 7.1 0l2-2a5 5 0 0 0-7.1-7.1l-1.1 1.1M14 11a5 5 0 0 0-7.1 0l-2 2a5 5 0 0 0 7.1 7.1l1.1-1.1' {...common} /> : null}
      {name === 'folder' ? <path d='M3 6h7l2 2h9v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z' {...common} /> : null}
      {name === 'people' ? <path d='M9 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM17 12a2.5 2.5 0 1 0 0-5M3 20a6 6 0 0 1 12 0M14 18a5 5 0 0 1 7 2' {...common} /> : null}
      {name === 'export' ? <path d='M14 3h7v7M21 3l-9 9M11 5H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-6' {...common} /> : null}
      {name === 'bolt' ? <path d='M13 2L4 14h7l-1 8 9-12h-7z' {...common} /> : null}
    </svg>
  )
}

export function LandingPage() {
  const navigate = useNavigate()
  const [activeModal, setActiveModal] = useState<'login' | 'create' | null>(null)
  const nodeById = useMemo(
    () =>
      Object.fromEntries(
        NODES.map((node) => [node.id, node]),
      ) as Record<string, LandingNode>,
    [],
  )

  const openModal = (type: 'login' | 'create') => setActiveModal(type)
  const closeModal = () => setActiveModal(null)
  const continueToHome = () => {
    setActiveModal(null)
    navigate('/home')
  }
  const getNodeRadius = (node: LandingNode) => (node.kind === 'center' ? 8.2 : 5.1)
  const getAnchorPoint = (node: LandingNode, side: LinkSide) => {
    const radius = getNodeRadius(node)
    if (side === 'top') return { x: node.x, y: node.y - radius }
    if (side === 'right') return { x: node.x + radius, y: node.y }
    if (side === 'bottom') return { x: node.x, y: node.y + radius }
    return { x: node.x - radius, y: node.y }
  }

  const getConnectorPath = (from: LandingNode, to: LandingNode, link: NodeLink) => {
    const start = getAnchorPoint(from, link.fromSide)
    const end = getAnchorPoint(to, link.toSide)
    const startX = start.x
    const startY = start.y
    const endX = end.x
    const endY = end.y
    const midX = (startX + endX) / 2
    const midY = (startY + endY) / 2
    const bend = from.kind === 'center' || to.kind === 'center' ? 0 : 7
    const controlX = midX + (startY - endY) * 0.06
    const controlY = midY + (endX - startX) * 0.04 - bend

    return `M ${startX} ${startY} Q ${controlX} ${controlY} ${endX} ${endY}`
  }

  const getLabelSize = (label: string) => {
    const len = label.length
    if (len <= 12) return 'clamp(10.3px, 0.86vw, 13.4px)'
    if (len <= 16) return 'clamp(9.9px, 0.82vw, 12.8px)'
    if (len <= 20) return 'clamp(9.4px, 0.78vw, 12.1px)'
    return 'clamp(8.9px, 0.74vw, 11.4px)'
  }

  return (
    <main className='landing-v2'>
      <nav className='landing-nav' aria-label='Landing page navigation'>
        <div className='landing-brand'>
          <span className='landing-brand-mark'>C</span>
          <span>Curio</span>
        </div>
        <div className='landing-nav-actions'>
          <button type='button' className='ghost' onClick={() => openModal('login')}>
            Login
          </button>
          <button type='button' onClick={() => openModal('create')}>
            Create account
          </button>
        </div>
      </nav>

      <section className='landing-hero-stage'>
        <div className='landing-copy-panel'>
          <p className='eyebrow'>AI mind maps for deep work</p>
          <h1>Think in maps. Research faster. Plan with clarity.</h1>
          <p className='landing-v2-subtitle'>
            Curio turns loose ideas into connected knowledge systems: research branches,
            planning paths, shared context, and export-ready structure in one living canvas.
          </p>

          <div className='landing-proof-row' aria-label='Curio highlights'>
            <span>Research mode</span>
            <span>Plan mode</span>
            <span>Collaborative-ready</span>
          </div>

          <div className='landing-mini-card'>
            <span className='mini-card-kicker'>Workflow</span>
            <strong>Prompt to Map to Branch to Decide</strong>
            <p>Move from question to structure without losing the shape of your thinking.</p>
          </div>
        </div>

        <section className='landing-map-wrap' aria-label='Curio feature mind map'>
          <div className='landing-map-orb orb-a' />
          <div className='landing-map-orb orb-b' />
          <div className='landing-map-orb orb-c' />
          <div className='landing-map-ring ring-a' />
          <div className='landing-map-ring ring-b' />
          <div className='landing-map-ring ring-c' />
          <div className='landing-map-ring ring-d' />
          <div className='landing-map-ring ring-e' />
          <div className='landing-map-ring ring-f' />
          <svg className='landing-map-links' viewBox='0 0 100 100' preserveAspectRatio='none'>
            {LINKS.map((link) => {
              const from = nodeById[link.from]
              const to = nodeById[link.to]
              return (
                <path
                  key={`${link.from}-${link.to}`}
                  d={getConnectorPath(from, to, link)}
                  className={`landing-link ${link.kind}`}
                />
              )
            })}
          </svg>

          {NODES.map((node, index) => {
            const nodeStyle = {
              left: `${node.x}%`,
              top: `${node.y}%`,
              '--node-a': node.colorA,
              '--node-b': node.colorB,
              '--node-ink': node.ink,
              '--node-delay': `${index * 48}ms`,
              '--label-size': getLabelSize(node.label),
            } as CSSProperties

            return (
              <article
                key={node.id}
                className={`landing-node ${node.kind}`}
                style={nodeStyle}
              >
                {node.kind !== 'center' ? (
                  <span className='landing-node-icon'>
                    <NodeIcon name={node.icon} />
                  </span>
                ) : null}
                <span className='landing-node-label'>{node.label}</span>
              </article>
            )
          })}
        </section>
      </section>

      {activeModal ? (
        <div className='modal-overlay' role='dialog' aria-modal='true'>
          <div className='modal-card auth-modal-card'>
            <h4>{activeModal === 'login' ? 'Welcome back' : 'Create your Curio account'}</h4>
            <p>
              {activeModal === 'login'
                ? 'Authentication wiring comes next. For now, continue into the product.'
                : 'Account setup is coming soon. You can still enter the app right now.'}
            </p>
            <input type='email' placeholder='Email' readOnly value='' />
            <input type='password' placeholder='Password' readOnly value='' />
            <div className='modal-actions'>
              <button type='button' className='secondary' onClick={closeModal}>
                Cancel
              </button>
              <button type='button' onClick={continueToHome}>
                Continue to home
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  )
}
