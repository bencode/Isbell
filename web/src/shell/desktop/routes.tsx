import { lazy, Suspense } from 'react'
import { Navigate, Route, Routes } from 'react-router'
import { AllAgents } from '../../features/board/all-page'
import { ProjectView } from '../../features/board/project-page'
import { SessionPage } from '../../features/pane/session-page'
import { LazyFiles, LazyTerminal } from '../common'
import { AppFrame, BoardMain } from './frame'
import { DesktopPane } from './pane'

// A page on its own in the window, opened in a tab of its own; it loads only there.
const PageView = lazy(() => import('../../features/files/page-view').then(m => ({ default: m.PageView })))

export function DesktopRoutes() {
  return (
    <Routes>
      <Route element={<AppFrame />}>
        <Route element={<BoardMain />}>
          <Route index element={<AllAgents />} />
          <Route path="p/:key" element={<ProjectView />} />
        </Route>
        <Route path="s/:mid/:pane" element={<SessionPage layout={DesktopPane} />} />
        <Route path="t/:mid/:pane" element={<LazyTerminal layout={DesktopPane} />} />
        <Route path="f/:mid/:pane/*" element={<LazyFiles layout={DesktopPane} />} />
      </Route>
      {/* Outside the frame: the page alone. */}
      <Route
        path="v/:mid/:pane/*"
        element={
          <Suspense>
            <PageView />
          </Suspense>
        }
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
