// A pane open beside the board: its bar, with a way back to the lanes while they are folded, an
// agent's chat and terminal to switch between, and a way to close it; then the page. The project
// shows on the bar only when the board is every agent's.

import { ChevronsRight, X } from 'lucide-react'
import { createContext, useContext } from 'react'
import { Link, useParams } from 'react-router'
import { ViewTabs } from '../../components/view-tabs'
import { useI18n } from '../../core/i18n'
import { boardHref, peekHref, peekTerminalHref } from '../../utils/hrefs'
import { BAR_ICON, PaneBar } from './pane-bar'
import type { PaneParts } from './pane-layout'

/** The lanes beside the pane, as the board folds them. */
export type LanesFold = {
  /** Folded and done moving: the way back shows. */
  folded: boolean
  /** Agents asking for an answer on this board, the one open here aside. */
  asking: number
  unfold: () => void
}

export const LanesFoldContext = createContext<LanesFold | undefined>(undefined)

export function PeekPane({ found, mid, paneId, view, onEnd, facts, children }: PaneParts) {
  const t = useI18n()
  const { key } = useParams()
  const fold = useContext(LanesFoldContext)
  // A shell has no chat.
  const agent = 'session' in found.pane
  return (
    <div className="flex h-full min-w-0 flex-1 flex-col">
      <PaneBar
        found={found}
        onEnd={onEnd}
        facts={facts}
        showProject={!key}
        lead={fold?.folded ? <UnfoldButton fold={fold} /> : undefined}
        views={
          agent ? (
            <ViewTabs
              label={t('pane.views')}
              current={view}
              views={[
                { key: 'chat', href: peekHref(key, mid, paneId), icon: null, label: t('pane.chat') },
                {
                  key: 'terminal',
                  href: peekTerminalHref(key, mid, paneId),
                  icon: null,
                  label: t('pane.terminal'),
                },
              ]}
            />
          ) : undefined
        }
        after={
          <Link to={boardHref(key)} aria-label={t('peek.close')} title={t('peek.close')} className={BAR_ICON}>
            <X size={16} />
          </Link>
        }
      />
      {children}
    </div>
  )
}

/** Unfolds the lanes; says how many on them ask for an answer. The board finds it by `data-unfold`
 * to hand it the focus once the lanes have folded. */
function UnfoldButton({ fold: { asking, unfold } }: { fold: LanesFold }) {
  const t = useI18n()
  const label = asking ? t('peek.unfoldAsking', { n: asking }) : t('peek.unfold')
  return (
    <button
      type="button"
      data-unfold
      onClick={unfold}
      aria-expanded={false}
      aria-label={label}
      title={label}
      className={`${BAR_ICON} mr-1 w-auto! gap-1 px-1.5`}
    >
      <ChevronsRight size={16} />
      {asking ? (
        <span className="min-w-[17px] rounded-full bg-warn px-1 text-center font-mono text-[10.5px] leading-[17px] font-semibold text-bg">
          {asking}
        </span>
      ) : null}
    </button>
  )
}
