import { PaneBar } from '../../features/pane/pane-bar'
import type { PaneParts } from '../../features/pane/pane-layout'

/** A pane's terminal on a computer, the page's whole width, under the pane's own bar. */
export function DesktopPane({ found, onEnd, facts, children }: PaneParts) {
  return (
    <div className="flex h-full flex-col">
      <PaneBar found={found} onEnd={onEnd} facts={facts} showProject={false} />
      {children}
    </div>
  )
}
