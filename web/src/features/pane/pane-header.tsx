// The header the views of a pane share: where it is, which view this is, and how to end it.

import { FolderOpen, MessageSquare, Square, SquareTerminal } from 'lucide-react'
import { Link } from 'react-router'
import { Button } from '../../components/button'
import { StatusChip } from '../../components/chip'
import { InfoToggle } from '../../components/info-panel'
import { ViewTabs } from '../../components/view-tabs'
import { useI18n } from '../../core/i18n'
import { toggleInfo, useLocal } from '../../core/prefs'
import type { Found } from '../../model/projects'
import { filesHref, peekHref, projectHref, terminalHref } from '../../utils/hrefs'
import type { PaneView } from './pane-layout'

type Props = {
  found: Found
  mid: string
  paneId: string
  /** Which view of the pane this is; a shell has no chat. */
  view: PaneView
  onEnd: () => void
}

export function PaneHeader({ found: { project, name, pane }, mid, paneId, view, onEnd }: Props) {
  const t = useI18n()
  const info = useLocal().layout.info
  const session = 'session' in pane ? pane.session : undefined
  const where = `${project.machine} · ${project.display}`
  const chat = {
    key: 'chat',
    href: peekHref(project.key, mid, paneId),
    icon: <MessageSquare size={15} />,
    label: t('pane.chat'),
  }
  const views = [
    ...(session ? [chat] : []),
    {
      key: 'terminal',
      href: terminalHref(mid, paneId),
      icon: <SquareTerminal size={15} />,
      label: t('pane.terminal'),
    },
    { key: 'files', href: filesHref(mid, paneId), icon: <FolderOpen size={15} />, label: t('pane.files') },
  ]
  return (
    <header className="flex h-[52px] flex-none items-center gap-2.5 border-b border-line pr-3 pl-5">
      <div className="flex min-w-0 items-center gap-1.5">
        <Link
          to={projectHref(project.key)}
          className="flex-none text-muted no-underline hover:text-text hover:underline"
        >
          {project.name}
        </Link>
        <span className="text-faint">/</span>
        <span className="truncate font-semibold">{name}</span>
        {session ? <StatusChip status={session.status} label={t(`status.${session.status}`)} /> : null}
      </div>
      <span className="min-w-0 truncate text-[12.5px] text-faint">{where}</span>
      <span className="flex-1" />
      <ViewTabs label={t('pane.view')} views={views} current={view} />
      <Button variant="end" onClick={onEnd} title={session ? t('session.endHint') : undefined}>
        <Square size={12} fill="currentColor" />
        {session ? t('session.end') : t('terminal.end')}
      </Button>
      <InfoToggle open={info} onToggle={toggleInfo} label={t('info.toggle')} />
    </header>
  )
}
