import { lazy, Suspense, useEffect } from 'react'
import { Route, Routes, useLocation, useNavigate, useParams } from 'react-router'
import { rememberProjectAt, useLocal } from '../../core/prefs'
import { useProjects, useSpaceView } from '../../core/space'
import { TabsProvider, useTabRoute } from '../../core/tabs'
import type { SessionOpening } from '../../features/session/session-tab'
import { parseRootKey } from '../../model/files/worktrees'
import { locate } from '../../model/projects'
import { projectsSettled } from '../../model/space'
import { sessionTabId } from '../../model/tabs'
import { projectHref } from '../../utils/hrefs'
import { addressTo } from './address'
import { Frame } from './frame'
import { isTab, sessionTabHref } from './tab-kinds'

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

/** Outside any project: the frame with none open, until where it opens is known. */
function Outside() {
  const home = useHome()
  const navigate = useNavigate()
  useEffect(() => {
    if (home) navigate(home, { replace: true })
  }, [home, navigate])
  return <Frame inProject={false} />
}

/** A session's address, as a notification has it (`/s/`, its chat, or `/t/`, its terminal): to its
 * tab in its project once the pane is found, else, once the projects settle, where the frame opens. */
function SessionRedirect({ terminal }: { terminal: boolean }) {
  const params = useParams()
  const mid = params.mid ?? ''
  const paneId = params['*'] ?? ''
  const view = useSpaceView()
  const found = locate(useProjects(), mid, paneId)
  const key = found?.project.key
  const settled = projectsSettled(view)
  const navigate = useNavigate()
  useEffect(() => {
    const state: SessionOpening | undefined = terminal
      ? { tab: sessionTabId(mid, paneId), view: 'terminal' }
      : undefined
    if (key) navigate(sessionTabHref(key, mid, paneId), { replace: true, state })
    else if (settled) navigate('/', { replace: true })
  }, [key, settled, mid, paneId, terminal, navigate])
  return <Frame inProject={false} />
}

/** Leads the address where it should be, and remembers where it stands once it is. */
function KeepAddress({ project }: { project: string }) {
  const location = useLocation()
  const { pathname, search } = location
  const navigate = useNavigate()
  const { active, shown } = useTabRoute()
  const to = addressTo(location, active, shown)
  useEffect(() => {
    if (to) navigate(to, { replace: true })
  }, [to, navigate])
  useEffect(() => {
    if (!to) rememberProjectAt(project, `${pathname}${search}`)
  }, [project, pathname, search, to])
  return null
}

/** The frame in a project, with its tabs. */
function ProjectFrame() {
  const project = parseRootKey(useParams().key ?? '').project
  return (
    <TabsProvider isTab={isTab} scope={project}>
      <KeepAddress project={project} />
      <Frame inProject />
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
      <Route path="p/:key/*" element={<ProjectFrame />} />
      <Route path="s/:mid/*" element={<SessionRedirect terminal={false} />} />
      <Route path="t/:mid/*" element={<SessionRedirect terminal />} />
      {/* Anything else goes where the frame opens. */}
      <Route path="*" element={<Outside />} />
    </Routes>
  )
}
