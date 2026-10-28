// The pages on a computer, each the first tab of the window. They are given their location rather
// than reading the address, which also names the tab shown over them.

import { lazy, Suspense } from 'react'
import { type Location, Navigate, Route, Routes } from 'react-router'
import { AgentsPage } from '../../features/board/agents-page'
import { LazyTerminal, Loading } from '../common'
import { DesktopPane } from './pane'

// A project's files bring the same libraries as a pane's.
const ProjectFiles = lazy(() =>
  import('../../features/files/project-files').then(m => ({ default: m.ProjectFiles })),
)

export function PageRoutes({ location }: { location: Location }) {
  return (
    <Routes location={location}>
      {/* One page, so opening a session beside the board and closing it keeps the board as it is. */}
      <Route index element={<AgentsPage />} />
      <Route path="s/:mid/:pane" element={<AgentsPage />} />
      <Route path="p/:key" element={<AgentsPage />} />
      <Route path="p/:key/s/:mid/:pane" element={<AgentsPage />} />
      <Route path="t/:mid/:pane" element={<LazyTerminal layout={DesktopPane} />} />
      <Route
        path="p/:key/files/*"
        element={
          <Suspense fallback={<Loading />}>
            <ProjectFiles />
          </Suspense>
        }
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
