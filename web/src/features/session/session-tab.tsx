// What a session's tab shows: an agent's chat or its terminal, a shell's terminal, under the bar
// that names it. The terminal attaches once first shown and stays while the chat is; hiding the tab
// lets go of it, and it attaches anew once its terminal is in sight again. A preview tab is kept
// once a reply is being written in it.

import { useCallback, useEffect, useRef, useState } from 'react'
import { type Params, useLocation } from 'react-router'
import { useI18n } from '../../core/i18n'
import { useProjects, useSpace, useSpaceView } from '../../core/space'
import { useTabActions, useTabRoute } from '../../core/tabs'
import { useFilesRoots } from '../../core/worktrees'
import { rootHolding } from '../../model/files/worktrees'
import { type Found, locate } from '../../model/projects'
import { projectsSettled, type Via } from '../../model/space'
import { Chat } from './chat'
import { ShowTerminal } from './context'
import { EndPane } from './end-pane-dialog'
import { PaneFacts } from './session-parts'
import { Subbar, type View } from './subbar'
import { Terminal } from './terminal'

/** What an address asks of the tab `tab` it leads to: to show its terminal, or that it waits for a
 * pane just started, which the machine may not have listed yet. */
export type SessionOpening = { tab: string; view?: View; started?: boolean }

/** `params`: the machine and the pane, from the tab's id. */
export function SessionTabPane({
  id,
  params: { mid = '', '*': paneId = '' },
}: {
  id: string
  params: Params
}) {
  const t = useI18n()
  const space = useSpace()
  const view = useSpaceView()
  const found = locate(useProjects(), mid, paneId)
  const location = useLocation()
  const state = location.state as SessionOpening | null
  const asked = state?.tab === id ? state : undefined
  // Only as the tab opens: once the pane is listed, `seen` keeps it.
  const [started] = useState(asked?.started === true)
  const ready = projectsSettled(view)
  const listed = found !== undefined
  // Shells are pulled every so often; one opened a moment ago may not be listed yet.
  useEffect(() => {
    if (ready && !listed) void space.refreshShells(mid)
  }, [ready, listed, space, mid])
  // A pane just started counts as on its way until it has been seen.
  const [seen, setSeen] = useState(false)
  useEffect(() => {
    if (listed) setSeen(true)
  }, [listed])

  if (!found)
    return (
      <p className="m-6 text-muted">
        {!ready || (started && !seen) ? t('board.loading') : t('session.gone')}
      </p>
    )
  // A pane just started is listed as a shell until its agent is made out; it opens again as one then.
  const kind = 'session' in found.pane ? 'agent' : 'shell'
  return (
    <Opened
      key={kind}
      id={id}
      mid={mid}
      paneId={paneId}
      found={found}
      askedView={asked?.view}
      askedAt={location.key}
    />
  )
}

function Opened({
  id,
  mid,
  paneId,
  found: { project, pane },
  askedView,
  askedAt,
}: {
  id: string
  mid: string
  paneId: string
  found: Found
  /** A view an address asked for, and the visit that asked it (`location.key`). */
  askedView: View | undefined
  askedAt: string
}) {
  const { close, keep } = useTabActions()
  // `keep` is new each render; the draft asks once, when writing starts.
  const keepNow = useRef(keep)
  useEffect(() => {
    keepNow.current = keep
  })
  const keepTab = useCallback(() => keepNow.current(id), [id])
  const shownTab = useTabRoute().shown
  const agent = 'session' in pane ? pane.session : undefined
  const cwd = 'session' in pane ? (pane.session.cwd ?? project.path) : pane.shell.cwd
  const [shown, setShown] = useState<View>(agent ? (askedView ?? 'chat') : 'terminal')
  // The terminal, once shown, stays attached behind the chat.
  const [attached, setAttached] = useState(shown === 'terminal')
  const show = useCallback((next: View) => {
    setShown(next)
    if (next === 'terminal') setAttached(true)
  }, [])
  const showTerminal = useCallback(() => show('terminal'), [show])
  // An address asking again for a tab already open, such as `/t/` from a notification; each visit
  // asks once.
  const isAgent = agent !== undefined
  const answered = useRef(askedAt)
  useEffect(() => {
    if (!isAgent || !askedView || answered.current === askedAt) return
    answered.current = askedAt
    show(askedView)
  }, [isAgent, askedView, askedAt, show])
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
          view={agent ? { shown, onShow: show } : undefined}
          facts={
            <PaneFacts mid={mid} project={project} pane={pane} via={shown === 'terminal' ? via : 'calls'} />
          }
          onEnd={() => setEnding(true)}
        />
        <div className="relative min-h-0 flex-1">
          {agent ? (
            <div className={`absolute inset-0 ${shown === 'chat' ? '' : 'invisible'}`}>
              <Chat project={project} session={agent} onDraft={keepTab} />
            </div>
          ) : null}
          {attached ? (
            <div className={`absolute inset-0 ${shown === 'terminal' ? '' : 'hidden'}`}>
              <Terminal mid={mid} paneId={paneId} onVia={setVia} />
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
        onEnded={() => close(id, shownTab === id)}
      />
    </ShowTerminal>
  )
}
