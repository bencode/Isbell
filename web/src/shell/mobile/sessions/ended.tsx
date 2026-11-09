// A session that ended, on a phone: what was said in it, scrolling with the page as a chat does, and
// where a chat has its reply, resuming it. Resumed, it takes this page's place.

import { useEffect } from 'react'
import { useNavigate, useParams } from 'react-router'
import { errorText, useI18n } from '../../../core/i18n'
import { useProjects } from '../../../core/space'
import { PathRoot } from '../../../features/session/context'
import { Conversation, EarlierButton, Marker } from '../../../features/session/conversation'
import { useClosedSession } from '../../../features/session/use-closed-session'
import { lineTime } from '../../../model/sessions'
import { sessionHref } from '../../../utils/hrefs'
import { clock, dayTitle, useNow } from '../../../utils/time'
import { BackButton, BarTitle, PhoneBar } from '../bar'
import { usePageChat } from '../page-chat'

export function PhoneEnded() {
  const t = useI18n()
  const navigate = useNavigate()
  const now = useNow()
  const { key = '', agent = '', id: sid = '' } = useParams()
  const project = useProjects().find(p => p.key === key)
  const mid = project?.mid ?? ''
  const { line, log, note, pane, where, cannot, busy, error, resume } = useClosedSession(
    project,
    mid,
    agent,
    sid,
    // As one just started: a pane listed as a shell until its agent is made out.
    paneId => navigate(`${sessionHref(mid, paneId)}?from=new`, { replace: true }),
  )
  const { earlier } = usePageChat(log, false)
  useEffect(() => {
    if (pane) navigate(sessionHref(mid, pane), { replace: true })
  }, [pane, navigate, mid])

  if (!project || !line)
    return (
      <>
        <PhoneBar>
          <BackButton />
        </PhoneBar>
        <p className="m-0 p-4 text-muted">{note}</p>
      </>
    )

  const at = lineTime(line)
  const day = dayTitle(t.locale, at, now, {
    today: t('sessions.today'),
    yesterday: t('sessions.yesterday'),
  })
  const small = 'm-0 pb-2 text-[12.5px]'
  return (
    <div className="flex min-h-dvh flex-col">
      <PhoneBar>
        <BackButton />
        <BarTitle
          title={line.first}
          where={[project.name, agent, t('closed.ran'), `${day} ${clock(t.locale, at)}`].join(' · ')}
        />
      </PhoneBar>
      <main className="min-w-0 flex-1 px-4 pt-4 text-[15px] leading-[1.55]">
        {log.turns ? (
          <PathRoot value={{ project, cwd: line.cwd }}>
            <Conversation
              turns={log.turns}
              kind={agent}
              status="done"
              statusSince={0}
              top={
                <Marker>
                  {log.start ? t('chat.start') : <EarlierButton onClick={earlier} paging={log.paging} />}
                </Marker>
              }
              asking={null}
            />
          </PathRoot>
        ) : log.error ? null : (
          <p className="m-0 text-[13px] text-muted">
            {t(log.unread ? 'chat.unreadRecord' : 'session.reading')}
          </p>
        )}
        {log.error ? <p className="m-0 text-[13px] text-danger">{errorText(t, log.error)}</p> : null}
      </main>
      <div className="sticky bottom-0 z-10 border-t border-line bg-bg px-3 pt-2 pb-[calc(env(safe-area-inset-bottom)+8px)]">
        {error ? (
          <p className={`${small} text-danger`}>{t('closed.failed', { msg: error })}</p>
        ) : (
          <p className={`${small} truncate text-faint`}>{cannot ?? t('mobile.resumeIn', { path: where })}</p>
        )}
        <button
          type="button"
          onClick={() => void resume()}
          disabled={busy || cannot !== undefined}
          className="h-12 w-full cursor-pointer truncate rounded-[10px] border-0 bg-accent px-3 text-[15px] font-semibold text-accent-ink active:opacity-85 disabled:cursor-default disabled:opacity-50"
        >
          {t(busy ? 'closed.resuming' : 'closed.resume')}
        </button>
      </div>
    </div>
  )
}
