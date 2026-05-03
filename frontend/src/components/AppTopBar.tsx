import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../lib/AuthContext'

type TopNavItem = 'workspace' | 'home' | 'library' | 'settings'

interface AppTopBarProps {
  activeItem: TopNavItem
  workspaceSessionId?: number | string | null
}

export function AppTopBar({ activeItem, workspaceSessionId }: AppTopBarProps) {
  const { user, signOut } = useAuth()
  const navigate = useNavigate()
  const [showAccountMenu, setShowAccountMenu] = useState(false)

  const workspaceHref = workspaceSessionId ? `/workspace/${workspaceSessionId}` : '/'
  const homeHref = user ? '/home' : '/'

  const userInitial = user?.email ? user.email[0].toUpperCase() : '?'

  const handleSignOut = async () => {
    setShowAccountMenu(false)
    await signOut()
    navigate('/')
  }

  return (
    <header className='top-nav'>
      <div className='brand-group'>
        <Link to={homeHref} className='brand brand-link'>
          Curio
        </Link>
      </div>

      <nav className='main-nav' aria-label='Main navigation'>
        <Link to={workspaceHref} className={`nav-link ${activeItem === 'workspace' ? 'selected' : ''}`}>
          Workspace
        </Link>
        <Link to={homeHref} className={`nav-link ${activeItem === 'home' ? 'selected' : ''}`}>
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
          <button
            type='button'
            className={`icon-btn ${activeItem === 'settings' ? 'icon-btn-active' : ''}`}
            aria-label='Settings'
            onClick={() => navigate('/settings')}
          >
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

        <div className='nav-action-item' style={{ position: 'relative' }}>
          <button
            type='button'
            className='avatar-btn'
            aria-label='Account'
            onClick={() => setShowAccountMenu((prev) => !prev)}
          >
            {userInitial}
          </button>
          <span className='nav-action-label'>Account</span>

          {showAccountMenu && (
            <>
              <div className='account-menu-backdrop' onClick={() => setShowAccountMenu(false)} />
              <div className='account-menu'>
                <div className='account-menu-email'>{user?.email}</div>
                <button type='button' className='account-menu-item' onClick={() => { setShowAccountMenu(false); navigate('/settings') }}>
                  Settings
                </button>
                <button type='button' className='account-menu-item account-menu-signout' onClick={handleSignOut}>
                  Sign Out
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </header>
  )
}
