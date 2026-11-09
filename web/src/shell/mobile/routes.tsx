// A phone's pages. A session lives at the address its push notifications have, and a project's files
// at the address they have everywhere, over the page they were opened from.

import { Activity, lazy, Suspense, useState } from 'react'
import { matchPath, Navigate, Route, Routes, useLocation } from 'react-router'
import { Loading } from '../loading'
import { PhoneFiles } from './files/files'
import { Home } from './home'
import { PhoneNewSession } from './new-session'

// With the rendering of messages and its highlighter, which the first page does not need.
const PhoneSession = lazy(() => import('./session').then(m => ({ default: m.PhoneSession })))
const PhoneEnded = lazy(() => import('./sessions/ended').then(m => ({ default: m.PhoneEnded })))
// Also apart: a build leaves out the styles of what this file imports directly.
const PhoneSessions = lazy(() => import('./sessions/sessions').then(m => ({ default: m.PhoneSessions })))

const FILES = '/p/:key/files/*'

export function MobileRoutes() {
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
