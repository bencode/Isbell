// What a session's tab shows: an agent's chat or its terminal (`view=terminal` in its part of the
// address), a shell's terminal, under the bar that names it. The terminal attaches once first shown
// and stays while the chat is; hiding the tab lets go of it, and it attaches anew once its terminal
// is in sight again. A preview tab is kept once a reply is being written in it. Once its pane is
// gone, the session it ran takes the tab's place, when it is among those recorded.

import { useCallback, useEffect, useState } from 'react'
import type { Params } from 'react-router'
import { useI18n } from '../../core/i18n'
import { sessionInPane, usePaneSession, useRecordLookup } from '../../core/session-records'
import { useProjects, useSpace, useSpaceView } from '../../core/space'
import { useTabActions, useTabQuery, useTabRoute } from '../../core/tabs'
import { useFilesRoots } from '../../core/worktrees'
import { rootHolding } from '../../model/files/worktrees'
import { type Found, locate } from '../../model/projects'
import { projectsSettled, type Via } from '../../model/space'
import { closedTabId, showsTerminal, withTerminal } from '../../model/tabs'
import { Chat } from './chat'
import { ShowTerminal } from './context'
import { EndPane } from './end-pane-dialog'
import { PaneFacts } from './session-parts'
import { Subbar, type View } from './subbar'
import { Terminal } from './terminal'

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
  const ready = projectsSettled(view)
  const listed = found !== undefined
  // Panes are pulled every so often, and one started a moment ago may not be listed yet: it is gone
  // only once the machine, asked again, does not list it. Not answered, it is asked again once the
  // tab shows again.
  const [checked, setChecked] = useState(false)
  useEffect(() => {
    // Listed again, it is checked anew once it goes.
    if (listed) setChecked(false)
    if (!ready || listed) return
    let live = true
    void space.refreshShells(mid).then(listedNow => {
      if (live && listedNow) setChecked(true)
    })
    return () => {
      live = false
    }
  }, [ready, listed, space, mid])
  const waiting = !ready || (!listed && !checked)
  // The session it ran, when it is among those recorded, as only those can be resumed.
  const lookup = useRecordLookup()
  const last = !listed && !waiting ? sessionInPane(mid, paneId) : undefined
  const ran = last && lookup(mid, last.agent, last.id) ? last : undefined
  const { replace } = useTabActions()
  useEffect(() => {
    if (ran) replace(id, closedTabId(mid, ran.agent, ran.id))
  }, [ran, replace, id, mid])

  if (!found)
    return <p className="m-6 text-muted">{waiting || ran ? t('board.loading') : t('session.gone')}</p>
  return <Opened id={id} mid={mid} paneId={paneId} found={found} />
}

function Opened({
  id,
  mid,
  paneId,
  found: { project, pane },
}: {
  id: string
  mid: string
  paneId: string
  found: Found
}) {
  const { close, keep, setQuery } = useTabActions()
  const keepTab = useCallback(() => keep(id), [keep, id])
  const shownTab = useTabRoute().shown
  const agent = 'session' in pane ? pane.session : undefined
  const ran = usePaneSession(mid, paneId, agent?.kind, agent?.status)
  const cwd = 'session' in pane ? (pane.session.cwd ?? project.path) : pane.shell.cwd
  // As the address has it; a pane just started is listed as a shell until its agent is made out.
  const query = useTabQuery(id)
  const shown: View = agent && !showsTerminal(query) ? 'chat' : 'terminal'
  const show = useCallback(
    (next: View) => setQuery(id, withTerminal(query, next === 'terminal')),
    [setQuery, id, query],
  )
  const showTerminal = useCallback(() => show('terminal'), [show])
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
          view={agent ? { shown, onShow: show } : undefined}
          facts={
            <PaneFacts mid={mid} project={project} pane={pane} via={shown === 'terminal' ? via : 'calls'} />
          }
          onEnd={() => setEnding(true)}
        />
        <div className="relative min-h-0 flex-1">
          {agent ? (
            <div className={`absolute inset-0 ${shown === 'chat' ? '' : 'invisible'}`}>
              <Chat project={project} session={agent} ran={ran} onDraft={keepTab} />
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
