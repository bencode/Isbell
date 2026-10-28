// A session open beside the board: a bar (its name and state, the project when the board is every
// agent's, then the terminal, the facts, more, and close), then the page. The facts rise in a popover;
// ending it sits in the more menu.

import { Popover } from '@base-ui/react/popover'
import { Info, Maximize2, MoreHorizontal, X } from 'lucide-react'
import { Link, useParams } from 'react-router'
import { StatusChip } from '../../components/chip'
import { DropdownMenu } from '../../components/menu'
import { useI18n } from '../../core/i18n'
import { boardHref, terminalHref } from '../../utils/hrefs'
import type { PaneParts } from './pane-layout'

const ICON =
  'inline-flex size-[30px] flex-none cursor-pointer items-center justify-center rounded-md border-0 bg-transparent text-muted no-underline hover:bg-raised-2 hover:text-text data-popup-open:bg-raised-2 data-popup-open:text-text focus-visible:outline-2 focus-visible:outline-accent'

export function PeekPane({ found, mid, paneId, onEnd, facts, children }: PaneParts) {
  const t = useI18n()
  const { key } = useParams()
  const { project, name, pane } = found
  const session = 'session' in pane ? pane.session : undefined
  return (
    <div className="flex h-full min-w-0 flex-1 flex-col">
      <header className="flex h-11 flex-none items-center gap-1 border-b border-line pr-2 pl-4">
        <b className="truncate font-semibold">{name}</b>
        {session ? (
          <span className="ml-1.5 flex-none">
            <StatusChip status={session.status} label={t(`status.${session.status}`)} />
          </span>
        ) : null}
        {key ? null : <span className="ml-2 truncate text-[12.5px] text-faint">{project.name}</span>}
        <span className="flex-1" />
        <Link
          to={terminalHref(mid, paneId)}
          aria-label={t('pane.terminal')}
          title={t('pane.terminal')}
          className={ICON}
        >
          <Maximize2 size={15} />
        </Link>
        <Popover.Root>
          <Popover.Trigger aria-label={t('info.toggle')} title={t('info.toggle')} className={ICON}>
            <Info size={16} />
          </Popover.Trigger>
          <Popover.Portal>
            <Popover.Positioner sideOffset={6} align="end" className="z-50 outline-none">
              <Popover.Popup className="flex max-h-[70vh] w-[340px] flex-col gap-5 overflow-auto rounded-lg border border-line bg-raised-2 p-4 text-[13px] index-card-lifted outline-none">
                {facts}
              </Popover.Popup>
            </Popover.Positioner>
          </Popover.Portal>
        </Popover.Root>
        <DropdownMenu
          trigger={
            <button type="button" aria-label={t('pane.more')} title={t('pane.more')} className={ICON}>
              <MoreHorizontal size={16} />
            </button>
          }
          items={[{ label: t('session.end'), onClick: onEnd, danger: true }]}
        />
        <Link to={boardHref(key)} aria-label={t('peek.close')} title={t('peek.close')} className={ICON}>
          <X size={16} />
        </Link>
      </header>
      {children}
    </div>
  )
}
