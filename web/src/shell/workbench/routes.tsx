import { lazy, Suspense } from 'react'
import { Route, Routes } from 'react-router'
import { Frame } from './frame'

// A page on its own in the window, opened in a tab of its own; it loads only there.
const PageView = lazy(() => import('../../features/files/page-view').then(m => ({ default: m.PageView })))

export function WorkbenchRoutes() {
  return (
    <Routes>
      {/* Outside the frame: the page alone. */}
      <Route
        path="v/:key/*"
        element={
          <Suspense>
            <PageView />
          </Suspense>
        }
      />
      <Route path="*" element={<Frame />} />
    </Routes>
  )
}
