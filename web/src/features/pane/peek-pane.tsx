// A session open beside the board: its bar, with a way into its terminal and a way to close it,
// then the page. The project shows on the bar only when the board is every agent's.

import { Maximize2, X } from 'lucide-react'
import { Link, useParams } from 'react-router'
import { useI18n } from '../../core/i18n'
import { boardHref, terminalHref } from '../../utils/hrefs'
import { BAR_ICON, PaneBar } from './pane-bar'
import type { PaneParts } from './pane-layout'

export function PeekPane({ found, mid, paneId, onEnd, facts, children }: PaneParts) {
  const t = useI18n()
  const { key } = useParams()
  return (
    <div className="flex h-full min-w-0 flex-1 flex-col">
      <PaneBar
        found={found}
        onEnd={onEnd}
        facts={facts}
        showProject={!key}
        before={
          <Link
            to={terminalHref(mid, paneId)}
            aria-label={t('pane.terminal')}
            title={t('pane.terminal')}
            className={BAR_ICON}
          >
            <Maximize2 size={15} />
          </Link>
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
