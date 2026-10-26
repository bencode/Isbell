// The same pages at the same addresses as on a computer, in the phone's frame.

import { Navigate, Route, Routes } from 'react-router'
import { AllAgents } from '../../features/board/all-page'
import { ProjectView } from '../../features/board/project-page'
import { SessionPage } from '../../features/pane/session-page'
import { LazyTerminal } from '../common'
import { MobileBoard, MobileFrame } from './frame'
import { MobilePane } from './pane'

export function MobileRoutes() {
  return (
    <Routes>
      <Route element={<MobileFrame />}>
        <Route element={<MobileBoard />}>
          <Route index element={<AllAgents stacked />} />
          <Route path="p/:key" element={<ProjectView stacked />} />
        </Route>
        <Route path="s/:mid/:pane" element={<SessionPage layout={MobilePane} />} />
        <Route path="t/:mid/:pane" element={<LazyTerminal layout={MobilePane} />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
