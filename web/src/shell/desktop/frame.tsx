// The frame around every page on a computer: the sidebar (or its rail), a strip while the relay
// reconnects, and the overlays (new session, add project, settings) that any part of it can open.

import { useState } from 'react'
import { Outlet, useMatch, useNavigate, useParams } from 'react-router'
import { useLocal } from '../../core/prefs'
import { useProjects, useSpaceView } from '../../core/space'
import { projectHref } from '../../utils/hrefs'
import { useShortcuts } from '../../utils/shortcuts'
import { hereOf, type Overlay, Overlays, ReconnectBanner } from '../common'
import { Rail } from './rail'
import { Sidebar } from './sidebar'

export function AppFrame() {
  const view = useSpaceView()
  const projects = useProjects()
  const here = hereOf(projects, useParams())
  const rail = useLocal().layout.rail
  const navigate = useNavigate()
  const [overlay, setOverlay] = useState<Overlay | null>(null)
  // Single keys belong to the boards; on a session or a terminal they are typing.
  const board = [useMatch('/'), useMatch('/p/:key')].some(Boolean)

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
      a: () => setOverlay('add'),
      ',': () => setOverlay('settings'),
      '0': () => navigate('/'),
      esc: () => navigate('/'),
      ']': () => step(1),
      '[': () => step(-1),
    },
    overlay === null && board,
  )

  const side = {
    projects,
    machines: view.machines,
    status: view.status,
    here,
    onNew: () => setOverlay('session'),
    onSettings: () => setOverlay('settings'),
  }
  return (
    <>
      <div className="flex h-full">
        {rail ? <Rail {...side} /> : <Sidebar {...side} onAddProject={() => setOverlay('add')} />}
        <div className="flex min-w-0 flex-1 flex-col">
          <ReconnectBanner />
          <div className="min-h-0 flex-1">
            <Outlet />
          </div>
        </div>
      </div>
      <Overlays overlay={overlay} setOverlay={setOverlay} focusedKey={here.project?.key} />
    </>
  )
}

/** The boards scroll on a dotted page. */
export function BoardMain() {
  return (
    <main className="paper flex h-full flex-col gap-6 overflow-auto px-7 py-6">
      <Outlet />
    </main>
  )
}
