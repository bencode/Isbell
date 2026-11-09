// What a session's tab shows: an agent's chat or its terminal (`view=terminal` in its part of the
// address), a shell's terminal. Hiding the tab lets go of the terminal, and it attaches anew once in
// sight again. A preview tab is kept once a reply is being written in it. Once its pane is
// gone, or its agent has left a shell behind while the chat shows, the session it ran takes the
// tab's place, when it is among those recorded.

import { useCallback, useEffect } from 'react'
import type { Params } from 'react-router'
import { useI18n } from '../../core/i18n'
import { sessionInPane, useRecordLookup } from '../../core/session-records'
import { useTabActions, useTabQuery, useTabRoute } from '../../core/tabs'
import type { Found } from '../../model/projects'
import { closedTabId, showsTerminal, withTerminal } from '../../model/tabs'
import { SessionView } from './session-view'
import type { View } from './subbar'
import { useFoundPane } from './use-found-pane'

/** `params`: the machine and the pane, from the tab's id. */
export function SessionTabPane({
  id,
  params: { mid = '', '*': paneId = '' },
}: {
  id: string
  params: Params
}) {
  const t = useI18n()
  const { found, waiting } = useFoundPane(mid, paneId)
  const listed = found !== undefined
  // The session it ran, when it is among those recorded, as only those can be resumed.
  const lookup = useRecordLookup()
  // A shell shown as a terminal is in use, and stays.
  const query = useTabQuery(id)
  const left = found && 'shell' in found.pane && !showsTerminal(query) ? found.pane.shell.ran : undefined
  const last = left ?? (!listed && !waiting ? sessionInPane(mid, paneId) : undefined)
  const ran = last && lookup(mid, last.agent, last.id) ? last : undefined
  const { replace } = useTabActions()
  useEffect(() => {
    if (ran) replace(id, closedTabId(mid, ran.agent, ran.id))
  }, [ran, replace, id, mid])

  if (!found || ran)
    return <p className="m-6 text-muted">{waiting || ran ? t('board.loading') : t('session.gone')}</p>
  return <Opened id={id} mid={mid} paneId={paneId} found={found} />
}

function Opened({ id, mid, paneId, found }: { id: string; mid: string; paneId: string; found: Found }) {
  const { close, keep, setQuery } = useTabActions()
  const keepTab = useCallback(() => keep(id), [keep, id])
  const shownTab = useTabRoute().shown
  const query = useTabQuery(id)
  const show = useCallback(
    (next: View) => setQuery(id, withTerminal(query, next === 'terminal')),
    [setQuery, id, query],
  )
  return (
    <SessionView
      mid={mid}
      paneId={paneId}
      found={found}
      terminal={showsTerminal(query)}
      onShow={show}
      onDraft={keepTab}
      onEnded={() => close(id, shownTab === id)}
    />
  )
}
