// The frame around every page once connected: the sidebar (or its rail), a strip while the relay
// reconnects, and the overlays (new session, add project, settings) that any part of it can open.

import { useState } from 'react'
import { Outlet, type Params, useMatch, useNavigate, useParams } from 'react-router'
import { Button } from '../components/button'
import { useI18n } from '../core/i18n'
import { locate } from '../core/pane-facts'
import { useLocal } from '../core/prefs'
import { useProjects, useSpace, useSpaceView } from '../core/space'
import { AddProject } from '../features/add-project/add-project-dialog'
import { NewSession } from '../features/new-session/new-session-panel'
import { LeaveSpace, Settings } from '../features/settings/settings-dialog'
import { type Project, paneKey } from '../model/projects'
import { projectHref } from '../utils/hrefs'
import { useShortcuts } from '../utils/shortcuts'
import { Rail } from './rail'
import { type Here, Sidebar } from './sidebar'

type Overlay = 'session' | 'add' | 'settings' | 'leave'

const hereOf = (projects: Project[], { key, mid, pane }: Readonly<Params>): Here => {
  if (key) return { project: projects.find(p => p.key === key), pane: undefined }
  if (mid && pane) return { project: locate(projects, mid, pane)?.project, pane: paneKey(mid, pane) }
  return { project: undefined, pane: undefined }
}

export function AppFrame() {
  const t = useI18n()
  const space = useSpace()
  const view = useSpaceView()
  const projects = useProjects()
  const here = hereOf(projects, useParams())
  const rail = useLocal().layout.rail
  const navigate = useNavigate()
  const [overlay, setOverlay] = useState<Overlay | null>(null)
  const close = (open: boolean) => !open && setOverlay(null)
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
          {view.status === 'reconnecting' ? (
            <div className="flex h-9 flex-none items-center gap-3 border-b border-ask-line bg-ask px-5 text-[13px]">
              <span className="flex-1">{t('banner.reconnecting')}</span>
              <Button size="small" onClick={space.reconnectNow}>
                {t('banner.now')}
              </Button>
            </div>
          ) : null}
          <div className="min-h-0 flex-1">
            <Outlet />
          </div>
        </div>
      </div>
      <NewSession
        open={overlay === 'session'}
        onOpenChange={close}
        focusedKey={here.project?.key}
        onAddProject={() => setOverlay('add')}
      />
      <AddProject open={overlay === 'add'} onOpenChange={close} />
      <Settings open={overlay === 'settings'} onOpenChange={close} onLeave={() => setOverlay('leave')} />
      <LeaveSpace open={overlay === 'leave'} onOpenChange={close} />
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
