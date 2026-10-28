// The frame around every page on a computer: the sidebar (or its rail), a strip while the relay
// reconnects, the bar atop the page, and the overlays (new, settings) that any part of it can open.
// The file tabs show in place of the page, which stays as it was beneath them: going to any page
// shows the page again.

import { Activity, lazy, Suspense, useEffect, useRef, useState } from 'react'
import { Outlet, useLocation, useMatch, useNavigate, useParams } from 'react-router'
import { useLocal } from '../../core/prefs'
import { useProjects, useSpaceView } from '../../core/space'
import { FileOpener, type OpenPath, openTab, showTab, useTabs } from '../../core/tabs'
import { tabKey } from '../../model/tabs'
import { boardHref, projectFilesHref, projectHref } from '../../utils/hrefs'
import { useShortcuts } from '../../utils/shortcuts'
import { hereOf, Loading, type Overlay, Overlays, ReconnectBanner } from '../common'
import { Rail } from './rail'
import { Sidebar } from './sidebar'
import { TopBar } from './top-bar'

// A file tab reads with the same libraries as a project's files.
const FileTabPane = lazy(() => import('../../features/tabs/file-tab').then(m => ({ default: m.FileTabPane })))

export function AppFrame() {
  const view = useSpaceView()
  const projects = useProjects()
  const params = useParams()
  // A session open beside every agent's board is on that board, not in its project.
  const allPeek = useMatch('/s/:mid/:pane')
  const here = allPeek ? { project: undefined, pane: undefined } : hereOf(projects, params)
  const projectPeek = useMatch('/p/:key/s/:mid/:pane')
  // A session open beside a board, every agent's or a project's.
  const peek = Boolean(allPeek || projectPeek)
  const boards = [useMatch('/'), useMatch('/p/:key')]
  const rail = useLocal().layout.rail
  const navigate = useNavigate()
  const [overlay, setOverlay] = useState<Overlay | null>(null)
  // Single keys belong to the boards; on a session or a terminal they are typing.
  const board = peek || boards.some(Boolean)
  const tabs = useTabs()

  // Going to a page, even the one beneath, shows it.
  const at = useLocation().key
  const shownAt = useRef(at)
  useEffect(() => {
    if (shownAt.current === at) return
    shownAt.current = at
    showTab(null)
  }, [at])
  const open: OpenPath = (project, rel, dir) =>
    dir ? navigate(projectFilesHref(project.key, `${rel}/`)) : openTab(project.key, rel)

  const step = (by: number) => {
    if (!projects.length) return
    const i = here.project ? projects.indexOf(here.project) : by > 0 ? -1 : 0
    const next = projects[(i + by + projects.length) % projects.length]
    if (next) navigate(projectHref(next.key))
  }
  const numbers = Object.fromEntries(
    projects.slice(0, 9).map((p, i) => [String(i + 1), () => navigate(projectHref(p.key))]),
  )
  useShortcuts(
    {
      ...numbers,
      n: () => setOverlay('session'),
      a: () => setOverlay('newDir'),
      ',': () => setOverlay('settings'),
      '0': () => navigate('/'),
      esc: () => (tabs.active === null ? navigate(peek ? boardHref(params.key) : '/') : showTab(null)),
      ']': () => step(1),
      '[': () => step(-1),
    },
    overlay === null && (board || tabs.active !== null),
  )

  const side = {
    projects,
    machines: view.machines,
    status: view.status,
    here,
    onSettings: () => setOverlay('settings'),
  }
  return (
    <>
      <div className="flex h-full">
        {rail ? <Rail {...side} /> : <Sidebar {...side} onNewDir={() => setOverlay('newDir')} />}
        <FileOpener value={open}>
          <div className="flex min-w-0 flex-1 flex-col">
            <ReconnectBanner />
            <TopBar
              project={here.project}
              tabShown={tabs.active !== null}
              onNew={() => setOverlay('session')}
            />
            <div className="min-h-0 flex-1">
              <Activity mode={tabs.active === null ? 'visible' : 'hidden'}>
                <Outlet />
              </Activity>
              {tabs.open.map(tab => {
                const key = tabKey(tab.project, tab.rel)
                return (
                  <Activity key={key} mode={tabs.active === key ? 'visible' : 'hidden'}>
                    <Suspense fallback={<Loading />}>
                      <FileTabPane tab={tab} />
                    </Suspense>
                  </Activity>
                )
              })}
            </div>
          </div>
        </FileOpener>
      </div>
      <Overlays overlay={overlay} setOverlay={setOverlay} focusedKey={here.project?.key} />
    </>
  )
}
