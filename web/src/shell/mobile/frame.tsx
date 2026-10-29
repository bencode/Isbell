// The frame around every page on a phone: one column clear of the notch and the home indicator, a
// bar over the boards, the projects in a drawer, and the same overlays as on a computer.

import { ChevronLeft, Menu, Plus } from 'lucide-react'
import { useState } from 'react'
import { Outlet, useNavigate, useOutletContext, useParams } from 'react-router'
import { Drawer } from '../../components/drawer'
import { useI18n } from '../../core/i18n'
import { useProjects, useSpaceView } from '../../core/space'
import { needs } from '../../model/projects'
import { useVisibleArea } from '../../utils/viewport'
import { hereOf, type Overlay, Overlays, ReconnectBanner } from '../common'
import { AskBadge } from '../marks'
import { InstallTip } from './install-tip'
import { MobileNav } from './nav'

/** What the frame lends the bar of the page inside it. */
type FrameActions = { openDrawer: () => void; openNew: () => void }

// A finger-sized icon button.
const ICON =
  'relative inline-flex size-11 flex-none cursor-pointer items-center justify-center rounded-lg border-0 bg-transparent text-muted active:bg-raised-2 focus-visible:outline-2 focus-visible:outline-accent'

export function MobileFrame() {
  const t = useI18n()
  const view = useSpaceView()
  const projects = useProjects()
  const here = hereOf(projects, useParams())
  const [overlay, setOverlay] = useState<Overlay | null>(null)
  const [drawer, setDrawer] = useState(false)
  // Fixed to what the keyboard leaves visible, so the bottom of a page stays above it.
  const area = useVisibleArea()
  const fromDrawer = (next: Overlay) => {
    setDrawer(false)
    setOverlay(next)
  }
  const actions: FrameActions = { openDrawer: () => setDrawer(true), openNew: () => setOverlay('session') }
  // The home indicator is under the page only while the keyboard is down.
  const keyboard = !!area && area.top + area.height < window.innerHeight - 1
  return (
    <>
      <div
        className={`fixed inset-x-0 flex flex-col pt-[env(safe-area-inset-top)] pr-[env(safe-area-inset-right)] pl-[env(safe-area-inset-left)] ${keyboard ? '' : 'pb-[env(safe-area-inset-bottom)]'}`}
        style={area ? { top: area.top, height: area.height } : { top: 0, bottom: 0 }}
      >
        <ReconnectBanner />
        <div className="min-h-0 flex-1">
          <Outlet context={actions} />
        </div>
      </div>
      <Drawer open={drawer} onOpenChange={setDrawer} label={t('side.projects')}>
        <MobileNav
          projects={projects}
          machines={view.machines}
          status={view.status}
          here={here}
          onNew={() => fromDrawer('session')}
          onSettings={() => fromDrawer('settings')}
          onGo={() => setDrawer(false)}
        />
      </Drawer>
      <Overlays overlay={overlay} setOverlay={setOverlay} focusedKey={here.project?.key} />
    </>
  )
}

/**
 * The boards under a bar that names them, with the drawer on All projects and the way back up on a
 * project, and New at its end, where it covers nothing.
 */
export function MobileBoard() {
  const t = useI18n()
  const { openDrawer, openNew } = useOutletContext<FrameActions>()
  const navigate = useNavigate()
  const view = useSpaceView()
  const projects = useProjects()
  const total = needs(projects).length
  const { key } = useParams()
  const inProject = key !== undefined
  const project = projects.find(p => p.key === key)
  const agents = projects.reduce((n, p) => n + p.sessions.length, 0)
  const online = view.machines.filter(m => m.online).length
  const [title, sub] = inProject
    ? [project?.name, project && `${project.machine}${project.online ? '' : ` · ${t('side.offline')}`}`]
    : [t('all.title'), view.machines.length ? t('all.short', { agents, online }) : undefined]
  return (
    <div className="flex h-full flex-col">
      <header className="flex h-[52px] flex-none items-center gap-1 border-b border-line px-1.5">
        {inProject ? (
          <button
            type="button"
            onClick={() => navigate('/')}
            aria-label={t('project.back')}
            className={`${ICON} text-accent!`}
          >
            <ChevronLeft size={24} />
          </button>
        ) : (
          <button type="button" onClick={openDrawer} aria-label={t('side.projects')} className={ICON}>
            <Menu size={22} />
            {total ? (
              <AskBadge n={total} label={t('needs.title')} className="absolute top-1 right-0.5" />
            ) : null}
          </button>
        )}
        <span className="flex min-w-0 flex-1 items-baseline gap-2">
          <span className="truncate text-base font-bold">{title}</span>
          {sub ? <span className="min-w-0 truncate text-xs text-faint">{sub}</span> : null}
        </span>
        <button
          type="button"
          onClick={openNew}
          className="inline-flex h-11 flex-none cursor-pointer items-center gap-1 rounded-lg border-0 bg-transparent px-2.5 text-sm font-semibold text-accent active:bg-raised-2 focus-visible:outline-2 focus-visible:outline-accent"
        >
          <Plus size={18} />
          {t('app.newSession')}
        </button>
      </header>
      <main className="paper flex min-h-0 flex-1 flex-col gap-6 overflow-auto px-4 py-4">
        <InstallTip />
        <Outlet />
      </main>
    </div>
  )
}
