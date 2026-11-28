// A new task on a phone: a line of work handed to one of the roles agents run, a lead by default. It
// is sent to that agent as said under it, for the agent to add the task and see to it as isbell-tools
// says; the page then opens its chat, to follow how it goes, so back leads to the tasks.

import { ChevronLeft } from 'lucide-react'
import { useState } from 'react'
import { useNavigate } from 'react-router'
import { errorText, useI18n } from '../../../core/i18n'
import { useSpace } from '../../../core/space'
import { prompt } from '../../../model/herdr'
import { newTask } from '../../../model/roles'
import { sessionHref } from '../../../utils/hrefs'
import { PhoneBar, TAP, useBack } from '../bar'
import { RolePicker, Said, useRunningChoices } from '../role-picker'

const LABEL = 'm-0 px-4 pt-3.5 pb-1.5 text-[12.5px] font-semibold text-muted'

export function PhoneNewTask() {
  const t = useI18n()
  const navigate = useNavigate()
  const back = useBack()
  const space = useSpace()
  // One asking the user would take the line for an answer to its question.
  const choices = useRunningChoices()
  const free = choices.filter(c => c.placed.session.status !== 'blocked')
  const [picked, setPicked] = useState<string>()
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string>()

  const to = free.find(c => c.key === picked) ?? free.find(c => c.members) ?? free[0]
  const said = newTask(text)
  const ready = !!to && !!text.trim() && !sending

  const send = async () => {
    if (!to || !ready) return
    setSending(true)
    setError(undefined)
    const { mid, paneId } = to.placed.session
    try {
      await prompt(space.call, mid, paneId, said)
      navigate(sessionHref(mid, paneId), { replace: true })
    } catch (err) {
      setError(errorText(t, err))
      setSending(false)
    }
  }

  return (
    <div className="flex min-h-dvh flex-col">
      <PhoneBar>
        <button type="button" onClick={back} disabled={sending} aria-label={t('mobile.back')} className={TAP}>
          <ChevronLeft size={22} />
        </button>
        <b className="min-w-0 flex-1 truncate text-base font-semibold">{t('mobile.newTask')}</b>
      </PhoneBar>
      <main className="min-w-0 flex-1 pb-3">
        <h2 className={LABEL}>{t('mobile.handTo')}</h2>
        {choices.length ? (
          <RolePicker
            choices={choices}
            value={to?.key}
            onChange={setPicked}
            named={new Set(choices.map(c => c.placed.session.mid)).size > 1}
            notAsking
            disabled={sending}
          />
        ) : (
          <p className="m-0 px-4 py-2 text-muted">{t('mobile.noRole')}</p>
        )}
        <h2 className={LABEL}>{t('mobile.whatToDo')}</h2>
        <div className="px-3">
          <textarea
            value={text}
            onChange={e => setText(e.target.value)}
            disabled={sending}
            rows={4}
            className="block w-full resize-none rounded-[10px] border border-line bg-raised px-3 py-2.5 text-[15px] text-text outline-none focus:border-accent"
          />
        </div>
        {to ? <Said label={t('mobile.sentTo', { name: to.name })} text={said} /> : null}
      </main>
      <div className="sticky bottom-0 z-10 border-t border-line bg-bg px-3 pt-2 pb-[calc(env(safe-area-inset-bottom)+8px)]">
        {error ? <p className="m-0 pb-2 text-[13px] text-danger">{error}</p> : null}
        <button
          type="button"
          onClick={() => void send()}
          disabled={!ready}
          className="h-12 w-full cursor-pointer truncate rounded-[10px] border-0 bg-accent px-3 text-[15px] font-semibold text-accent-ink active:opacity-85 disabled:cursor-default disabled:opacity-50"
        >
          {sending
            ? t('mobile.handing')
            : to
              ? t('mobile.handToName', { name: to.name })
              : t('mobile.newTask')}
        </button>
      </div>
    </div>
  )
}
