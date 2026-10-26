import { Navigate, Route, Routes } from 'react-router'
import { AllProjects } from '../../features/board/all-page'
import { ProjectView } from '../../features/board/project-page'
import { SessionPage } from '../../features/pane/session-page'
import { LazyTerminal } from '../common'
import { AppFrame, BoardMain } from './frame'

export function DesktopRoutes() {
  return (
    <Routes>
      <Route element={<AppFrame />}>
        <Route element={<BoardMain />}>
          <Route index element={<AllProjects />} />
          <Route path="p/:key" element={<ProjectView />} />
        </Route>
        <Route path="s/:mid/:pane" element={<SessionPage />} />
        <Route path="t/:mid/:pane" element={<LazyTerminal />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
