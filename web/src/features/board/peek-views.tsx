// The pane open beside the board, in the view its address names (`?view=terminal`, else chat): an
// agent's chat or terminal, a shell's terminal. Once shown, the terminal stays attached while the
// chat shows, until another pane opens.

import { Activity, type ComponentType, useState } from 'react'
import { useParams, useSearchParams } from 'react-router'
import { useProjects } from '../../core/space'
import { locate, paneKey } from '../../model/projects'
import { PeekPane } from '../pane/peek-pane'
import { SessionPage } from '../pane/session-page'

/** A pane's terminal page beside the board, laid out by `PeekPane`; `after`, where to go once the
 * pane is ended. */
export type PeekTerminal = ComponentType<{ after: string }>

export function PeekViews({ terminal: Terminal, after }: { terminal: PeekTerminal; after: string }) {
  const { mid = '', pane = '' } = useParams()
  const [search] = useSearchParams()
  const found = locate(useProjects(), mid, pane)
  // A shell opened a moment ago may not be listed yet; its address names the terminal.
  const shell = found !== undefined && !('session' in found.pane)
  const showTerminal = shell || search.get('view') === 'terminal'
  const key = paneKey(mid, pane)
  const [attached, setAttached] = useState<string | null>(null)
  if (showTerminal && attached !== key) setAttached(key)
  return (
    <>
      {shell ? null : (
        <Activity mode={showTerminal ? 'hidden' : 'visible'}>
          <SessionPage layout={PeekPane} after={after} />
        </Activity>
      )}
      {/* Hidden by its style, not an Activity, which would end its effects and so detach it. */}
      {showTerminal || attached === key ? (
        <div className={showTerminal ? 'flex min-w-0 flex-1 flex-col' : 'hidden'}>
          <Terminal after={after} />
        </div>
      ) : null}
    </>
  )
}
