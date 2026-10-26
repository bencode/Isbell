import { InfoPanel } from '../../components/info-panel'
import { useLocal } from '../../core/prefs'
import { PaneHeader } from '../../features/pane/pane-header'
import type { PaneParts } from '../../features/pane/pane-layout'

/** A pane page on a computer: the header, then the page with its facts beside it while shown. */
export function DesktopPane({ found, mid, paneId, view, onEnd, facts, children }: PaneParts) {
  const info = useLocal().layout.info
  return (
    <div className="flex h-full flex-col">
      <PaneHeader found={found} mid={mid} paneId={paneId} view={view} onEnd={onEnd} />
      <div className="flex min-h-0 flex-1">
        <div className="flex min-w-0 flex-1 flex-col">{children}</div>
        {info ? <InfoPanel>{facts}</InfoPanel> : null}
      </div>
    </div>
  )
}
