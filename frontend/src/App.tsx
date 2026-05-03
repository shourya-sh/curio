import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { useAuth } from './lib/AuthContext'
import { DashboardHomePage } from './pages/DashboardHomePage'
import { LandingPage } from './pages/LandingPage'
import { LibraryPage } from './pages/LibraryPage'
import { LoginPage } from './pages/LoginPage'
import { SignupPage } from './pages/SignupPage'
import { SettingsPage } from './pages/SettingsPage'
import { WorkspaceCanvasPage } from './pages/WorkspaceCanvasPage'
import type { ReactNode } from 'react'

function ProtectedRoute({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth()
  if (loading) return null
  if (!user) return <Navigate to='/login' replace />
  return <>{children}</>
}

function PublicOnlyRoute({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth()
  if (loading) return null
  if (user) return <Navigate to='/home' replace />
  return <>{children}</>
}

/** Remount routes when the path changes so navigation always swaps the active page (avoids stuck outlet after heavy async UI like AI streaming). */
function RoutedViews() {
  const { pathname } = useLocation()
  return (
    <Routes key={pathname}>
      <Route path='/' element={<LandingPage />} />
      <Route path='/login' element={<PublicOnlyRoute><LoginPage /></PublicOnlyRoute>} />
      <Route path='/signup' element={<PublicOnlyRoute><SignupPage /></PublicOnlyRoute>} />
      <Route path='/home' element={<ProtectedRoute><DashboardHomePage /></ProtectedRoute>} />
      <Route path='/library' element={<ProtectedRoute><LibraryPage /></ProtectedRoute>} />
      <Route path='/workspace/:workspaceSlug' element={<ProtectedRoute><WorkspaceCanvasPage /></ProtectedRoute>} />
      <Route path='/settings' element={<ProtectedRoute><SettingsPage /></ProtectedRoute>} />
      <Route path='*' element={<Navigate to='/' replace />} />
    </Routes>
  )
}

function App() {
  return (
    <BrowserRouter unstable_useTransitions={false}>
      <RoutedViews />
    </BrowserRouter>
  )
}

export default App
