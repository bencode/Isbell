// The way to everything that is not a project's: theme and language at hand, the rest in the settings
// and leaving dialogs, which the frame shows over itself.

import { Popover } from '@base-ui/react/popover'
import { Toggle } from '@base-ui/react/toggle'
import { ToggleGroup } from '@base-ui/react/toggle-group'
import { Bell, CircleHelp, LogOut, type LucideIcon, Server, Settings2 } from 'lucide-react'
import { type ReactNode, useState } from 'react'
import { ICON, IconButton } from '../../components/icon-button'
import { useI18n } from '../../core/i18n'
import { applyTheme, type Prefs, updateLocal, useLocal } from '../../core/prefs'
import { LeaveSpace, Settings } from '../../features/settings/settings-dialog'

const HELP = 'https://github.com/bencode/Isbell#readme'

export type Overlay = 'settings' | 'leave'

/** Settings and leaving the space; one open at a time. */
export function Overlays({
  overlay,
  setOverlay,
}: {
  overlay: Overlay | null
  setOverlay: (overlay: Overlay | null) => void
}) {
  const close = (open: boolean) => !open && setOverlay(null)
  return (
    <>
      <Settings open={overlay === 'settings'} onOpenChange={close} onLeave={() => setOverlay('leave')} />
      <LeaveSpace open={overlay === 'leave'} onOpenChange={close} />
    </>
  )
}

const setPrefs = (patch: Partial<Prefs>) => updateLocal(l => ({ prefs: { ...l.prefs, ...patch } }))

const ROW = 'flex min-h-[34px] items-center justify-between gap-2.5 pr-1.5 pl-2 text-[13px] text-muted'
const ITEM =
  'flex h-[30px] w-full cursor-pointer items-center gap-2.5 rounded-md border-0 bg-transparent px-2 text-left text-[13px] text-text no-underline transition-colors duration-75 hover:bg-hover focus-visible:outline-2 focus-visible:outline-accent active:bg-press'

const MARK = { ...ICON, size: 14, className: 'flex-none text-faint' }

function Item({ Icon, onClick, children }: { Icon: LucideIcon; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" onClick={onClick} className={ITEM}>
      <Icon {...MARK} />
      {children}
    </button>
  )
}

function Choice<V extends string>({
  label,
  value,
  onChange,
  choices,
}: {
  label: string
  value: V
  onChange: (value: V) => void
  choices: { value: V; label: string }[]
}) {
  return (
    <div className={ROW}>
      {label}
      <ToggleGroup
        aria-label={label}
        value={[value]}
        onValueChange={values => {
          const next = values[0] as V | undefined
          if (next) onChange(next)
        }}
        className="inline-flex rounded-[7px] bg-hover p-0.5"
      >
        {choices.map(c => (
          <Toggle
            key={c.value}
            value={c.value}
            className="h-[22px] cursor-pointer rounded-[5px] border-0 bg-transparent px-2.5 text-xs text-muted outline-none hover:text-text focus-visible:outline-2 focus-visible:outline-accent data-pressed:bg-raised data-pressed:font-medium data-pressed:text-text data-pressed:shadow-[0_1px_2px_rgb(0_0_0/0.12)]"
          >
            {c.label}
          </Toggle>
        ))}
      </ToggleGroup>
    </div>
  )
}

export function SettingsMenu({ onOverlay }: { onOverlay: (overlay: Overlay) => void }) {
  const t = useI18n()
  const { prefs } = useLocal()
  const [open, setOpen] = useState(false)
  const show = (overlay: Overlay) => {
    setOpen(false)
    onOverlay(overlay)
  }
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger
        render={
          <IconButton label={t('side.settings')} side="right" className={open ? 'bg-selected text-text' : ''}>
            <Settings2 {...ICON} />
          </IconButton>
        }
      />
      <Popover.Portal>
        <Popover.Positioner side="top" align="start" sideOffset={8} className="z-50">
          <Popover.Popup className="w-72 origin-bottom-left rounded-[10px] border border-line-strong bg-raised p-1.5 shadow-[0_8px_28px_rgb(0_0_0/0.2)] outline-none transition-[opacity,transform] duration-150 ease-out data-ending-style:scale-[0.98] data-ending-style:opacity-0 data-starting-style:scale-[0.98] data-starting-style:opacity-0">
            <Choice
              label={t('settings.theme')}
              value={prefs.theme}
              onChange={theme => {
                setPrefs({ theme })
                applyTheme(theme)
              }}
              choices={[
                { value: 'system', label: t('theme.system') },
                { value: 'light', label: t('theme.light') },
                { value: 'dark', label: t('theme.dark') },
              ]}
            />
            <Choice
              label={t('settings.language')}
              value={prefs.lang}
              onChange={lang => setPrefs({ lang })}
              choices={[
                { value: 'system', label: t('lang.system') },
                { value: 'zh', label: '中文' },
                { value: 'en', label: 'English' },
              ]}
            />
            <div className="mx-0.5 my-[5px] h-px bg-line" />
            <Item Icon={Server} onClick={() => show('settings')}>
              {t('settings.addMachine')}
            </Item>
            <Item Icon={Bell} onClick={() => show('settings')}>
              {t('settings.notifications')}
            </Item>
            <a href={HELP} target="_blank" rel="noreferrer" onClick={() => setOpen(false)} className={ITEM}>
              <CircleHelp {...MARK} />
              {t('workbench.help')}
            </a>
            <Item Icon={LogOut} onClick={() => show('leave')}>
              {t('settings.leave')}
            </Item>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  )
}
