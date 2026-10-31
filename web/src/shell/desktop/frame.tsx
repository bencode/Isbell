// The frame around every page on a computer: the sidebar (or its rail), a strip while the relay
// reconnects, the bar atop the page, and the overlays (new, settings, the palette) that any part of
// it can open. A tab named in the address (`?tab=`) shows in place of the page, which stays as it was
// beneath it.

import { Activity, Suspense, useState } from 'react'
import { useMatch, useNavigate } from 'react-router'
import { useLocal } from '../../core/prefs'
import { useProjects, useSpaceView } from '../../core/space'
import { FileOpener, type OpenPath, usePageLocation, useTabActions, useTabRoute } from '../../core/tabs'
import { fileTabId, TabPane } from '../../features/tabs/kinds'
import { boardHref, projectFilesHref } from '../../utils/hrefs'
import { useCommandKey, useShortcuts } from '../../utils/shortcuts'
import { hereOf, Loading, type Overlay, Overlays, ReconnectBanner } from '../common'
import { CommandPalette } from './command-palette'
import { PageRoutes } from './pages'
import { Rail } from './rail'
import { Sidebar } from './sidebar'
import { TopBar } from './top-bar'

export function AppFrame() {
  const view = useSpaceView()
  const projects = useProjects()
  // The path is always the page's: a tab is in the query.
  const params = { ...useMatch('/p/:key/*')?.params }
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
  // Esc belongs to the boards and the tabs; in a terminal, which has the focus, the agent's (see
  // `useShortcuts`).
  const board = peek || boards.some(Boolean)
  const { open, active } = useTabRoute()
  const page = usePageLocation()
  const { href } = useTabActions()
  const openPath: OpenPath = (key, rel, dir) =>
    navigate(dir ? projectFilesHref(key, `${rel}/`) : href(fileTabId(key, rel)))

  // Esc closes the uppermost of what is open over the board: a tab, then a session beside it.
  useShortcuts(
    {
      esc: () => {
        if (active !== null) navigate(href(null))
        else if (peek) navigate(boardHref(params.key))
      },
    },
    overlay === null && (board || active !== null),
  )
  const [palette, setPalette] = useState(false)
  useCommandKey(() => {
    if (overlay === null) setPalette(true)
  })
  const at = (allPeek ?? projectPeek)?.params

  const side = {
    projects,
    machines: view.machines,
    status: view.status,
    here,
    onSettings: () => setOverlay('settings'),
    onCommand: () => setPalette(true),
  }
  return (
    <>
      <div className="flex h-full">
        {rail ? <Rail {...side} /> : <Sidebar {...side} onNewDir={() => setOverlay('newDir')} />}
        <FileOpener value={openPath}>
          <div className="flex min-w-0 flex-1 flex-col">
            <ReconnectBanner />
            <TopBar project={here.project} open={open} active={active} onNew={() => setOverlay('session')} />
            <div className="min-h-0 flex-1">
              <Activity mode={active === null ? 'visible' : 'hidden'}>
                <PageRoutes location={page} />
              </Activity>
              {open.map(tab => (
                <Activity key={tab.id} mode={tab.id === active ? 'visible' : 'hidden'}>
                  <Suspense fallback={<Loading />}>
                    <TabPane id={tab.id} />
                  </Suspense>
                </Activity>
              ))}
            </div>
          </div>
        </FileOpener>
      </div>
      <Overlays overlay={overlay} setOverlay={setOverlay} focusedKey={here.project?.key} />
      <CommandPalette
        open={palette}
        onOpenChange={setPalette}
        projects={projects}
        scope={here.project}
        at={at?.mid && at.pane ? { mid: at.mid, paneId: at.pane } : undefined}
        onNew={() => setOverlay('session')}
      />
    </>
  )
}
