import { Popover } from '@base-ui/react/popover'
import { Check, ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react'
import { useState } from 'react'
import { errorText, useI18n } from '../../core/i18n'
import { readPicker } from '../../model/screen'
import type { Picker, PickerItem } from '../../model/screen/picker'
import { type Pane, press, submit, until } from './agent-keys'

// The rows of a menu that tell one screen of it from the next.
const shownAs = (p: Picker | undefined) =>
  p ? [p.heading[0], p.cursor, p.effort, ...p.items.map(i => i.n)].join('\n') : ''

// The keys a menu takes when it does not say: choose, and back out.
const PLAIN = [
  { key: 'Enter', label: 'Enter' },
  { key: 'Esc', label: 'Esc' },
]
// Esc steps back a level of a menu; Codex's has two.
const LEVELS = 3

/** The agent's /model menu, mirrored: it shows what the menu shows, and each click presses the keys
 * that do the same in it. Once the menu is gone, the change is made or given up. */
export function PickerRemote({
  pane,
  label,
  disabled,
  onDone,
}: {
  pane: Pane
  label: string
  disabled: boolean
  onDone: () => void
}) {
  const t = useI18n()
  const [open, setOpen] = useState(false)
  const [picker, setPicker] = useState<Picker>()
  // Items seen as the menu scrolled, by number; a new menu (the next level, a question) starts over.
  const [seen, setSeen] = useState<PickerItem[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()

  const show = (next: Picker, was: Picker | undefined) => {
    const same = was?.heading[0] === next.heading[0]
    setSeen(prev =>
      [...(same ? prev.filter(i => !next.items.some(n => n.n === i.n)) : []), ...next.items].sort(
        (a, b) => a.n - b.n,
      ),
    )
    setPicker(next)
  }
  const finish = () => {
    setOpen(false)
    setPicker(undefined)
    setSeen([])
    onDone()
  }
  const run = async (work: () => Promise<void>) => {
    setBusy(true)
    setError(undefined)
    try {
      await work()
    } catch (err) {
      console.error('could not work the menu', err)
      setError(errorText(t, err))
    } finally {
      setBusy(false)
    }
  }

  const start = () =>
    run(async () => {
      await submit(pane, '/model')
      const next = await until(pane, readPicker, Boolean)
      if (next) show(next, undefined)
      else setError(t('status.pickerLost'))
    })

  /** Presses `keys` and shows the menu as it comes to be, or finishes once it is gone. */
  const act = (
    keys: string[],
    done: (p: Picker | undefined) => boolean = p => shownAs(p) !== shownAs(picker),
  ) =>
    run(async () => {
      await press(pane, keys)
      const next = await until(pane, readPicker, p => !p || done(p))
      if (next) show(next, picker)
      else finish()
    })

  const moveTo = (n: number) => {
    const d = n - (picker?.cursor ?? n)
    if (d)
      void act(
        Array.from({ length: Math.abs(d) }, () => (d > 0 ? 'down' : 'up')),
        p => p?.cursor === n,
      )
  }

  /** Backs out of what is left of the menu, a level at a time. */
  const close = () =>
    run(async () => {
      let left = picker
      for (let n = 0; left && n < LEVELS; n += 1) {
        const was = left
        await press(pane, ['esc'])
        left = await until(pane, readPicker, p => shownAs(p) !== shownAs(was))
      }
      finish()
    })

  const last = seen.at(-1)?.n ?? 0
  return (
    <Popover.Root
      open={open}
      onOpenChange={next => {
        if (busy) return
        if (next) {
          setOpen(true)
          void start()
        } else if (picker) void close()
        else finish()
      }}
    >
      <Popover.Trigger
        disabled={disabled}
        className="flex flex-none cursor-pointer items-center gap-1 rounded border border-line bg-raised px-1.5 py-0.5 font-mono text-text disabled:cursor-default disabled:opacity-60"
      >
        {label}
        <ChevronDown size={12} />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner side="top" sideOffset={6} align="start" className="z-50 outline-none">
          <Popover.Popup className="flex max-h-[70vh] w-[360px] flex-col gap-2.5 overflow-auto rounded-lg border border-line bg-raised-2 p-3 text-[13px] index-card-lifted outline-none">
            {picker ? (
              <>
                <div>
                  <p className="m-0 font-semibold">{picker.heading[0]}</p>
                  {picker.heading.slice(1).map(l => (
                    <p key={l} className="m-0 text-xs text-muted">
                      {l}
                    </p>
                  ))}
                </div>
                <div className="flex flex-col">
                  {seen.map(item => (
                    <button
                      key={item.n}
                      type="button"
                      disabled={busy}
                      onClick={() => moveTo(item.n)}
                      className={`flex min-w-0 cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-left disabled:cursor-default ${item.n === picker.cursor ? 'bg-raised' : ''}`}
                    >
                      <Check size={14} className={`flex-none ${item.current ? '' : 'invisible'}`} />
                      <span className="flex-none">{item.label}</span>
                      <span className="min-w-0 truncate text-xs text-muted">{item.note}</span>
                    </button>
                  ))}
                  {picker.more > 0 ? (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => moveTo(last + 1)}
                      className="cursor-pointer rounded-md px-2 py-1.5 pl-8 text-left text-xs text-muted disabled:cursor-default"
                    >
                      … +{picker.more}
                    </button>
                  ) : null}
                </div>
                {picker.effort ? (
                  <div className="flex items-center gap-1.5 px-2">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void act(['left'])}
                      className="cursor-pointer rounded p-0.5 disabled:cursor-default"
                    >
                      <ChevronLeft size={14} />
                    </button>
                    <span>{picker.effort} effort</span>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void act(['right'])}
                      className="cursor-pointer rounded p-0.5 disabled:cursor-default"
                    >
                      <ChevronRight size={14} />
                    </button>
                  </div>
                ) : null}
                <div className="flex flex-wrap justify-end gap-1.5">
                  {(picker.keys.length > 0 ? picker.keys : PLAIN).map(k => (
                    <button
                      key={k.key}
                      type="button"
                      disabled={busy}
                      onClick={() => void act([k.key.toLowerCase()])}
                      className="cursor-pointer rounded-md border border-line bg-raised px-2 py-1 text-xs disabled:cursor-default disabled:opacity-60"
                    >
                      {k.label}
                      <kbd className="ml-1.5 font-mono text-[11px] text-muted">{k.key}</kbd>
                    </button>
                  ))}
                </div>
              </>
            ) : (
              <p className={`m-0 ${error ? 'text-danger' : 'text-muted'}`}>{error ?? t('status.opening')}</p>
            )}
            {picker && error ? <p className="m-0 text-xs text-danger">{error}</p> : null}
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  )
}
