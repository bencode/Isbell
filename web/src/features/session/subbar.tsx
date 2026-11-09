// The bar over a session's tab: its name, renamed in place, where it works and how it stands; the
// switch between its chat and its terminal; its facts; and ending it.

import { Popover } from '@base-ui/react/popover'
import { Info, Square } from 'lucide-react'
import type { ReactNode } from 'react'
import { IconButton, SMALL_ICON } from '../../components/icon-button'
import { Segmented } from '../../components/segmented'
import { StatusDot } from '../../components/status-dot'
import { useI18n } from '../../core/i18n'
import type { Pane } from '../../model/projects'
import { NameEditor } from './name-editor'
import { ShareControl } from './share-control'

export type View = 'chat' | 'terminal'

type Props = {
  mid: string
  pane: Pane
  /** The branch of the worktree it works in, once known; null outside any branch. */
  branch: string | null | undefined
  /** The view shown and how to switch it; absent for a shell, which has only its terminal. */
  view: { shown: View; onShow: (view: View) => void } | undefined
  facts: ReactNode
  onEnd: () => void
  /** What the place it is in adds, at its end. */
  actions?: ReactNode
}

export function Subbar({ mid, pane, branch, view, facts, onEnd, actions }: Props) {
  const t = useI18n()
  const about =
    'session' in pane
      ? [pane.session.kind, t(`status.${pane.session.status}`)]
      : [t('info.terminal'), pane.shell.title]
  return (
    <div className="flex h-[34px] flex-none items-center gap-2.5 border-b border-line px-3 text-xs text-faint">
      {'session' in pane ? (
        <>
          <StatusDot status={pane.session.status} />
          <NameEditor session={pane.session} />
        </>
      ) : (
        <span className="font-mono text-[13px] text-text">{pane.shell.paneId}</span>
      )}
      <span className="min-w-0 truncate">
        {branch ? <span className="font-mono text-muted">{branch} · </span> : null}
        {about.filter(Boolean).join(' · ')}
      </span>
      <span className="ml-auto flex flex-none items-center gap-1">
        {view ? <ViewSwitch {...view} /> : null}
        <ShareControl mid={mid} paneId={'session' in pane ? pane.session.paneId : pane.shell.paneId} />
        <Popover.Root>
          <Popover.Trigger
            render={
              <IconButton label={t('session.info')} size="small">
                <Info {...SMALL_ICON} />
              </IconButton>
            }
          />
          <Popover.Portal>
            <Popover.Positioner side="bottom" align="end" sideOffset={6} className="z-50 outline-none">
              <Popover.Popup className="flex max-h-[70vh] w-[360px] flex-col gap-5 overflow-auto rounded-[10px] border border-line-strong bg-raised p-4 text-[13px] text-text shadow-[0_8px_28px_rgb(0_0_0/0.2)] outline-none">
                {facts}
              </Popover.Popup>
            </Popover.Positioner>
          </Popover.Portal>
        </Popover.Root>
        <IconButton
          label={t('session' in pane ? 'end.confirm' : 'terminal.endConfirm')}
          size="small"
          onClick={onEnd}
          className="hover:text-danger"
        >
          <Square {...SMALL_ICON} />
        </IconButton>
        {actions}
      </span>
    </div>
  )
}

function ViewSwitch({ shown, onShow }: { shown: View; onShow: (view: View) => void }) {
  const t = useI18n()
  const views: { value: View; label: string }[] = [
    { value: 'chat', label: t('session.chat') },
    { value: 'terminal', label: t('session.terminal') },
  ]
  return <Segmented compact label={t('session.view')} value={shown} onChange={onShow} segments={views} />
}
