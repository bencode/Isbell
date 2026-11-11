// Sharing a page by link, from its bar: first what the link opens and for how long, then the link,
// how long it has left, and how to stop it. While shared, the mark stays in the bar.

import { Popover } from '@base-ui/react/popover'
import { Copy, Share2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { IconButton, SMALL_ICON } from '../../components/icon-button'
import { Segmented } from '../../components/segmented'
import { errorText, type T, useI18n } from '../../core/i18n'
import { useSpace, useSpaceView } from '../../core/space'
import { join } from '../../model/files/paths'
import type { FilesRoot } from '../../model/files/worktrees'
import { DEFAULT_LASTS, LASTS, type Lasts, shareUrl } from '../../model/share'
import type { Share } from '../../model/state'
import { useNow } from '../../utils/time'

const CALL_MS = 15_000
const MINUTE_MS = 60_000
const ACTION =
  'block h-9 w-full cursor-pointer rounded-lg font-semibold disabled:cursor-default disabled:opacity-50'
const NOTE = 'm-0 text-[13px] text-muted'

/** The file a view shows, for sharing it. */
export type ShareTarget = { mid: string; root: FilesRoot; rel: string }

/** What starting a share, or asking for its link, answers. */
type Started = { id: string; key: string; entry: string; expiresAt: number }

export function ShareButton({ mid, root, rel }: ShareTarget) {
  const t = useI18n()
  const [open, setOpen] = useState(false)
  const [lasts, setLasts] = useState<Lasts>(DEFAULT_LASTS)
  const state = useSpaceView().machines.find(m => m.state.machine.id === mid)?.state
  if (!state?.caps.methods.includes('isbell.share.start')) return null
  const path = join(root.path, rel)
  const share = state.shares?.find(s => s.path === path)
  const panel = { mid, path, root: root.path, lasts, setLasts }
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger
        render={
          share ? (
            <button
              type="button"
              className="mr-1 inline-flex h-[22px] flex-none cursor-pointer items-center gap-1.5 rounded-full border border-accent/40 bg-accent/10 px-2.5 text-xs font-medium text-accent"
            >
              <span className="size-[7px] rounded-full bg-accent" />
              {t('share.sharing')}
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
          <Popover.Popup className="flex w-[340px] flex-col gap-2.5 rounded-xl border border-line-strong bg-raised p-3.5 text-sm text-text shadow-lg outline-none">
            {share ? (
              <Sharing key={share.id} {...panel} share={share} onStopped={() => setOpen(false)} />
            ) : (
              <Start {...panel} shown={root.display} />
            )}
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  )
}

type Panel = {
  mid: string
  path: string
  /** What its readers read under: the root the file is shown under here. */
  root: string
  lasts: Lasts
  setLasts: (lasts: Lasts) => void
}

/** Starts sharing `path`, or gives one shared a new end: it then lasts `lasts` from now. */
function useStart({ mid, path, root, setLasts }: Panel) {
  const space = useSpace()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<unknown>()
  const start = (lasts: Lasts) => {
    setLasts(lasts)
    setBusy(true)
    setError(undefined)
    space
      .call(mid, 'isbell.share.start', { path, root, lastsMs: LASTS[lasts] }, CALL_MS)
      .catch((err: unknown) => setError(err))
      .finally(() => setBusy(false))
  }
  return { start, busy, error }
}

function LastsPicker({ value, onChange }: { value: Lasts; onChange: (lasts: Lasts) => void }) {
  const t = useI18n()
  return (
    <div className="flex items-center gap-2.5">
      <span className="text-[13px] text-muted">{t('share.lasts')}</span>
      <Segmented
        label={t('share.lasts')}
        value={value}
        onChange={onChange}
        segments={(Object.keys(LASTS) as Lasts[]).map(l => ({ value: l, label: t(`share.lasts.${l}`) }))}
      />
    </div>
  )
}

function Start(props: Panel & { shown: string }) {
  const t = useI18n()
  const { start, busy, error } = useStart(props)
  // Once started, the machine's state brings the share and this gives way to it.
  return (
    <>
      <h3 className="m-0 text-[14.5px] font-semibold">{t('share.share')}</h3>
      <p className={NOTE}>{t('share.about', { root: props.shown })}</p>
      <LastsPicker value={props.lasts} onChange={props.setLasts} />
      {error ? (
        <p className="m-0 text-[13px] text-danger">{t('share.failed', { msg: errorText(t, error) })}</p>
      ) : null}
      <button
        type="button"
        disabled={busy}
        onClick={() => start(props.lasts)}
        className={`${ACTION} border-0 bg-accent text-accent-ink`}
      >
        {t('share.start')}
      </button>
    </>
  )
}

function Sharing(props: Panel & { share: Share; onStopped: () => void }) {
  const { mid, share, onStopped } = props
  const t = useI18n()
  const space = useSpace()
  const now = useNow()
  const { start, busy: changing, error: changeError } = useStart(props)
  const [link, setLink] = useState<string>()
  const [copied, setCopied] = useState(false)
  const [stopping, setStopping] = useState(false)
  const [error, setError] = useState<unknown>()

  // Asked for here, as the machine's state does not carry it: that is kept by the relay.
  useEffect(() => {
    let gone = false
    space.call(mid, 'isbell.share.link', { id: share.id }, CALL_MS).then(
      answer => {
        const { key, entry } = answer as Started
        if (!gone) setLink(shareUrl(window.location.origin, key, entry))
      },
      (err: unknown) => {
        if (!gone) setError(err)
      },
    )
    return () => {
      gone = true
    }
  }, [space, mid, share.id])

  const copy = () => {
    if (!link) return
    navigator.clipboard.writeText(link).then(
      () => setCopied(true),
      (err: unknown) => setError(err),
    )
  }
  const stop = () => {
    setStopping(true)
    space.call(mid, 'isbell.share.stop', { id: share.id }, CALL_MS).then(onStopped, (err: unknown) => {
      setStopping(false)
      setError(err)
    })
  }
  const shown = error ?? changeError

  return (
    <>
      <h3 className="m-0 flex items-center gap-2 text-[14.5px] font-semibold">
        <span className="size-[7px] rounded-full bg-accent" />
        {t('share.sharing')}
        <span className="ml-auto text-[12.5px] font-normal text-faint">{left(t, share.expiresAt - now)}</span>
      </h3>
      <div className="flex items-center gap-1.5 rounded-lg border border-line-strong bg-bg py-[3px] pr-[3px] pl-2.5">
        <code className="min-w-0 flex-1 truncate font-mono text-xs">{link ?? ''}</code>
        <button
          type="button"
          disabled={!link}
          onClick={copy}
          className="inline-flex h-[30px] flex-none cursor-pointer items-center gap-1 rounded-md border-0 bg-accent px-2.5 text-[12.5px] font-semibold text-accent-ink disabled:opacity-50"
        >
          <Copy size={13} />
          {t(copied ? 'copied' : 'copy')}
        </button>
      </div>
      <LastsPicker value={props.lasts} onChange={start} />
      <p className={NOTE}>{t('share.note')}</p>
      {shown ? <p className="m-0 text-[13px] text-danger">{errorText(t, shown)}</p> : null}
      <button
        type="button"
        disabled={stopping || changing}
        onClick={stop}
        className={`${ACTION} border border-danger/40 bg-transparent text-danger`}
      >
        {t('share.stop')}
      </button>
    </>
  )
}

/** How long a share has left, to the minute. */
function left(t: T, ms: number) {
  const minutes = Math.max(0, Math.floor(ms / MINUTE_MS))
  const [d, h, m] = [Math.floor(minutes / 1440), Math.floor(minutes / 60) % 24, minutes % 60]
  return d ? t('share.leftDays', { d, h }) : t('share.left', { h, m })
}
