// The frame around every page on a phone: one column, a bar over the boards, the projects in a
// drawer, and the same overlays as on a computer.

import { ChevronLeft, Menu, Plus } from 'lucide-react'
import { useState } from 'react'
import { Outlet, useNavigate, useOutletContext, useParams } from 'react-router'
import { Drawer } from '../../components/drawer'
import { useI18n } from '../../core/i18n'
import { useProjects, useSpaceView } from '../../core/space'
import { needs } from '../../model/projects'
import { hereOf, type Overlay, Overlays, ReconnectBanner } from '../common'
import { AskBadge } from '../marks'
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
  const fromDrawer = (next: Overlay) => {
    setDrawer(false)
    setOverlay(next)
  }
  const actions: FrameActions = { openDrawer: () => setDrawer(true), openNew: () => setOverlay('session') }
  return (
    <>
      <div className="flex h-full flex-col">
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
 * The boards under a bar: the drawer on All projects, the way back up on a project, and New. The
 * board's own heading names the page, so the bar does not repeat it.
 */
export function MobileBoard() {
  const t = useI18n()
  const { openDrawer, openNew } = useOutletContext<FrameActions>()
  const navigate = useNavigate()
  const total = needs(useProjects()).length
  const inProject = useParams().key !== undefined
  return (
    <div className="flex h-full flex-col">
      <header className="flex h-[52px] flex-none items-center justify-between border-b border-line px-1.5">
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
        <button type="button" onClick={openNew} aria-label={t('app.newSession')} className={ICON}>
          <Plus size={22} />
        </button>
      </header>
      <main className="paper flex min-h-0 flex-1 flex-col gap-6 overflow-auto px-4 py-4">
        <Outlet />
      </main>
    </div>
  )
}
