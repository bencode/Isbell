// What both shells share: where the route points, the overlays any part of a frame can open, the
// strip shown while the relay reconnects, and the terminal page, loaded on first use.

import { lazy, Suspense } from 'react'
import type { Params } from 'react-router'
import { Button } from '../components/button'
import { useI18n } from '../core/i18n'
import { useSpace, useSpaceView } from '../core/space'
import { NewSession } from '../features/new-session/new-session-panel'
import type { PaneLayout } from '../features/pane/pane-layout'
import { LeaveSpace, Settings } from '../features/settings/settings-dialog'
import { locate, type Project, paneKey } from '../model/projects'

/** Where the route points: a project's board, or a pane (by `paneKey`) inside some project. */
export type Here = { project: Project | undefined; pane: string | undefined }

export const hereOf = (projects: Project[], { key, mid, pane }: Readonly<Params>): Here => {
  if (key) return { project: projects.find(p => p.key === key), pane: undefined }
  if (mid && pane) return { project: locate(projects, mid, pane)?.project, pane: paneKey(mid, pane) }
  return { project: undefined, pane: undefined }
}

export type Overlay = 'session' | 'newDir' | 'settings' | 'leave'

/** New (in a project or a new directory), settings and leaving the space; one open at a time. */
export function Overlays({
  overlay,
  setOverlay,
  focusedKey,
}: {
  overlay: Overlay | null
  setOverlay: (overlay: Overlay | null) => void
  focusedKey: string | undefined
}) {
  const close = (open: boolean) => !open && setOverlay(null)
  return (
    <>
      <NewSession
        open={overlay === 'session' || overlay === 'newDir'}
        onOpenChange={close}
        focusedKey={focusedKey}
        newDir={overlay === 'newDir'}
      />
      <Settings open={overlay === 'settings'} onOpenChange={close} onLeave={() => setOverlay('leave')} />
      <LeaveSpace open={overlay === 'leave'} onOpenChange={close} />
    </>
  )
}

export function ReconnectBanner() {
  const t = useI18n()
  const space = useSpace()
  const { status } = useSpaceView()
  if (status !== 'reconnecting') return null
  return (
    <div className="flex h-9 flex-none items-center gap-3 border-b border-ask-line bg-ask px-5 text-[13px]">
      <span className="flex-1">{t('banner.reconnecting')}</span>
      <Button size="small" onClick={space.reconnectNow}>
        {t('banner.now')}
      </Button>
    </div>
  )
}

export function Loading() {
  const t = useI18n()
  return <p className="m-6 text-muted">{t('board.loading')}</p>
}

// xterm comes with the terminal page, so a shell that opens none never loads it.
const TerminalPage = lazy(() =>
  import('../features/pane/terminal-page').then(m => ({ default: m.TerminalPage })),
)

export function LazyTerminal({ layout }: { layout: PaneLayout }) {
  return (
    <Suspense fallback={<Loading />}>
      <TerminalPage layout={layout} />
    </Suspense>
  )
}

// The files view brings the Markdown and highlighting libraries; they load with it.
const FilesPage = lazy(() => import('../features/files/files-page').then(m => ({ default: m.FilesPage })))

export function LazyFiles({ layout }: { layout: PaneLayout }) {
  return (
    <Suspense fallback={<Loading />}>
      <FilesPage layout={layout} />
    </Suspense>
  )
}
