// The keys a touch keyboard lacks, under the terminal. Up, down and Enter, which answer an agent's
// menu, stay at the right edge, under the thumb; the rest scroll beside them. Ctrl holds until the
// next key, from the bar or the keyboard.

import { Keyboard } from 'lucide-react'
import type { MouseEvent, ReactNode } from 'react'
import { useI18n } from '../../core/i18n'
import type { BarKey } from '../../model/term-keys'

type Key = { key: BarKey; label: ReactNode; aria?: string }

const CHOICES: Key[] = [
  { key: 'esc', label: 'Esc' },
  { key: '1', label: '1' },
  { key: '2', label: '2' },
  { key: '3', label: '3' },
]
const EDITING: Key[] = [
  { key: 'interrupt', label: '^C', aria: 'Ctrl-C' },
  { key: 'tab', label: 'Tab' },
]
const SIDEWAYS: Key[] = [
  { key: 'left', label: '←' },
  { key: 'right', label: '→' },
]
const FIXED: Key[] = [
  { key: 'up', label: '↑' },
  { key: 'down', label: '↓' },
]

// On the terminal's night page (NIGHT in use-terminal.ts), each a finger's size.
const KEY =
  'inline-flex h-11 min-w-11 flex-none cursor-pointer items-center justify-center rounded-[9px] border border-[#2c3546] bg-[#1f2737] px-2.5 font-mono text-[13px] text-[#e9e5d9] disabled:opacity-40'
const ON = 'border-[#8fb0ff]! bg-[#2b3a5c]!'
const ENTER = 'min-w-[62px] border-[#8fb0ff]! bg-[#8fb0ff]! text-[17px] font-bold text-[#0c1018]!'

// Focus stays where it is, so the system keyboard stays as it is.
const keepFocus = (e: MouseEvent) => e.preventDefault()

/** `keyboard`: the system keyboard is up. `live`: the terminal is connected, so a key would arrive. */
export function KeyBar({
  live,
  ctrl,
  onCtrl,
  keyboard,
  onKeyboard,
  onKey,
}: {
  live: boolean
  ctrl: boolean
  onCtrl: () => void
  keyboard: boolean
  onKeyboard: () => void
  onKey: (key: BarKey) => void
}) {
  const t = useI18n()
  const button = ({ key, label, aria }: Key, extra = '') => (
    <button
      key={key}
      type="button"
      disabled={!live}
      onMouseDown={keepFocus}
      onClick={() => onKey(key)}
      aria-label={aria}
      className={`${KEY} ${extra}`}
    >
      {label}
    </button>
  )
  return (
    <div role="toolbar" aria-label={t('terminal.keys')} className="flex px-2 pt-[7px] pb-1">
      <div className="flex min-w-0 flex-1 gap-1.5 overflow-x-auto [scrollbar-width:none]">
        {CHOICES.map(k => button(k))}
        <button
          type="button"
          disabled={!live}
          onMouseDown={keepFocus}
          onClick={onKeyboard}
          aria-pressed={keyboard}
          aria-label={t('terminal.keyboard')}
          className={`${KEY} ${keyboard ? ON : ''}`}
        >
          <Keyboard size={18} />
        </button>
        {EDITING.map(k => button(k))}
        <button
          type="button"
          disabled={!live}
          onMouseDown={keepFocus}
          onClick={onCtrl}
          aria-pressed={ctrl}
          className={`${KEY} ${ctrl ? ON : ''}`}
        >
          Ctrl
        </button>
        {SIDEWAYS.map(k => button(k))}
      </div>
      <div className="ml-1.5 flex flex-none gap-1.5 border-l border-[#2c3546] pl-1.5">
        {FIXED.map(k => button(k))}
        {button({ key: 'enter', label: '⏎', aria: 'Enter' }, ENTER)}
      </div>
    </div>
  )
}
