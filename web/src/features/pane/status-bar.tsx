import { Check, ChevronDown } from 'lucide-react'
import { useState } from 'react'
import { DropdownMenu } from '../../components/menu'
import { useI18n } from '../../core/i18n'
import { useSpace } from '../../core/space'
import { type Caller, prompt, readScreen, sendKeys } from '../../model/herdr'
import { modesOf, parseScreen } from '../../model/screen'
import type { Footer } from '../../model/screen/types'

// How often the screen is read after a step, and how many times, before the step is taken again.
const READ_EVERY_MS = 300
const READS = 5

type Pane = { call: Caller; mid: string; paneId: string; kind: string | undefined }

const modeOn = async ({ call, mid, paneId, kind }: Pane) =>
  parseScreen(kind, await readScreen(call, mid, paneId, 'visible'), true)?.footer?.mode

/** The mode the screen comes to show in place of `was`, `was` when it shows no other in time, or
 * undefined once it shows none, as when a question has taken the input box's place. */
async function changeFrom(pane: Pane, was: string): Promise<string | undefined> {
  for (let n = 0; n < READS; n += 1) {
    await new Promise(done => setTimeout(done, READ_EVERY_MS))
    const now = await modeOn(pane)
    if (now !== was) return now
  }
  return was
}

/**
 * Sends the command that enters `mode`, or else presses ⇧Tab, a step at a time: the next only once
 * the screen shows where the last one went, so a step it is slow to draw is not taken twice. False
 * when it does not come to `mode` within the modes and one step more, or the mode is lost from the
 * screen: another ⇧Tab could then answer a question.
 */
async function stepTo(pane: Pane, from: string, mode: string): Promise<boolean> {
  const { call, mid, paneId, kind } = pane
  const { modes, enter } = modesOf(kind)
  const command = enter[mode]
  let now: string | undefined = from
  for (let n = 0; n < modes.length + 1 && now !== undefined && now !== mode; n += 1) {
    await (command ? prompt(call, mid, paneId, command) : sendKeys(call, mid, paneId, ['shift+tab']))
    now = await changeFrom(pane, now)
  }
  return now === mode
}

/** Below the composer: the mode the agent is in, a menu to switch it, and its model or the
 * user's own status line, as the agent shows them below its input box. */
export function StatusBar({
  mid,
  paneId,
  kind,
  footer,
  onChanged,
}: {
  mid: string
  paneId: string
  kind: string | undefined
  footer: Footer | undefined
  onChanged: () => void
}) {
  const t = useI18n()
  const space = useSpace()
  const [switching, setSwitching] = useState(false)
  const [failed, setFailed] = useState<string>()
  const { modes } = modesOf(kind)
  const current = footer?.mode
  const shown = [footer?.model, footer?.line].filter(Boolean).join(' · ')
  if (!current && !shown) return null

  const switchTo = async (from: string, mode: string) => {
    if (mode === from) return
    setSwitching(true)
    setFailed(undefined)
    try {
      if (!(await stepTo({ call: space.call, mid, paneId, kind }, from, mode))) setFailed(mode)
    } catch (err) {
      console.error('could not switch to', mode, err)
      setFailed(mode)
    } finally {
      setSwitching(false)
      onChanged()
    }
  }

  return (
    <div className="mt-2 flex min-w-0 items-center gap-2.5 text-xs text-muted">
      {current && modes.length > 0 ? (
        <DropdownMenu
          trigger={
            <button
              type="button"
              disabled={switching}
              aria-label={t('status.mode')}
              className="flex flex-none cursor-pointer items-center gap-1 rounded border border-line bg-raised px-1.5 py-0.5 font-medium text-text disabled:cursor-default disabled:opacity-60"
            >
              {current}
              <ChevronDown size={12} />
            </button>
          }
          items={modes.map(mode => ({
            label: (
              <>
                <Check size={14} className={mode === current ? '' : 'invisible'} />
                {mode}
              </>
            ),
            onClick: () => void switchTo(current, mode),
          }))}
        />
      ) : null}
      {failed ? (
        <span className="flex-none text-danger">{t('status.modeFailed', { mode: failed })}</span>
      ) : null}
      {shown ? (
        <span title={shown} className="min-w-0 truncate font-mono text-[11.5px]">
          {shown}
        </span>
      ) : null}
    </div>
  )
}
