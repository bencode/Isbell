// The workbench frame: top bar, project sidebar, the board, the shortcut bar, and the overlays
// (new session, add project, settings) that any part of it can open.

import { Ellipsis, Plus, SquareTerminal } from 'lucide-react'
import { type ReactNode, useMemo, useState } from 'react'
import { Outlet, useNavigate } from 'react-router'
import { Button } from '../components/button'
import { DropdownMenu } from '../components/menu'
import { type Key, useI18n } from '../core/i18n'
import { useProjects, useSpace, useSpaceView } from '../core/space'
import { AddProject } from '../features/add-project/add-project-dialog'
import { useFocused } from '../features/board/project-page'
import { NewSession } from '../features/new-session/new-session-panel'
import { LeaveSpace, Settings } from '../features/settings/settings-dialog'
import { projectHref } from '../utils/hrefs'
import { useShortcuts } from '../utils/shortcuts'
import { Sidebar } from './sidebar'

type Overlay = 'session' | 'add' | 'settings' | 'leave'

function Kbd({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex h-[18px] min-w-[18px] items-center justify-center rounded border border-line px-1 font-mono text-[11px] text-faint">
      {children}
    </span>
  )
}

const HINTS: [ReactNode, Key][] = [
  [<Kbd key="n">n</Kbd>, 'hint.new'],
  [<Kbd key="a">a</Kbd>, 'hint.add'],
  [
    <>
      <Kbd>1</Kbd>–<Kbd>9</Kbd>
    </>,
    'hint.focus',
  ],
  [
    <>
      <Kbd>[</Kbd>
      <Kbd>]</Kbd>
    </>,
    'hint.step',
  ],
  [
    <>
      <Kbd>0</Kbd>
      <Kbd>Esc</Kbd>
    </>,
    'hint.all',
  ],
  [<Kbd key=",">,</Kbd>, 'hint.settings'],
]

export function BoardLayout() {
  const t = useI18n()
  const space = useSpace()
  const view = useSpaceView()
  const projects = useProjects()
  const focused = useFocused(projects)
  const navigate = useNavigate()
  const [overlay, setOverlay] = useState<Overlay | null>(null)
  const close = (open: boolean) => !open && setOverlay(null)

  const step = (by: number) => {
    if (!projects.length) return
    const i = focused ? projects.indexOf(focused) : by > 0 ? -1 : 0
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
    overlay === null,
  )

  const menu = useMemo(
    () => [
      { label: t('menu.settings'), onClick: () => setOverlay('settings') },
      { label: t('menu.leave'), onClick: () => setOverlay('leave'), danger: true },
    ],
    [t],
  )

  return (
    <>
      <div className="flex h-full flex-col">
        <header className="flex h-[52px] flex-none items-center gap-1 border-b border-line px-3">
          <span className="mr-2 flex h-7 items-center gap-2 border-r border-line pr-3 pl-1 font-bold">
            <SquareTerminal size={20} className="text-accent" aria-hidden="true" />
            Isbell
          </span>
          <span className="flex-1" />
          <Button variant="primary" onClick={() => setOverlay('session')}>
            <Plus size={16} />
            {t('app.newSession')}
          </Button>
          <DropdownMenu
            trigger={
              <Button variant="quiet" size="icon" aria-label={t('app.menu')}>
                <Ellipsis size={18} />
              </Button>
            }
            items={menu}
          />
        </header>
        {view.status === 'reconnecting' ? (
          <div className="flex flex-none items-center gap-3 border-b border-ask-line bg-ask px-6 py-2 text-[13px]">
            <span className="flex-1">{t('banner.reconnecting')}</span>
            <Button size="small" onClick={space.reconnectNow}>
              {t('banner.now')}
            </Button>
          </div>
        ) : null}
        <div className="flex min-h-0 flex-1">
          <Sidebar
            projects={projects}
            focused={focused}
            machines={view.machines}
            onAddProject={() => setOverlay('add')}
          />
          <div className="flex min-w-0 flex-1 flex-col">
            <main className="flex min-h-0 flex-1 flex-col gap-6 overflow-auto px-6 py-5">
              <Outlet />
            </main>
            <div className="flex flex-none flex-wrap gap-4 border-t border-line px-6 py-2 text-xs text-faint">
              {HINTS.map(([keys, label]) => (
                <span key={label} className="inline-flex items-center gap-1.5">
                  {keys} {t(label)}
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>
      <NewSession
        open={overlay === 'session'}
        onOpenChange={close}
        focusedKey={focused?.key}
        onAddProject={() => setOverlay('add')}
      />
      <AddProject open={overlay === 'add'} onOpenChange={close} />
      <Settings open={overlay === 'settings'} onOpenChange={close} onLeave={() => setOverlay('leave')} />
      <LeaveSpace open={overlay === 'leave'} onOpenChange={close} />
    </>
  )
}
