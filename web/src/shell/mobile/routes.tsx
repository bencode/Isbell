// The same pages at the same addresses as on a computer, in the phone's frame.

import { lazy, Suspense } from 'react'
import { Navigate, Route, Routes } from 'react-router'
import { AllAgents } from '../../features/board/all-page'
import { ProjectView } from '../../features/board/project-page'
import { SessionPage } from '../../features/pane/session-page'
import { LazyTerminal, Loading } from '../common'
import { MobileBoard, MobileFrame } from './frame'
import { MobilePane } from './pane'

// A project's files bring the same libraries as a pane's.
const PhoneFiles = lazy(() =>
  import('../../features/files/phone-files').then(m => ({ default: m.PhoneFiles })),
)

export function MobileRoutes() {
  return (
    <Routes>
      <Route element={<MobileFrame />}>
        <Route element={<MobileBoard />}>
          <Route index element={<AllAgents phone />} />
          <Route path="p/:key" element={<ProjectView phone />} />
        </Route>
        <Route path="s/:mid/:pane" element={<SessionPage layout={MobilePane} />} />
        {/* Where a card on a project's board opens its session. */}
        <Route path="p/:key/s/:mid/:pane" element={<SessionPage layout={MobilePane} />} />
        <Route path="t/:mid/:pane" element={<LazyTerminal layout={MobilePane} />} />
        <Route
          path="p/:key/files/*"
          element={
            <Suspense fallback={<Loading />}>
              <PhoneFiles />
            </Suspense>
          }
        />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
