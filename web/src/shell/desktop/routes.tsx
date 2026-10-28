import { lazy, Suspense } from 'react'
import { Navigate, Route, Routes } from 'react-router'
import { AgentsPage } from '../../features/board/agents-page'
import { SessionPage } from '../../features/pane/session-page'
import { LazyFiles, LazyTerminal, Loading } from '../common'
import { AppFrame } from './frame'
import { DesktopPane } from './pane'

// A page on its own in the window, opened in a tab of its own; it loads only there.
const PageView = lazy(() => import('../../features/files/page-view').then(m => ({ default: m.PageView })))
// A project's files bring the same libraries as a pane's.
const ProjectFiles = lazy(() =>
  import('../../features/files/project-files').then(m => ({ default: m.ProjectFiles })),
)

export function DesktopRoutes() {
  return (
    <Routes>
      <Route element={<AppFrame />}>
        <Route index element={<AgentsPage />} />
        <Route path="p/:key" element={<AgentsPage />} />
        <Route path="s/:mid/:pane" element={<SessionPage layout={DesktopPane} />} />
        <Route path="t/:mid/:pane" element={<LazyTerminal layout={DesktopPane} />} />
        <Route path="f/:mid/:pane/*" element={<LazyFiles layout={DesktopPane} />} />
        <Route
          path="p/:key/files/*"
          element={
            <Suspense fallback={<Loading />}>
              <ProjectFiles />
            </Suspense>
          }
        />
      </Route>
      {/* Outside the frame: the page alone. */}
      <Route
        path="v/:key/*"
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
