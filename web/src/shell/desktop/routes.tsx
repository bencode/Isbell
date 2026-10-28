import { lazy, Suspense } from 'react'
import { Route, Routes } from 'react-router'
import { TabsProvider } from '../../core/tabs'
import { isTab } from '../../features/tabs/kinds'
import { AppFrame } from './frame'

// A page on its own in the window, opened in a tab of its own; it loads only there.
const PageView = lazy(() => import('../../features/files/page-view').then(m => ({ default: m.PageView })))

export function DesktopRoutes() {
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
      {/* The frame picks the page (see pages.tsx) and the tab shown over it from the address. */}
      <Route
        path="*"
        element={
          <TabsProvider isTab={isTab}>
            <AppFrame />
          </TabsProvider>
        }
      />
    </Routes>
  )
}
