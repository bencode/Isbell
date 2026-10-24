// Settings, kept in this browser only: notifications, theme, language, and the space itself.

import { type ReactNode, useState } from 'react'
import { useNavigate } from 'react-router'
import { useT } from '../i18n'
import { applyTheme, clearLocal, type Prefs, updateLocal, useLocal } from '../prefs'
import { Button } from '../ui/button'
import { Confirm, Modal } from '../ui/dialog'
import { Segmented } from '../ui/segmented'
import { ToggleSwitch } from '../ui/switch'
import { JoinCommands } from './board/all'
import { useOpen } from './board/layout'

type Props = { open: boolean; onOpenChange: (open: boolean) => void }

const setPrefs = (patch: Partial<Prefs>) => updateLocal(l => ({ prefs: { ...l.prefs, ...patch } }))

const permission = (): NotificationPermission | 'unsupported' =>
  'Notification' in window ? Notification.permission : 'unsupported'

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3 border-t border-line pt-4">
      <h3 className="m-0 text-xs font-semibold text-faint">{title}</h3>
      {children}
    </section>
  )
}

function Row({ label, hint, children }: { label: string; hint?: string; children?: ReactNode }) {
  return (
    <div className="flex items-center gap-3">
      <span className="flex flex-1 flex-col gap-0.5">
        <span className="font-semibold">{label}</span>
        {hint ? <span className="text-[12.5px] text-muted">{hint}</span> : null}
      </span>
      {children}
    </div>
  )
}

export function Settings({ open, onOpenChange }: Props) {
  const t = useT()
  const { prefs } = useLocal()
  const [allowed, setAllowed] = useState(permission)
  const openOverlay = useOpen()

  const toggleNotify = async (on: boolean) => {
    if (!on) {
      setPrefs({ notify: false })
      return
    }
    // The browser asks once; after a refusal only its own site settings can change it.
    const result = allowed === 'default' ? await Notification.requestPermission() : allowed
    setAllowed(result)
    setPrefs({ notify: result === 'granted' })
  }

  return (
    <Modal open={open} onOpenChange={onOpenChange} title={t('settings.title')}>
      <p className="m-0 text-muted">{t('settings.local')}</p>
      <Section title={t('settings.notifications')}>
        <Row label={t('settings.notify')} hint={t('settings.notifyHint')}>
          <ToggleSwitch
            checked={prefs.notify && allowed === 'granted'}
            onChange={on => void toggleNotify(on)}
            label={t('settings.notify')}
          />
        </Row>
        {allowed === 'unsupported' ? <p className="m-0 text-danger">{t('settings.unsupported')}</p> : null}
        {allowed === 'denied' ? <p className="m-0 text-danger">{t('settings.denied')}</p> : null}
        {prefs.notify && allowed === 'granted' ? (
          <Row label={t('settings.allowed')}>
            <Button onClick={() => new Notification('Isbell', { body: t('settings.testBody') })}>
              {t('settings.test')}
            </Button>
          </Row>
        ) : null}
        <p className="m-0 text-[12.5px] text-muted">{t('settings.closedNote')}</p>
      </Section>
      <Section title={t('settings.appearance')}>
        <Row label={t('settings.theme')}>
          <Segmented
            label={t('settings.theme')}
            value={prefs.theme}
            onChange={theme => {
              setPrefs({ theme })
              applyTheme(theme)
            }}
            segments={[
              { value: 'system', label: t('theme.system') },
              { value: 'light', label: t('theme.light') },
              { value: 'dark', label: t('theme.dark') },
            ]}
          />
        </Row>
        <Row label={t('settings.language')}>
          <Segmented
            label={t('settings.language')}
            value={prefs.lang}
            onChange={lang => setPrefs({ lang })}
            segments={[
              { value: 'system', label: t('lang.system') },
              { value: 'en', label: 'English' },
              { value: 'zh', label: '中文' },
            ]}
          />
        </Row>
      </Section>
      <Section title={t('settings.space')}>
        <Row label={t('settings.addMachine')} hint={t('settings.addMachineHint')} />
        <JoinCommands />
        <Row label={t('settings.leave')} hint={t('settings.leaveHint')}>
          <Button variant="end" onClick={() => openOverlay('leave')}>
            {t('settings.leaveButton')}
          </Button>
        </Row>
      </Section>
    </Modal>
  )
}

export function LeaveSpace({ open, onOpenChange }: Props) {
  const t = useT()
  const navigate = useNavigate()
  return (
    <Confirm
      open={open}
      onOpenChange={onOpenChange}
      title={t('leave.title')}
      body={t('leave.body')}
      keep={t('cancel')}
      confirm={t('leave.confirm')}
      onConfirm={() => {
        clearLocal()
        applyTheme('system')
        navigate('/')
      }}
    />
  )
}
