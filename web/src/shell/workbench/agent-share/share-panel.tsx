// The user's agent shares, over the right column's Agents: the shares, a new one, and one open to
// tick the agents it shows. Opened from the column's bar, and left open as it was.

import { ChevronLeft, ChevronRight, Plus, Share2, X } from 'lucide-react'
import { useState } from 'react'
import { Button } from '../../../components/button'
import { IconButton, SMALL_ICON } from '../../../components/icon-button'
import { startShare, useAgentShares } from '../../../core/agent-shares'
import { errorText, useI18n } from '../../../core/i18n'
import { setAgentSharesOpen, useLocal } from '../../../core/prefs'
import { useSpace, useSpaceView } from '../../../core/space'
import { LastsPicker, left } from '../../../features/files/share-button'
import { type AgentShare, paneCount, sharesAgents } from '../../../model/agent-share'
import { DEFAULT_LASTS, type Lasts } from '../../../model/share'
import { useNow } from '../../../utils/time'
import { ShareDetail } from './share-detail'

/** In the column's bar: opens the shares over the column, or closes them. */
export function ShareToggle() {
  const t = useI18n()
  const open = useLocal().layout.agentSharesOpen
  return (
    <IconButton
      label={t(open ? 'agentShare.close' : 'agentShare.open')}
      size="small"
      aria-pressed={open}
      className="aria-pressed:bg-selected aria-pressed:text-text"
      onClick={() => setAgentSharesOpen(!open)}
    >
      <Share2 {...SMALL_ICON} />
    </IconButton>
  )
}

type At = { at: 'list' } | { at: 'new' } | { at: 'share'; id: string; justMade: boolean }

/** Covers the column it is in, which is to be `relative`. */
export function SharePanel() {
  const t = useI18n()
  const shares = useAgentShares()
  const [at, setAt] = useState<At>({ at: 'list' })
  const share = at.at === 'share' ? shares.find(s => s.id === at.id) : undefined
  // One stopped, or run out, gives way to the list.
  const shown = at.at === 'share' && !share ? 'list' : at.at
  const title =
    shown === 'share' && share ? share.name : t(shown === 'new' ? 'agentShare.new' : 'agentShare.title')
  const toList = () => setAt({ at: 'list' })
  return (
    <section
      aria-label={t('agentShare.title')}
      className="absolute inset-0 z-10 flex flex-col border-t border-line bg-raised"
    >
      <header className="flex h-9 flex-none items-center gap-1 border-b border-line pr-1.5 pl-1.5 text-[13px] font-semibold">
        {shown === 'list' ? null : (
          <IconButton label={t('agentShare.back')} size="small" onClick={toList}>
            <ChevronLeft {...SMALL_ICON} />
          </IconButton>
        )}
        <span className="min-w-0 truncate px-1">{title}</span>
        <IconButton
          label={t('agentShare.close')}
          size="small"
          className="ml-auto"
          onClick={() => setAgentSharesOpen(false)}
        >
          <X {...SMALL_ICON} />
        </IconButton>
      </header>
      <div className="min-h-0 flex-1 overflow-auto">
        {shown === 'new' ? (
          <NewShare
            count={shares.length}
            onMade={id => setAt({ at: 'share', id, justMade: true })}
            onCancel={toList}
          />
        ) : at.at === 'share' && share ? (
          <ShareDetail key={share.id} share={share} justMade={at.justMade} />
        ) : (
          <ShareList
            shares={shares}
            onOpen={id => setAt({ at: 'share', id, justMade: false })}
            onNew={() => setAt({ at: 'new' })}
          />
        )}
      </div>
    </section>
  )
}

function ShareList({
  shares,
  onOpen,
  onNew,
}: {
  shares: AgentShare[]
  onOpen: (id: string) => void
  onNew: () => void
}) {
  const t = useI18n()
  const now = useNow()
  const able = useSpaceView().machines.some(sharesAgents)
  if (!able) return <p className="m-0 px-3.5 py-3 text-[13px] text-muted">{t('agentShare.noMachine')}</p>
  return (
    <div className="flex flex-col p-1.5">
      {shares.length ? null : (
        <p className="m-0 px-2 pt-1.5 pb-2 text-[12.5px] text-muted">{t('agentShare.none')}</p>
      )}
      {shares.map(share => (
        <button
          key={share.id}
          type="button"
          onClick={() => onOpen(share.id)}
          className="grid cursor-pointer grid-cols-[16px_minmax(0,1fr)_auto] items-center gap-x-2 rounded-[7px] border-0 bg-transparent px-2 py-1.5 text-left hover:bg-hover focus-visible:outline-2 focus-visible:outline-accent"
        >
          <Share2 size={12} className="text-accent" />
          <span className="truncate text-[13px] font-medium text-text">{share.name}</span>
          <ChevronRight size={13} className="text-faint" />
          <span className="col-start-2 truncate text-[11.5px] text-faint">
            {paneCount(share) === 1 ? t('agentShare.agent') : t('agentShare.agents', { n: paneCount(share) })}{' '}
            · {left(t, share.expiresAt - now)}
          </span>
        </button>
      ))}
      <button
        type="button"
        onClick={onNew}
        className="flex cursor-pointer items-center gap-1.5 rounded-[7px] border-0 bg-transparent px-2 py-1.5 text-left text-[13px] text-accent hover:bg-hover focus-visible:outline-2 focus-visible:outline-accent"
      >
        <Plus size={14} />
        {t('agentShare.new')}
      </button>
    </div>
  )
}

/** A share made on the first machine that can share agents; the others take it on as their agents
 * are ticked. */
function NewShare({
  count,
  onMade,
  onCancel,
}: {
  count: number
  onMade: (id: string) => void
  onCancel: () => void
}) {
  const t = useI18n()
  const space = useSpace()
  const machine = useSpaceView().machines.find(sharesAgents)
  const [name, setName] = useState('')
  const [lasts, setLasts] = useState<Lasts>(DEFAULT_LASTS)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<unknown>()
  const fallback = t('agentShare.unnamed', { n: count + 1 })
  const make = () => {
    if (!machine) return
    setBusy(true)
    setError(undefined)
    startShare(space, machine.state.machine.id, name.trim() || fallback, lasts).then(
      onMade,
      (err: unknown) => {
        setBusy(false)
        setError(err)
      },
    )
  }
  return (
    <form
      className="flex flex-col gap-3 p-3.5"
      onSubmit={e => {
        e.preventDefault()
        make()
      }}
    >
      <label className="flex items-center gap-2.5 text-[13px]">
        <span className="text-muted">{t('agentShare.name')}</span>
        <input
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder={fallback}
          maxLength={64}
          className="h-[30px] min-w-0 flex-1 rounded-md border border-line-strong bg-bg px-2 text-[13px] text-text outline-none focus-visible:border-accent"
        />
      </label>
      <LastsPicker value={lasts} onChange={setLasts} />
      <p className="m-0 rounded-md bg-bg px-2.5 py-2 text-[12px] leading-relaxed text-muted">
        {t('agentShare.warn')}
      </p>
      {error ? <p className="m-0 text-[13px] text-danger">{errorText(t, error)}</p> : null}
      <div className="flex justify-end gap-1.5">
        <Button size="small" variant="quiet" onClick={onCancel}>
          {t('cancel')}
        </Button>
        <Button size="small" variant="primary" type="submit" disabled={busy || !machine}>
          {t('agentShare.create')}
        </Button>
      </div>
    </form>
  )
}
