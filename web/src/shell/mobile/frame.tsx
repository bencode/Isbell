// The frame around every page on a phone: the projects in a drawer, and the overlays it shares with a
// computer's, but New, a page of its own here (new-session.tsx). The boards scroll with the page
// (board.tsx); the pages not rebuilt for that yet sit in a fixed column that scrolls inside.

import { useState } from 'react'
import { Outlet, useNavigate, useParams } from 'react-router'
import { Drawer } from '../../components/drawer'
import { useI18n } from '../../core/i18n'
import { useProjects, useSpaceView } from '../../core/space'
import { FileOpener, type OpenPath } from '../../core/tabs'
import { newHref, projectFilesHref } from '../../utils/hrefs'
import { useVisibleArea } from '../../utils/viewport'
import { hereOf, type Overlay, Overlays, ReconnectBanner } from '../common'
import { MobileNav } from './nav'

/** What the frame lends the bar of the page inside it. */
export type FrameActions = { openDrawer: () => void }

export function MobileFrame() {
  const t = useI18n()
  const navigate = useNavigate()
  const view = useSpaceView()
  const projects = useProjects()
  const here = hereOf(projects, useParams())
  const [overlay, setOverlay] = useState<Overlay | null>(null)
  const [drawer, setDrawer] = useState(false)
  const fromDrawer = (next: Overlay) => {
    setDrawer(false)
    setOverlay(next)
  }
  const actions: FrameActions = { openDrawer: () => setDrawer(true) }
  // A path in a reply opens on the files page: a folder listed, a file read.
  const openPath: OpenPath = (key, rel, dir) => navigate(projectFilesHref(key, dir ? `${rel}/` : rel))
  return (
    <>
      <FileOpener value={openPath}>
        <Outlet context={actions} />
      </FileOpener>
      <Drawer open={drawer} onOpenChange={setDrawer} label={t('side.projects')}>
        <MobileNav
          projects={projects}
          machines={view.machines}
          status={view.status}
          here={here}
          onNewDir={() => {
            setDrawer(false)
            navigate(newHref(undefined, true))
          }}
          onSettings={() => fromDrawer('settings')}
          onGo={() => setDrawer(false)}
        />
      </Drawer>
      <Overlays overlay={overlay} setOverlay={setOverlay} focusedKey={here.project?.key} />
    </>
  )
}

/** A page not rebuilt to scroll with the page yet: one column clear of the notch and the home
 * indicator, fixed to what the keyboard leaves visible so its bottom stays above it, scrolling
 * inside. */
export function FixedPage() {
  const area = useVisibleArea()
  // The home indicator is under the page only while the keyboard is down.
  const keyboard = !!area && area.top + area.height < window.innerHeight - 1
  return (
    <div
      className={`fixed inset-x-0 flex flex-col pt-[env(safe-area-inset-top)] pr-[env(safe-area-inset-right)] pl-[env(safe-area-inset-left)] ${keyboard ? '' : 'pb-[env(safe-area-inset-bottom)]'}`}
      style={area ? { top: area.top, height: area.height } : { top: 0, bottom: 0 }}
    >
      <ReconnectBanner />
      <div className="min-h-0 flex-1">
        <Outlet />
      </div>
    </div>
  )
}
