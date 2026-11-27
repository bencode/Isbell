// One share: its note, how long it lasts, its link, and the agents it shows, ticked by machine. A
// tick changes what its guests see at once; one change at a time, each from the share as listed.

import { Copy } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Button } from '../../../components/button'
import { changeShare, setPanes, shareLink, stopShare } from '../../../core/agent-shares'
import { errorText, useI18n } from '../../../core/i18n'
import { useProjects, useSpace, useSpaceView } from '../../../core/space'
import { LastsPicker, left } from '../../../features/files/share-button'
import { STATUS_DOTS } from '../../../features/session/session-row'
import { type AgentShare, holders, sharesAgents } from '../../../model/agent-share'
import type { Placed } from '../../../model/projects'
import { LASTS, type Lasts } from '../../../model/share'
import { useNow } from '../../../utils/time'

/** The shortest of the choices that holds what is left, for the picker to show. */
const lastsFor = (ms: number) => (Object.keys(LASTS) as Lasts[]).find(l => LASTS[l] >= ms) ?? '7d'

/** `justMade`: made a moment ago, so its link is copied as soon as it is known. */
export function ShareDetail({ share, justMade }: { share: AgentShare; justMade: boolean }) {
  const t = useI18n()
  const space = useSpace()
  const now = useNow()
  const [name, setName] = useState(share.name)
  const [link, setLink] = useState<string>()
  const [copied, setCopied] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<unknown>()

  const copy = (text: string) =>
    navigator.clipboard.writeText(text).then(
      () => setCopied(true),
      (err: unknown) => setError(err),
    )
  // Asked for here, as the list carries no keys; a machine holding it now gives the same one.
  const [holder] = holders(share)
  useEffect(() => {
    if (!holder) return
    let gone = false
    shareLink(space, holder, share.id)
      .then(url => {
        if (gone) return
        setLink(url)
        return justMade ? navigator.clipboard.writeText(url).then(() => setCopied(true)) : undefined
      })
      .catch((err: unknown) => {
        if (!gone) setError(err)
      })
    return () => {
      gone = true
    }
  }, [space, holder, share.id, justMade])

  const act = (work: () => Promise<unknown>) => {
    setBusy(true)
    setError(undefined)
    work()
      .catch((err: unknown) => setError(err))
      .finally(() => setBusy(false))
  }
  const rename = () => {
    const next = name.trim()
    if (next && next !== share.name) act(() => changeShare(space, share, { name: next }))
    else setName(share.name)
  }

  return (
    <div className="flex flex-col">
      <div className="flex flex-col gap-2.5 border-b border-line px-3 pt-2.5 pb-3">
        <label className="flex items-center gap-2.5 text-[13px]">
          <span className="w-10 flex-none text-muted">{t('agentShare.name')}</span>
          <input
            value={name}
            onChange={e => setName(e.target.value)}
            onBlur={rename}
            onKeyDown={e => {
              if (e.key === 'Enter') e.currentTarget.blur()
            }}
            maxLength={64}
            className="h-7 min-w-0 flex-1 rounded-md border border-line-strong bg-bg px-2 text-[13px] text-text outline-none focus-visible:border-accent"
          />
        </label>
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
          <LastsPicker
            value={lastsFor(share.expiresAt - now)}
            onChange={lasts => act(() => changeShare(space, share, { lasts }))}
          />
          <span className="text-[11.5px] text-faint">{left(t, share.expiresAt - now)}</span>
        </div>
        <code className="h-7 truncate rounded-md border border-line-strong bg-bg px-2 font-mono text-xs leading-[26px] text-muted">
          {link ?? ''}
        </code>
        <div className="flex items-center gap-1.5">
          <Button size="small" disabled={!link} onClick={() => link && void copy(link)}>
            <Copy size={13} />
            {t(copied ? 'copied' : 'copy')}
          </Button>
          <Button
            size="small"
            variant="end"
            className="ml-auto"
            disabled={busy}
            onClick={() => act(() => stopShare(space, share))}
          >
            {t('share.stop')}
          </Button>
        </div>
        {error ? <p className="m-0 text-[12.5px] text-danger">{errorText(t, error)}</p> : null}
      </div>
      <Picks
        share={share}
        busy={busy}
        onPick={(mid, panes) => act(() => setPanes(space, share, mid, panes))}
      />
    </div>
  )
}

/** The agents running, by machine, each ticked when the share shows it. A machine that cannot share
 * its agents is shown, greyed. */
function Picks({
  share,
  busy,
  onPick,
}: {
  share: AgentShare
  busy: boolean
  onPick: (mid: string, panes: string[]) => void
}) {
  const t = useI18n()
  const { machines } = useSpaceView()
  const placed: Placed[] = useProjects()
    .filter(p => p.online)
    .flatMap(project => project.sessions.map(session => ({ session, project })))
  const groups = machines
    .filter(m => m.online)
    .map(m => ({ m, list: placed.filter(p => p.session.mid === m.state.machine.id) }))
    .filter(g => g.list.length)
  if (!groups.length)
    return <p className="m-0 px-3.5 py-3 text-[13px] text-muted">{t('agentShare.noAgents')}</p>
  return (
    <div className="flex flex-col p-1.5">
      {groups.map(({ m, list }) => {
        const mid = m.state.machine.id
        const able = sharesAgents(m)
        const shown = share.panes[mid] ?? []
        const pick = (pane: string, on: boolean) =>
          onPick(mid, on ? [...shown, pane] : shown.filter(p => p !== pane))
        return (
          <section key={mid} className={able ? '' : 'opacity-50'}>
            <h4 className="m-0 flex gap-1.5 px-2 pt-2 pb-0.5 text-[11px] font-semibold text-muted">
              {m.state.machine.name}
              {able ? null : <span className="font-normal text-warn">{t('agentShare.old')}</span>}
            </h4>
            {list.map(({ session, project }) => (
              <label
                key={session.paneId}
                className={`grid grid-cols-[16px_6px_minmax(0,1fr)_auto] items-center gap-x-2 rounded-[7px] px-2 py-[5px] text-[13px] ${able ? 'cursor-pointer hover:bg-hover' : ''}`}
              >
                <input
                  type="checkbox"
                  className="m-0 accent-accent"
                  checked={shown.includes(session.paneId)}
                  disabled={!able || busy}
                  onChange={e => pick(session.paneId, e.target.checked)}
                />
                <span
                  aria-hidden
                  className={`size-1.5 rounded-full ${(session.status && STATUS_DOTS[session.status]) || 'bg-line-strong'}`}
                />
                <span className="truncate">{session.title ?? session.name}</span>
                <span className="truncate text-[11.5px] text-faint">{project.name}</span>
              </label>
            ))}
          </section>
        )
      })}
      <p className="m-0 px-2 pt-2 text-[11.5px] text-faint">{t('agentShare.pick')}</p>
    </div>
  )
}
