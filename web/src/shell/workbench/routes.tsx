import { lazy, Suspense, useEffect } from 'react'
import { Route, Routes, useLocation, useNavigate } from 'react-router'
import { rememberProjectAt, useLocal } from '../../core/prefs'
import { useProjects, useSpaceView } from '../../core/space'
import { TabsProvider, useTabRoute } from '../../core/tabs'
import { isTab } from '../../features/tabs/kinds'
import { projectsSettled } from '../../model/space'
import { projectHref } from '../../utils/hrefs'
import { addressTo, projectOf } from './address'
import { Frame } from './frame'

// A page on its own in the window, opened in a tab of its own; it loads only there.
const PageView = lazy(() => import('../../features/files/page-view').then(m => ({ default: m.PageView })))

/** Where the workbench opens: where it was last left, at once, else the first project, once they
 * are known. */
function useHome() {
  const view = useSpaceView()
  const projects = useProjects()
  const { lastProject, projectAt } = useLocal()
  const left = lastProject === null ? undefined : projectAt[lastProject]
  if (left || !projectsSettled(view)) return left
  const first = projects.find(p => p.configured && p.path)
  return first && projectHref(first.key)
}

/** Leads the address where it should be, and remembers where it stands once it is. */
function KeepAddress() {
  const location = useLocation()
  const { pathname, search } = location
  const navigate = useNavigate()
  const { active, recent } = useTabRoute()
  const to = addressTo(location, { home: useHome(), active, recent })
  useEffect(() => {
    if (to) navigate(to, { replace: true })
  }, [to, navigate])
  useEffect(() => {
    const project = projectOf(pathname)
    if (project && !to) rememberProjectAt(project, `${pathname}${search}`)
  }, [pathname, search, to])
  return null
}

/** The frame, with the tabs of the project the address is in; with none, an empty set of its own. */
function ProjectFrame() {
  const scope = projectOf(useLocation().pathname) ?? ''
  return (
    <TabsProvider isTab={isTab} scope={scope}>
      <KeepAddress />
      <Frame />
    </TabsProvider>
  )
}

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
      <Route path="*" element={<ProjectFrame />} />
    </Routes>
  )
}
