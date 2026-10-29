// A pane page on a phone: one bar (back up, the name and where, stop while it works, the other view,
// the project's files, more), then the page. The facts rise in a sheet; they and ending the pane sit
// in the more menu.

import { ChevronLeft, FolderOpen, MessageSquare, MoreHorizontal, SquareTerminal } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router'
import { StatusChip } from '../../components/chip'
import { DropdownMenu } from '../../components/menu'
import { Sheet } from '../../components/sheet'
import { useI18n } from '../../core/i18n'
import { StopButton } from '../../features/pane/pane-bar'
import type { PaneParts } from '../../features/pane/pane-layout'
import { projectFilesHref, projectHref, sessionHref, terminalHref } from '../../utils/hrefs'

// A finger-sized icon button, in the bar's ink.
const ICON =
  'inline-flex size-11 flex-none cursor-pointer items-center justify-center rounded-lg border-0 bg-transparent text-current no-underline opacity-75 active:opacity-100 focus-visible:outline-2 focus-visible:outline-accent'

export function MobilePane({ found, mid, paneId, view, onEnd, facts, children }: PaneParts) {
  const t = useI18n()
  const [sheet, setSheet] = useState(false)
  const { project, name, pane } = found
  const session = 'session' in pane ? pane.session : undefined
  const terminal = view === 'terminal'
  // Up, not back: a page opened from a notification has nothing to go back to.
  const up = terminal && session ? sessionHref(mid, paneId) : projectHref(project.key)
  const other = terminal
    ? { href: sessionHref(mid, paneId), icon: <MessageSquare size={20} />, label: t('pane.chat') }
    : { href: terminalHref(mid, paneId), icon: <SquareTerminal size={20} />, label: t('pane.terminal') }
  // The terminal's bar takes its night page (NIGHT in use-terminal.ts).
  const bar = terminal ? 'border-[#222b3b] bg-term text-[#e9e5d9]' : 'border-line bg-bg text-text'
  return (
    <div className="flex h-full flex-col">
      <header className={`flex h-[52px] flex-none items-center border-b px-1 ${bar}`}>
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
        {session ? (
          <Link to={other.href} aria-label={other.label} title={other.label} className={ICON}>
            {other.icon}
          </Link>
        ) : null}
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
            { label: t('info.toggle'), onClick: () => setSheet(true) },
            { label: t(session ? 'session.end' : 'terminal.end'), onClick: onEnd, danger: true },
          ]}
        />
      </header>
      <div className="flex min-h-0 flex-1 flex-col">{children}</div>
      <Sheet open={sheet} onOpenChange={setSheet} title={name} closeLabel={t('close')}>
        {sheet ? facts : null}
      </Sheet>
    </div>
  )
}
