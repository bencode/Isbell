// The bar over a pane, beside the board or on its terminal page: its name (an agent's renamed in
// place) and state, the project where the page around does not say it, a way to stop an agent at
// work, then the facts in a popover and a way to end it.

import { Popover } from '@base-ui/react/popover'
import { Info, Power, Square } from 'lucide-react'
import type { ReactNode } from 'react'
import { StatusChip } from '../../components/chip'
import { useI18n } from '../../core/i18n'
import type { Found, Session } from '../../model/projects'
import { useAnswer } from './asking'
import { NameEditor } from './name-editor'

/** An icon button on the bar. */
export const BAR_ICON =
  'inline-flex size-[30px] flex-none cursor-pointer items-center justify-center rounded-md border-0 bg-transparent text-muted no-underline hover:bg-raised-2 hover:text-text data-popup-open:bg-raised-2 data-popup-open:text-text focus-visible:outline-2 focus-visible:outline-accent'

type Props = {
  found: Found
  onEnd: () => void
  /** Mounted only while the popover is open, so what they poll stops with it. */
  facts: ReactNode
  /** Says which project; only where the page around does not. */
  showProject: boolean
  /** Buttons before the facts and after ending. */
  before?: ReactNode
  after?: ReactNode
}

export function PaneBar({ found: { project, name, pane }, onEnd, facts, showProject, before, after }: Props) {
  const t = useI18n()
  const session = 'session' in pane ? pane.session : undefined
  return (
    <header className="flex h-11 flex-none items-center gap-1 border-b border-line pr-2 pl-4">
      {session ? <NameEditor session={session} /> : <b className="truncate font-semibold">{name}</b>}
      {session ? (
        <span className="ml-1.5 flex-none">
          <StatusChip status={session.status} label={t(`status.${session.status}`)} />
        </span>
      ) : null}
      {showProject ? <span className="ml-2 truncate text-[12.5px] text-faint">{project.name}</span> : null}
      <span className="flex-1" />
      {session?.status === 'working' ? <StopButton session={session} /> : null}
      {before}
      <Popover.Root>
        <Popover.Trigger aria-label={t('info.toggle')} title={t('info.toggle')} className={BAR_ICON}>
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
      <button
        type="button"
        onClick={onEnd}
        aria-label={t(session ? 'session.end' : 'terminal.end')}
        title={t(session ? 'session.end' : 'terminal.end')}
        className={`${BAR_ICON} hover:text-danger!`}
      >
        <Power size={15} />
      </button>
      {after}
    </header>
  )
}

/** Esc interrupts the turn going on, in the agents Isbell runs; the status says when it took. */
function StopButton({ session }: { session: Session }) {
  const t = useI18n()
  const stop = useAnswer(session.mid, session.paneId, () => undefined)
  return (
    <button
      type="button"
      onClick={() => void stop.press('esc')}
      disabled={stop.busy}
      aria-label={t('card.stop')}
      title={stop.error ?? t('card.stopHint')}
      className={`${BAR_ICON} hover:text-danger!`}
    >
      <Square size={13} fill="currentColor" />
    </button>
  )
}
