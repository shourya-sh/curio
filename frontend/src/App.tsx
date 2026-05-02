import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { DashboardHomePage } from './pages/DashboardHomePage'
import { LandingPage } from './pages/LandingPage'
import { LibraryPage } from './pages/LibraryPage'
import { WorkspaceCanvasPage } from './pages/WorkspaceCanvasPage'

/** Remount routes when the path changes so navigation always swaps the active page (avoids stuck outlet after heavy async UI like AI streaming). */
function RoutedViews() {
  const { pathname } = useLocation()
  return (
    <Routes key={pathname}>
      <Route path='/' element={<LandingPage />} />
      <Route path='/home' element={<DashboardHomePage />} />
      <Route path='/library' element={<LibraryPage />} />
      <Route path='/workspace/:workspaceSlug' element={<WorkspaceCanvasPage />} />
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
