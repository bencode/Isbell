// Settings, kept in this browser only: notifications and pushes, theme, language, and the space itself.

import { type ReactNode, useState } from 'react'
import { useNavigate } from 'react-router'
import { Button } from '../../components/button'
import { Confirm, Modal } from '../../components/dialog'
import { JoinCommands } from '../../components/join-commands'
import { Segmented } from '../../components/segmented'
import { ToggleSwitch } from '../../components/switch'
import { errorText, uiLabels, useI18n } from '../../core/i18n'
import { applyTheme, clearLocal, type Prefs, updateLocal, useLocal } from '../../core/prefs'
import { pushMachines, pushSupport, pushTexts, turnOffPush, turnOnPush } from '../../core/push'
import { useSpace, useSpaceView } from '../../core/space'

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

export function Settings({ open, onOpenChange, onLeave }: Props & { onLeave: () => void }) {
  const t = useI18n()
  const { key, prefs } = useLocal()
  const [allowed, setAllowed] = useState(permission)
  const { call } = useSpace()
  const { machines } = useSpaceView()
  const support = pushSupport()
  const [pushProblem, setPushProblem] = useState<string>()

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

  const togglePush = async (on: boolean) => {
    setPushProblem(undefined)
    try {
      if (!on) {
        // Off only once unsubscribed: a failure leaves it on, as the phone still gets pushes.
        await turnOffPush()
        setPrefs({ push: false })
        return
      }
      const mids = pushMachines(machines)
      if (!mids.length) return setPushProblem(t('settings.pushNoMachine'))
      const granted = await turnOnPush(call, mids, pushTexts(t))
      setAllowed(permission())
      setPrefs({ push: granted })
    } catch (err) {
      console.error('could not turn pushes', on ? 'on' : 'off', err)
      setPushProblem(t(on ? 'settings.pushFailed' : 'settings.pushOffFailed', { msg: errorText(t, err) }))
    }
  }

  return (
    <Modal open={open} onOpenChange={onOpenChange} title={t('settings.title')} closeLabel={t('close')}>
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
        {/* Where pushes can be had, their row says what reaches a closed Isbell instead. */}
        {support === 'no' ? <p className="m-0 text-[12.5px] text-muted">{t('settings.closedNote')}</p> : null}
        {support === 'no' ? null : (
          <Row
            label={t('settings.push')}
            hint={t(support === 'yes' ? 'settings.pushHint' : 'settings.pushInstall')}
          >
            {support === 'yes' ? (
              <ToggleSwitch
                checked={prefs.push && allowed === 'granted'}
                onChange={on => void togglePush(on)}
                label={t('settings.push')}
              />
            ) : null}
          </Row>
        )}
        {pushProblem ? <p className="m-0 text-danger">{pushProblem}</p> : null}
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
        {key ? <JoinCommands spaceKey={key} labels={uiLabels(t)} /> : null}
        <Row label={t('settings.leave')} hint={t('settings.leaveHint')}>
          <Button variant="end" onClick={onLeave}>
            {t('settings.leaveButton')}
          </Button>
        </Row>
      </Section>
    </Modal>
  )
}

export function LeaveSpace({ open, onOpenChange }: Props) {
  const t = useI18n()
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
