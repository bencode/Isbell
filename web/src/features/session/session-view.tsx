// A session or a shell, in whichever place shows it, its tab or the peek: the bar that names it, its
// chat and its terminal. The place says which of the two is wanted, and what writing to it and ending
// it mean there. The terminal attaches once first shown and stays while the chat is.

import { lazy, type ReactNode, Suspense, useCallback, useState } from 'react'
import { usePaneSession } from '../../core/session-records'
import { useFilesRoots } from '../../core/worktrees'
import { rootHolding } from '../../model/files/worktrees'
import type { Found } from '../../model/projects'
import type { Via } from '../../model/space'
import { Chat } from './chat'
import { ShowTerminal } from './context'
import { EndPane } from './end-pane-dialog'
import { PaneFacts } from './session-parts'
import { Subbar, type View } from './subbar'

// With xterm, which a chat alone does not need.
const Terminal = lazy(() => import('./terminal').then(m => ({ default: m.Terminal })))

type Props = {
  mid: string
  paneId: string
  found: Found
  /** Whether the place wants the terminal; a shell has nothing else to show. */
  terminal: boolean
  onShow: (view: View) => void
  /** A reply is being written. */
  onDraft: () => void
  onEnded: () => void
  /** What the place adds to the bar. */
  actions?: ReactNode
}

export function SessionView({
  mid,
  paneId,
  found: { project, pane },
  terminal,
  onShow,
  onDraft,
  onEnded,
  actions,
}: Props) {
  const agent = 'session' in pane ? pane.session : undefined
  const ran = usePaneSession(mid, paneId, agent?.kind, agent?.status)
  const cwd = 'session' in pane ? (pane.session.cwd ?? project.path) : pane.shell.cwd
  // A pane just started is listed as a shell until its agent is made out.
  const shown: View = agent && !terminal ? 'chat' : 'terminal'
  const showTerminal = useCallback(() => onShow('terminal'), [onShow])
  // The terminal, once shown, stays attached behind the chat.
  const [attached, setAttached] = useState(shown === 'terminal')
  if (shown === 'terminal' && !attached) setAttached(true)
  const [via, setVia] = useState<Via>()
  const [ending, setEnding] = useState(false)
  const { roots } = useFilesRoots(project)
  const branch = roots.length ? (rootHolding(roots, cwd)?.root.branch ?? null) : undefined

  return (
    <ShowTerminal value={showTerminal}>
      <div className="flex h-full flex-col">
        <Subbar
          pane={pane}
          branch={branch}
          view={agent ? { shown, onShow } : undefined}
          facts={
            <PaneFacts mid={mid} project={project} pane={pane} via={shown === 'terminal' ? via : 'calls'} />
          }
          onEnd={() => setEnding(true)}
          actions={actions}
        />
        <div className="relative min-h-0 flex-1">
          {agent ? (
            <div className={`absolute inset-0 ${shown === 'chat' ? '' : 'invisible'}`}>
              <Chat project={project} session={agent} ran={ran} onDraft={onDraft} />
            </div>
          ) : null}
          {attached ? (
            <div className={`absolute inset-0 ${shown === 'terminal' ? '' : 'hidden'}`}>
              <Suspense>
                <Terminal mid={mid} paneId={paneId} machine={project.machine} onVia={setVia} />
              </Suspense>
            </div>
          ) : null}
        </div>
      </div>
      <EndPane
        open={ending}
        onOpenChange={setEnding}
        mid={mid}
        paneId={paneId}
        name={agent?.name ?? paneId}
        machine={project.machine}
        path={project.display}
        agent={!!agent}
        onEnded={onEnded}
      />
    </ShowTerminal>
  )
}
