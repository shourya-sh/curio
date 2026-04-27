import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { DashboardHomePage } from './pages/DashboardHomePage'
import { LandingPage } from './pages/LandingPage'
import { WorkspaceCanvasPage } from './pages/WorkspaceCanvasPage'

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path='/' element={<DashboardHomePage />} />
        <Route path='/landing' element={<LandingPage />} />
        <Route path='/workspace/:sessionId' element={<WorkspaceCanvasPage />} />
        <Route path='*' element={<Navigate to='/' replace />} />
      </Routes>
    </BrowserRouter>
  )
}

export default App
