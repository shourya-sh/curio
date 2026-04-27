import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { DashboardHomePage } from './pages/DashboardHomePage'
import { LandingPage } from './pages/LandingPage'
import { LibraryPage } from './pages/LibraryPage'
import { WorkspaceCanvasPage } from './pages/WorkspaceCanvasPage'

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path='/' element={<LandingPage />} />
        <Route path='/home' element={<DashboardHomePage />} />
        <Route path='/library' element={<LibraryPage />} />
        <Route path='/workspace/:sessionId' element={<WorkspaceCanvasPage />} />
        <Route path='*' element={<Navigate to='/' replace />} />
      </Routes>
    </BrowserRouter>
  )
}

export default App
