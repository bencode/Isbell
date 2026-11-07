import { Check, ChevronDown } from 'lucide-react'
import { useState } from 'react'
import { DropdownMenu } from '../../components/menu'
import { useI18n } from '../../core/i18n'
import { useSpace } from '../../core/space'
import { modesOf, parseScreen } from '../../model/screen'
import type { Footer } from '../../model/screen/types'
import type { AgentStatus } from '../../model/state'
import { type Pane, press, submit, until } from './agent-keys'
import { PickerRemote } from './picker-remote'

/** The mode the screen comes to show in place of `was`, `was` when it shows no other in time, or
 * undefined once it shows none, as when a question has taken the input box's place. */
const changeFrom = (pane: Pane, was: string) =>
  until(
    pane,
    text => parseScreen(pane.kind, text, true)?.footer?.mode,
    now => now !== was,
  )

/**
 * Sends the command that enters `mode`, or else presses ⇧Tab, a step at a time: the next only once
 * the screen shows where the last one went, so a step it is slow to draw is not taken twice. False
 * when it does not come to `mode` within the modes and one step more, or the mode is lost from the
 * screen: another ⇧Tab could then answer a question.
 */
async function stepTo(pane: Pane, from: string, mode: string): Promise<boolean> {
  const { modes, enter } = modesOf(pane.kind)
  const command = enter[mode]
  let now: string | undefined = from
  for (let n = 0; n < modes.length + 1 && now !== undefined && now !== mode; n += 1) {
    await (command ? submit(pane, command) : press(pane, ['shift+tab']))
    now = await changeFrom(pane, now)
  }
  return now === mode
}

/** Below the composer: the mode the agent is in and a menu to switch it, its model with its own
 * menu mirrored, and the user's own status line, as the agent shows them below its input box. */
export function StatusBar({
  mid,
  paneId,
  kind,
  status,
  footer,
  onChanged,
}: {
  mid: string
  paneId: string
  kind: string | undefined
  status: AgentStatus
  footer: Footer | undefined
  onChanged: () => void
}) {
  const t = useI18n()
  const space = useSpace()
  const [switching, setSwitching] = useState(false)
  const [failed, setFailed] = useState<string>()
  const { modes } = modesOf(kind)
  const current = footer?.mode
  const line = footer?.line
  if (!current && !line) return null
  const pane = { call: space.call, mid, paneId, kind }
  // While it works or asks, a menu over its input box would get in its way.
  const busy = status === 'working' || status === 'blocked'

  const switchTo = async (from: string, mode: string) => {
    if (mode === from) return
    setSwitching(true)
    setFailed(undefined)
    try {
      if (!(await stepTo(pane, from, mode))) setFailed(mode)
    } catch (err) {
      console.error('could not switch to', mode, err)
      setFailed(mode)
    } finally {
      setSwitching(false)
      onChanged()
    }
  }

  return (
    <div className="flex min-w-0 flex-1 items-center gap-2.5 text-xs text-muted">
      {current && modes.length > 0 ? (
        <>
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
          <PickerRemote
            pane={pane}
            label={footer?.model ?? t('status.model')}
            disabled={busy || switching}
            onDone={onChanged}
          />
        </>
      ) : null}
      {failed ? (
        <span className="flex-none text-danger">{t('status.modeFailed', { mode: failed })}</span>
      ) : null}
      {line ? (
        <span title={line} className="min-w-0 truncate font-mono">
          {line}
        </span>
      ) : null}
    </div>
  )
}
