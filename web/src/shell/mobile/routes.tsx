// A phone's pages. A session lives at the address its push notifications have, a task and a goal by
// their machine and number, and a project's files at the address they have everywhere, over the page
// they were opened from.

import { Activity, lazy, Suspense, useState } from 'react'
import { matchPath, Navigate, Route, Routes, useLocation } from 'react-router'
import { useBooksPull } from '../../core/books'
import { Loading } from '../loading'
import { PhoneFiles } from './files/files'
import { PhoneFilesTab } from './files/files-tab'
import { Home } from './home'
import { PhoneInbox } from './inbox/inbox'
import { PhoneNewSession } from './new-session'
import { PhoneGoal } from './tasks/goal-page'
import { PhoneNewTask } from './tasks/new-task'
import { PhoneTask } from './tasks/task-page'
import { PhoneTasks } from './tasks/tasks-tab'

// With the rendering of messages and its highlighter, which the first page does not need.
const PhoneSession = lazy(() => import('./session').then(m => ({ default: m.PhoneSession })))
const PhoneEnded = lazy(() => import('./sessions/ended').then(m => ({ default: m.PhoneEnded })))
// Also apart: a build leaves out the styles of what this file imports directly.
const PhoneSessions = lazy(() => import('./sessions/sessions').then(m => ({ default: m.PhoneSessions })))

const FILES = '/p/:key/files/*'

export function MobileRoutes() {
  // The roles agents took, for the Agents tab to name them by, the goals for Tasks, and the messages.
  useBooksPull()
  const location = useLocation()
  const files = !!matchPath(FILES, location.pathname)
  // The page files were opened from stays behind them as it was left: its place, a reply half written.
  const [behind, setBehind] = useState(files ? null : location)
  if (!files && behind !== location) setBehind(location)
  return (
    <>
      {behind ? (
        <Activity mode={files ? 'hidden' : 'visible'}>
          <Routes location={behind}>
            <Route index element={<Home />} />
            <Route path="tasks" element={<PhoneTasks />} />
            <Route path="tasks/new" element={<PhoneNewTask />} />
            <Route path="tasks/:mid/:id" element={<PhoneTask />} />
            <Route path="goals/:mid/:id" element={<PhoneGoal />} />
            <Route path="inbox" element={<PhoneInbox />} />
            <Route path="files" element={<PhoneFilesTab />} />
            <Route
              path="s/:mid/*"
              element={
                <Suspense fallback={<Loading />}>
                  <PhoneSession />
                </Suspense>
              }
            />
            <Route
              path="sessions"
              element={
                <Suspense fallback={<Loading />}>
                  <PhoneSessions />
                </Suspense>
              }
            />
            <Route
              path="p/:key/sessions/:agent/:id"
              element={
                <Suspense fallback={<Loading />}>
                  <PhoneEnded />
                </Suspense>
              }
            />
            <Route path="new" element={<PhoneNewSession />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Activity>
      ) : null}
      {files ? (
        <Routes>
          <Route path={FILES} element={<PhoneFiles />} />
        </Routes>
      ) : null}
    </>
  )
}
