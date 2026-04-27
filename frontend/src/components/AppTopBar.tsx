import { Link } from 'react-router-dom'

type TopNavItem = 'workspace' | 'home' | 'library'

interface AppTopBarProps {
  activeItem: TopNavItem
  workspaceSessionId?: number | string | null
}

export function AppTopBar({ activeItem, workspaceSessionId }: AppTopBarProps) {
  const workspaceHref = workspaceSessionId ? `/workspace/${workspaceSessionId}` : '/'

  return (
    <header className='top-nav'>
      <div className='brand-group'>
        <Link to='/' className='brand brand-link'>
          Curio
        </Link>
      </div>

      <nav className='main-nav' aria-label='Main navigation'>
        <Link to={workspaceHref} className={`nav-link ${activeItem === 'workspace' ? 'selected' : ''}`}>
          Workspace
        </Link>
        <Link to='/' className={`nav-link ${activeItem === 'home' ? 'selected' : ''}`}>
          Home
        </Link>
        <Link to='/library' className={`nav-link ${activeItem === 'library' ? 'selected' : ''}`}>
          Library
        </Link>
      </nav>

      <div className='nav-actions'>
        <div className='nav-action-item'>
          <button type='button' className='icon-btn' aria-label='Notifications'>
            <svg viewBox='0 0 24 24' className='icon-svg' aria-hidden='true'>
              <path
                d='M12 4a5 5 0 0 0-5 5v3.2c0 .9-.3 1.8-.9 2.5L5 16h14l-1.1-1.3c-.6-.7-.9-1.6-.9-2.5V9a5 5 0 0 0-5-5Z'
                fill='none'
                stroke='currentColor'
                strokeWidth='1.8'
                strokeLinecap='round'
                strokeLinejoin='round'
              />
              <path d='M10 18a2 2 0 0 0 4 0' fill='none' stroke='currentColor' strokeWidth='1.8' strokeLinecap='round' />
            </svg>
          </button>
          <span className='nav-action-label'>Notifications</span>
        </div>

        <div className='nav-action-item'>
          <button type='button' className='icon-btn' aria-label='Settings'>
            <svg viewBox='0 0 24 24' className='icon-svg' aria-hidden='true'>
              <path
                d='M10.2 3.6h3.6l.4 2.1c.5.2 1 .4 1.5.7l1.9-1 2.5 2.5-1 1.9c.3.5.5 1 .7 1.5l2.1.4v3.6l-2.1.4c-.2.5-.4 1-.7 1.5l1 1.9-2.5 2.5-1.9-1c-.5.3-1 .5-1.5.7l-.4 2.1h-3.6l-.4-2.1c-.5-.2-1-.4-1.5-.7l-1.9 1-2.5-2.5 1-1.9a7 7 0 0 1-.7-1.5l-2.1-.4v-3.6l2.1-.4c.2-.5.4-1 .7-1.5l-1-1.9 2.5-2.5 1.9 1c.5-.3 1-.5 1.5-.7l.4-2.1Z'
                fill='none'
                stroke='currentColor'
                strokeWidth='1.8'
                strokeLinecap='round'
                strokeLinejoin='round'
              />
              <path
                d='M12 14.8a2.8 2.8 0 1 0 0-5.6 2.8 2.8 0 0 0 0 5.6Z'
                fill='none'
                stroke='currentColor'
                strokeWidth='1.8'
                strokeLinecap='round'
                strokeLinejoin='round'
              />
            </svg>
          </button>
          <span className='nav-action-label'>Settings</span>
        </div>

        <div className='nav-action-item'>
          <button type='button' className='avatar-btn' aria-label='Account'>
            S
          </button>
          <span className='nav-action-label'>Account</span>
        </div>
      </div>
    </header>
  )
}
