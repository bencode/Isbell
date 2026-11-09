// Sharing a terminal by link, from the bar over a session: first what it means, then the link and
// how to stop. While shared, the mark stays in the bar with how many are watching.

import { Popover } from '@base-ui/react/popover'
import { Copy, Share2, TriangleAlert } from 'lucide-react'
import { useEffect, useState } from 'react'
import { IconButton, SMALL_ICON } from '../../components/icon-button'
import { errorText, useI18n } from '../../core/i18n'
import { useSpace, useSpaceView } from '../../core/space'
import type { Share } from '../../model/state'
import { useNow } from '../../utils/time'

const CALL_MS = 15_000
const MINUTE_MS = 60_000
const ACTION =
  'block h-9 w-full cursor-pointer rounded-lg font-semibold disabled:cursor-default disabled:opacity-50'
const NOTE = 'm-0 text-[13px] text-muted'

type Pane = { mid: string; paneId: string }

export function ShareControl({ mid, paneId }: Pane) {
  const t = useI18n()
  const [open, setOpen] = useState(false)
  const state = useSpaceView().machines.find(m => m.state.machine.id === mid)?.state
  if (!state?.caps.methods.includes('isbell.share.start')) return null
  const share = state.shares?.find(s => s.paneId === paneId)
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger
        render={
          share ? (
            <button
              type="button"
              className="inline-flex h-[22px] cursor-pointer items-center gap-1.5 rounded-full border border-danger/40 bg-danger/10 px-2.5 text-xs font-medium text-danger"
            >
              <span className="size-[7px] rounded-full bg-danger" />
              {t('share.watching', { n: share.viewers })}
            </button>
          ) : (
            <IconButton label={t('share.share')} size="small">
              <Share2 {...SMALL_ICON} />
            </IconButton>
          )
        }
      />
      <Popover.Portal>
        <Popover.Positioner side="bottom" align="end" sideOffset={6} className="z-50 outline-none">
          <Popover.Popup className="flex w-[330px] flex-col gap-2.5 rounded-xl border border-line-strong bg-raised p-3.5 text-sm text-text shadow-lg outline-none">
            {share ? (
              <Sharing mid={mid} paneId={paneId} share={share} onStopped={() => setOpen(false)} />
            ) : (
              <Start mid={mid} paneId={paneId} />
            )}
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  )
}

function Start({ mid, paneId }: Pane) {
  const t = useI18n()
  const space = useSpace()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<unknown>()
  // Once started, the machine's state brings the share and this gives way to it.
  const start = () => {
    setBusy(true)
    setError(undefined)
    space.call(mid, 'isbell.share.start', { paneId }, CALL_MS).catch((err: unknown) => {
      setBusy(false)
      setError(err)
    })
  }
  return (
    <>
      <h3 className="m-0 text-[14.5px] font-semibold">{t('share.title')}</h3>
      <p className={NOTE}>{t('share.about')}</p>
      <div className="flex gap-2 rounded-lg border border-warn/40 bg-warn/10 px-2.5 py-2 text-[12.5px]">
        <TriangleAlert {...SMALL_ICON} className="mt-0.5 flex-none text-warn" />
        <span>{t('share.warning')}</span>
      </div>
      <p className="m-0 text-[12.5px] text-faint">{t('share.terms')}</p>
      {error ? (
        <p className="m-0 text-[13px] text-danger">{t('share.failed', { msg: errorText(t, error) })}</p>
      ) : null}
      <button
        type="button"
        disabled={busy}
        onClick={start}
        className={`${ACTION} border-0 bg-accent text-accent-ink`}
      >
        {t('share.start')}
      </button>
    </>
  )
}

function Sharing({ mid, paneId, share, onStopped }: Pane & { share: Share; onStopped: () => void }) {
  const t = useI18n()
  const space = useSpace()
  const now = useNow()
  const [key, setKey] = useState<string>()
  const [copied, setCopied] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<unknown>()

  // Asked for here, as the machine's state does not carry it: that is kept by the relay.
  useEffect(() => {
    let gone = false
    space.call(mid, 'isbell.share.link', { paneId }, CALL_MS).then(
      answer => {
        if (!gone) setKey((answer as { key: string }).key)
      },
      (err: unknown) => {
        if (!gone) setError(err)
      },
    )
    return () => {
      gone = true
    }
  }, [space, mid, paneId])

  const url = key ? `${window.location.origin}/watch#${key}` : ''
  const copy = () => {
    navigator.clipboard.writeText(url).then(
      () => setCopied(true),
      (err: unknown) => setError(err),
    )
  }
  const stop = () => {
    setBusy(true)
    space.call(mid, 'isbell.share.stop', { paneId }, CALL_MS).then(onStopped, (err: unknown) => {
      setBusy(false)
      setError(err)
    })
  }
  const minutes = Math.max(0, Math.floor((share.expiresAt - now) / MINUTE_MS))

  return (
    <>
      <h3 className="m-0 flex items-center gap-2 text-[14.5px] font-semibold">
        <span className="size-[7px] rounded-full bg-danger" />
        {t('share.sharing')}
        <span className="ml-auto text-[12.5px] font-normal text-faint">
          {t('share.left', { h: Math.floor(minutes / 60), m: minutes % 60 })}
        </span>
      </h3>
      <div className="flex items-center gap-1.5 rounded-lg border border-line-strong bg-bg py-[3px] pr-[3px] pl-2.5">
        <code className="min-w-0 flex-1 truncate font-mono text-xs">{url}</code>
        <button
          type="button"
          disabled={!key}
          onClick={copy}
          className="inline-flex h-[30px] flex-none cursor-pointer items-center gap-1 rounded-md border-0 bg-accent px-2.5 text-[12.5px] font-semibold text-accent-ink disabled:opacity-50"
        >
          <Copy size={13} />
          {t(copied ? 'copied' : 'copy')}
        </button>
      </div>
      <p className={NOTE}>{t('share.note')}</p>
      {error ? <p className="m-0 text-[13px] text-danger">{errorText(t, error)}</p> : null}
      <button
        type="button"
        disabled={busy}
        onClick={stop}
        className={`${ACTION} border border-danger/40 bg-transparent text-danger`}
      >
        {t('share.stop')}
      </button>
    </>
  )
}
