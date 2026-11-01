// A pane page on a phone: one bar (back up, the name and where, stop while it works, the project's
// files, more), then the page. The facts rise in a sheet; they and ending the pane sit in the more
// menu. The terminal is for the computer: a session's page links to it only where chat cannot do.
// A session's page lays the same bar out itself, to scroll with the page (session.tsx).

import { ChevronLeft, FolderOpen, MoreHorizontal } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router'
import { StatusChip } from '../../components/chip'
import { DropdownMenu } from '../../components/menu'
import { Sheet } from '../../components/sheet'
import { useI18n } from '../../core/i18n'
import { StopButton } from '../../features/pane/pane-bar'
import type { PaneParts } from '../../features/pane/pane-layout'
import { projectFilesHref, projectHref, sessionHref } from '../../utils/hrefs'

// A finger-sized icon button, in the bar's ink.
const ICON =
  'inline-flex size-11 flex-none cursor-pointer items-center justify-center rounded-lg border-0 bg-transparent text-current no-underline opacity-75 active:opacity-100 focus-visible:outline-2 focus-visible:outline-accent'

export function MobilePane({ found, mid, paneId, view, onEnd, facts, children }: PaneParts) {
  const t = useI18n()
  const [sheet, setSheet] = useState(false)
  // The terminal's bar takes its night page (NIGHT in use-terminal.ts).
  const bar = view === 'terminal' ? 'border-[#222b3b] bg-term text-[#e9e5d9]' : 'border-line bg-bg text-text'
  return (
    <div className="flex h-full flex-col">
      <header className={`flex-none border-b ${bar}`}>
        <MobilePaneBar
          found={found}
          mid={mid}
          paneId={paneId}
          view={view}
          onEnd={onEnd}
          onFacts={() => setSheet(true)}
        />
      </header>
      <div className="flex min-h-0 flex-1 flex-col">{children}</div>
      <Sheet open={sheet} onOpenChange={setSheet} title={found.name} closeLabel={t('close')}>
        {sheet ? facts : null}
      </Sheet>
    </div>
  )
}

/** The bar's row, in the ink of the header it sits in: back up, the name and where, stop while it
 * works, the project's files, and more, which opens the facts with `onFacts` or ends the pane. */
export function MobilePaneBar({
  found,
  mid,
  paneId,
  view,
  onEnd,
  onFacts,
}: Omit<PaneParts, 'facts' | 'children'> & { onFacts: () => void }) {
  const t = useI18n()
  const { project, name, pane } = found
  const session = 'session' in pane ? pane.session : undefined
  // Up, not back: a page opened from a notification has nothing to go back to.
  const up = view === 'terminal' && session ? sessionHref(mid, paneId) : projectHref(project.key)
  return (
    <div className="flex h-[52px] items-center px-1">
      <Link to={up} aria-label={t('pane.back')} className={`${ICON} text-accent! opacity-100!`}>
        <ChevronLeft size={24} />
      </Link>
      <div className="flex min-w-0 flex-1 flex-col px-1 leading-tight">
        <span className="truncate font-semibold">{name}</span>
        <span className="flex min-w-0 items-center gap-1.5 text-xs opacity-70">
          {session ? <StatusChip status={session.status} label={t(`status.${session.status}`)} /> : null}
          <span className="truncate">
            {project.name} · {project.machine}
          </span>
        </span>
      </div>
      {session?.status === 'working' ? <StopButton session={session} className={ICON} /> : null}
      <Link
        to={projectFilesHref(project.key)}
        aria-label={t('project.files')}
        title={t('project.files')}
        className={ICON}
      >
        <FolderOpen size={20} />
      </Link>
      <DropdownMenu
        trigger={
          <button type="button" aria-label={t('pane.more')} className={ICON}>
            <MoreHorizontal size={20} />
          </button>
        }
        items={[
          { label: t('info.toggle'), onClick: onFacts },
          { label: t(session ? 'session.end' : 'terminal.end'), onClick: onEnd, danger: true },
        ]}
      />
    </div>
  )
}
