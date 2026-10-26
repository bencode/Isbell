// The Aa button and what it opens: the text size, the page width, the typeface and the theme a
// document reads in.

import { Popover } from '@base-ui/react/popover'
import { Check, Type } from 'lucide-react'
import { type CSSProperties, type ReactNode, useId } from 'react'
import { Segmented } from '../../segmented'
import {
  FONT_SIZE,
  READING_THEMES,
  type ReadingAppearance,
  type ReadingTheme,
  themeStyle,
} from './appearance'

export type AppearanceLabels = {
  appearance: string
  textSize: string
  width: string
  focused: string
  full: string
  font: string
  sans: string
  serif: string
  theme: string
  themes: Record<ReadingTheme, string>
}

const LEGEND = 'text-[12px] font-medium text-muted'

export function AppearanceControl({
  value,
  onChange,
  labels,
}: {
  value: ReadingAppearance
  onChange: (change: Partial<ReadingAppearance>) => void
  labels: AppearanceLabels
}) {
  const size = useId()
  return (
    <Popover.Root>
      <Popover.Trigger
        aria-label={labels.appearance}
        title={labels.appearance}
        className="inline-flex size-[30px] cursor-pointer items-center justify-center rounded-md border-0 bg-transparent text-muted hover:bg-raised-2 hover:text-text data-popup-open:bg-raised-2 data-popup-open:text-text focus-visible:outline-2 focus-visible:outline-accent"
      >
        <Type size={15} />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner sideOffset={6} align="end" className="z-50 outline-none">
          <Popover.Popup className="flex w-72 flex-col gap-4 rounded-lg border border-line bg-raised-2 p-4 index-card-lifted outline-none">
            <Popover.Title className="m-0 text-[13px] font-semibold">{labels.appearance}</Popover.Title>
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <label htmlFor={size} className={LEGEND}>
                  {labels.textSize}
                </label>
                <output htmlFor={size} className="font-mono text-[12px] text-faint">
                  {value.fontSize} px
                </output>
              </div>
              <div className="flex items-center gap-2.5">
                <span aria-hidden className="text-[12px]">
                  A
                </span>
                <input
                  id={size}
                  type="range"
                  min={FONT_SIZE.min}
                  max={FONT_SIZE.max}
                  step={1}
                  value={value.fontSize}
                  onChange={e => onChange({ fontSize: Number(e.target.value) })}
                  className="min-w-0 flex-1 accent-accent"
                />
                <span aria-hidden className="text-[18px]">
                  A
                </span>
              </div>
            </div>
            <Setting legend={labels.width}>
              <Segmented
                label={labels.width}
                value={value.width}
                onChange={width => onChange({ width })}
                segments={[
                  { value: 'focused', label: labels.focused },
                  { value: 'full', label: labels.full },
                ]}
              />
            </Setting>
            <Setting legend={labels.font}>
              <Segmented
                label={labels.font}
                value={value.font}
                onChange={font => onChange({ font })}
                segments={[
                  { value: 'sans', label: labels.sans },
                  { value: 'serif', label: <span className="font-serif">{labels.serif}</span> },
                ]}
              />
            </Setting>
            <Setting legend={labels.theme}>
              <div className="grid grid-cols-4 gap-2">
                {READING_THEMES.map(theme => (
                  <button
                    key={theme}
                    type="button"
                    aria-pressed={value.theme === theme}
                    onClick={() => onChange({ theme })}
                    className="flex cursor-pointer flex-col items-center gap-1 border-0 bg-transparent p-0 text-[11.5px] text-muted aria-pressed:text-text"
                  >
                    {/* Shown in the theme it names. */}
                    <span
                      style={themeStyle(theme) as CSSProperties}
                      className={`relative grid h-10 w-full place-items-center rounded-md border bg-bg text-[15px] text-text ${value.theme === theme ? 'border-accent outline-2 outline-accent' : 'border-line'}`}
                    >
                      Aa
                      {value.theme === theme ? (
                        <Check size={12} className="absolute top-1 right-1 text-accent" />
                      ) : null}
                    </span>
                    {labels.themes[theme]}
                  </button>
                ))}
              </div>
            </Setting>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  )
}

function Setting({ legend, children }: { legend: string; children: ReactNode }) {
  return (
    <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
      <legend className={`${LEGEND} mb-2 p-0`}>{legend}</legend>
      {children}
    </fieldset>
  )
}
