// The header both views of a pane share: where it is, which view this is, and how to end it.

import { paneKey } from '@isbell/core'
import { MessageSquare, Square, SquareTerminal } from 'lucide-react'
import { useEffect } from 'react'
import { Link } from 'react-router'
import { Button } from '../../components/button'
import { StatusChip } from '../../components/chip'
import { InfoToggle } from '../../components/info-panel'
import { useI18n } from '../../core/i18n'
import type { Found } from '../../core/pane-facts'
import { rememberView, toggleInfo, useLocal } from '../../core/prefs'
import { projectHref, sessionHref, terminalHref } from '../../utils/hrefs'

const VIEW =
  'inline-flex h-[30px] items-center gap-1.5 rounded-md px-3 text-[13px] font-medium no-underline focus-visible:outline-2 focus-visible:outline-accent'

type Props = {
  found: Found
  mid: string
  paneId: string
  /** Which view of an agent's pane this is; a shell has only the terminal. */
  view: 'chat' | 'terminal'
  onEnd: () => void
}

export function PaneHeader({ found: { project, name, pane }, mid, paneId, view, onEnd }: Props) {
  const t = useI18n()
  const info = useLocal().layout.info
  const session = 'session' in pane ? pane.session : undefined
  // The sidebar opens an agent in the view it was last seen in.
  const agent = session !== undefined
  useEffect(() => {
    if (agent) rememberView(paneKey(mid, paneId), view)
  }, [agent, mid, paneId, view])
  const where = [session ? '' : paneId, project.machine, project.display].filter(Boolean).join(' · ')
  const views = [
    { key: 'chat', href: sessionHref(mid, paneId), icon: <MessageSquare size={15} />, label: t('pane.chat') },
    {
      key: 'terminal',
      href: terminalHref(mid, paneId),
      icon: <SquareTerminal size={15} />,
      label: t('pane.terminal'),
    },
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
      {session ? (
        <nav
          aria-label={t('pane.view')}
          className="inline-flex flex-none gap-0.5 rounded-lg border border-line bg-bg p-0.5"
        >
          {views.map(v => (
            <Link
              key={v.key}
              to={v.href}
              aria-current={v.key === view ? 'page' : undefined}
              className={`${VIEW} ${v.key === view ? 'index-card bg-raised text-text' : 'text-muted hover:text-text'}`}
            >
              {v.icon}
              {v.label}
            </Link>
          ))}
        </nav>
      ) : null}
      <Button variant="end" onClick={onEnd} title={session ? t('session.endHint') : undefined}>
        <Square size={12} fill="currentColor" />
        {session ? t('session.end') : t('terminal.end')}
      </Button>
      <InfoToggle open={info} onToggle={toggleInfo} label={t('info.toggle')} />
    </header>
  )
}
