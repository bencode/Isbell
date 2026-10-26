// The keys a touch keyboard lacks, under the terminal. Ctrl holds until the next key, from the bar
// or the keyboard.

import type { MouseEvent } from 'react'
import { useI18n } from '../../core/i18n'
import type { BarKey } from '../../model/term-keys'

type Key = { key: BarKey; label: string; aria?: string }

// Either side of Ctrl.
const BEFORE: Key[] = [
  { key: 'esc', label: 'Esc' },
  { key: 'tab', label: 'Tab' },
]
const AFTER: Key[] = [
  { key: 'up', label: '↑' },
  { key: 'down', label: '↓' },
  { key: 'left', label: '←' },
  { key: 'right', label: '→' },
  { key: 'enter', label: '⏎', aria: 'Enter' },
]

// On the terminal's night page (NIGHT in use-terminal.ts).
const KEY =
  'h-[38px] min-w-[46px] flex-none cursor-pointer rounded-[7px] border border-[#2c3546] bg-[#1f2737] px-2.5 font-mono text-[13px] text-[#e9e5d9]'
const ON = 'border-[#8fb0ff]! bg-[#8fb0ff]! text-[#0c1018]!'

// Focus stays in the terminal, so the system keyboard stays up.
const keepFocus = (e: MouseEvent) => e.preventDefault()

export function KeyBar({
  ctrl,
  onCtrl,
  onKey,
}: {
  ctrl: boolean
  onCtrl: () => void
  onKey: (key: BarKey) => void
}) {
  const t = useI18n()
  const button = ({ key, label, aria }: Key) => (
    <button
      key={key}
      type="button"
      onMouseDown={keepFocus}
      onClick={() => onKey(key)}
      aria-label={aria}
      className={KEY}
    >
      {label}
    </button>
  )
  return (
    <div
      role="toolbar"
      aria-label={t('terminal.keys')}
      className="flex flex-none gap-1.5 overflow-x-auto bg-[#161c27] px-2 py-1.5 [scrollbar-width:none]"
    >
      {BEFORE.map(button)}
      <button
        type="button"
        onMouseDown={keepFocus}
        onClick={onCtrl}
        aria-pressed={ctrl}
        className={`${KEY} ${ctrl ? ON : ''}`}
      >
        Ctrl
      </button>
      {AFTER.map(button)}
    </div>
  )
}
