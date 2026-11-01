// The parts of a session's page that do not depend on how it is laid out: what is read from the
// agent's screen, the turns it makes, the dock that answers or adds to it, and the facts needed to
// reach it by hand. A computer and a phone arrange them each in their own way.

import { SquareTerminal } from 'lucide-react'
import { useEffect } from 'react'
import { Link, useLocation } from 'react-router'
import { buttonClass } from '../../components/button'
import { InfoFacts } from '../../components/info-panel'
import { errorText, useI18n } from '../../core/i18n'
import { attachCommand, connectionFacts, paneFacts } from '../../core/pane-facts'
import { markSeen } from '../../core/prefs'
import { RELAY_URL, useSpaceView } from '../../core/space'
import { PathRoot } from '../../core/tabs'
import { type Project, paneKey, type Session } from '../../model/projects'
import { machineOf } from '../../model/space'
import { settled } from '../../model/state'
import { terminalHref } from '../../utils/hrefs'
import { useNow } from '../../utils/time'
import { AnswerElsewhere, Asking } from './asking'
import { Composer } from './composer'
import { StatusBar } from './status-bar'
import { Turns } from './turns'
import { useLink } from './use-link'
import { useReading } from './use-reading'

/** A session as its page shows it: what is read from its screen, and what can be done with it. */
export type SessionState = ReturnType<typeof useSession>

export function useSession(mid: string, paneId: string, session: Session) {
  const view = useSpaceView()
  const { earlier, ...read } = useReading(mid, paneId, session)
  const methods = machineOf(view.machines, mid)?.state.caps.methods
  // Earlier turns are read a page at a time from a gateway that pages, while the agent is still.
  const canPage = read.more && settled(session.status) && !!methods?.includes('isbell.agent.history')

  // Looking at a finished session marks it read.
  useEffect(() => {
    if (session.status === 'done') markSeen(paneKey(mid, paneId), session.statusSince)
  }, [session, mid, paneId])

  return {
    ...read,
    onEarlier: canPage ? earlier : undefined,
    taken: !!methods?.includes('isbell.file.upload'),
    // Waiting for an answer, with its screen read to answer from.
    asking: session.status === 'blocked' && read.text !== null,
    terminal: terminalHref(mid, paneId),
  }
}

type Parts = { mid: string; paneId: string; project: Project; session: Session; state: SessionState }

/** The turns, or the screen itself when it cannot be read as turns, and what went wrong. */
export function SessionBody({
  project,
  session,
  state: { reading, text, error, terminal, onEarlier, paging, more },
}: Omit<Parts, 'mid' | 'paneId'>) {
  const t = useI18n()
  const promptError = (useLocation().state as { promptError?: { msg: string } } | null)?.promptError
  return (
    <>
      {promptError ? (
        <p className="m-0 rounded-lg border border-ask-line bg-ask px-3.5 py-2 text-[13px]">
          {t('session.promptFailed', { msg: promptError.msg })}
        </p>
      ) : null}
      {reading ? (
        <PathRoot value={{ project, cwd: session.cwd ?? project.path }}>
          <Turns
            reading={reading}
            status={session.status}
            statusSince={session.statusSince}
            terminal={terminal}
            onEarlier={onEarlier}
            paging={paging}
            more={more}
          />
        </PathRoot>
      ) : text === null ? (
        <p className="m-0 text-muted">{t('session.reading')}</p>
      ) : (
        <>
          <div className="flex items-center gap-3 rounded-md border border-line-strong bg-raised px-3.5 py-2.5 text-[13px] text-muted">
            <span className="flex-1">{t('chat.unreadable')}</span>
            <Link to={terminal} className={buttonClass('default', '', 'small')}>
              <SquareTerminal size={14} />
              {t('session.terminal')}
            </Link>
          </div>
          {/* On the terminal's night page, in its ink (NIGHT in use-terminal.ts). */}
          <pre className="m-0 overflow-auto rounded-md bg-term px-4 py-3.5 font-mono text-[12.5px] leading-normal whitespace-pre-wrap text-[#e9e5d9]">
            {text}
          </pre>
        </>
      )}
      {error ? <p className="m-0 text-[13px] text-danger">{errorText(t, error)}</p> : null}
    </>
  )
}

/** While the agent asks, the question to answer with a key, since it takes no words until then;
 * otherwise a reply, with the status line under it. */
export function SessionDock({ mid, paneId, project, session, state }: Parts) {
  const { reading, text, reread, taken, asking, terminal } = state
  if (asking && text !== null)
    return (
      <div className="flex flex-col gap-2">
        <Asking
          mid={mid}
          paneId={paneId}
          name={session.name}
          question={reading?.question}
          screen={text}
          terminal={terminal}
          onAnswered={reread}
        />
        {/* The question's own block offers the terminal when it was read. */}
        {reading?.question ? null : <AnswerElsewhere terminal={terminal} />}
      </div>
    )
  return (
    <Composer
      mid={mid}
      paneId={paneId}
      onSent={reread}
      uploads={{ machine: project.machine, taken }}
      below={
        <StatusBar
          mid={mid}
          paneId={paneId}
          kind={session.kind}
          status={session.status}
          footer={reading?.footer}
          onChanged={reread}
        />
      }
    />
  )
}

/** How to reach the session by hand, and the path its calls take; mounted only while shown, so the
 * path stops being read with it. */
export function SessionFacts({ mid, project, session }: Omit<Parts, 'paneId' | 'state'>) {
  const t = useI18n()
  const view = useSpaceView()
  const now = useNow()
  // Reading the screen and sending keys are calls, so the page's path is the calls' path.
  const { via, ...link } = useLink(mid, 'calls')
  const pane = { session }
  return (
    <InfoFacts
      groups={[
        ...paneFacts(t, now, project, pane),
        ...(via
          ? [connectionFacts(t, { via, relay: { url: RELAY_URL, status: view.status }, ...link })]
          : []),
      ]}
      command={{ label: t('facts.attach'), text: attachCommand(project, pane) }}
    />
  )
}
