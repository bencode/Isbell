// The parts of a session's chat: its conversation, read from the agent's record (else its screen),
// the dock that answers or adds to it, and the facts needed to reach it by hand.

import { SquareTerminal } from 'lucide-react'
import { useEffect } from 'react'
import { buttonClass } from '../../components/button'
import { InfoFacts } from '../../components/info-panel'
import { useChatLog } from '../../core/chat-log'
import { errorText, useI18n } from '../../core/i18n'
import { markSeen } from '../../core/prefs'
import { useSessionRecords } from '../../core/session-records'
import { RELAY_URL, useSpaceView } from '../../core/space'
import { fromScreen } from '../../model/chat/screen'
import { type Pane, type Project, paneKey, type Session } from '../../model/projects'
import { machineOf, type Via } from '../../model/space'
import { settled } from '../../model/state'
import { useNow } from '../../utils/time'
import { AnswerElsewhere, Asking } from './asking'
import { Composer } from './composer'
import { PathRoot, TerminalLink, useShowTerminal } from './context'
import { Conversation, Marker } from './conversation'
import { attachCommand, connectionFacts, paneFacts } from './facts'
import { StatusBar } from './status-bar'
import { useLink } from './use-link'
import { useReading } from './use-reading'

/** A session as its chat shows it: its conversation as recorded, what is read from its screen, and
 * what can be done with it. */
type SessionState = ReturnType<typeof useSession>

/** `ran`: the session the agent in the pane runs, once known. */
export function useSession(
  mid: string,
  paneId: string,
  session: Session,
  project: Project,
  ran: { agent: string; id: string } | undefined,
) {
  const view = useSpaceView()
  const { earlier, ...read } = useReading(mid, paneId, session)
  const { recent } = useSessionRecords(project)
  // Not a session of the agent the pane ran before this one.
  const own = ran?.agent === session.kind ? ran : undefined
  const transcript = own && recent?.find(r => r.agent === own.agent && r.id === own.id)?.transcript
  const log = useChatLog(mid, session.kind, transcript, session.status)
  const methods = machineOf(view.machines, mid)?.state.caps.methods
  // Earlier turns are read a page at a time from a gateway that pages, while the agent is still.
  const canPage = read.more && settled(session.status) && !!methods?.includes('isbell.agent.history')

  // Looking at a finished session marks it read.
  useEffect(() => {
    if (session.status === 'done') markSeen(paneKey(mid, paneId), session.statusSince)
  }, [session, mid, paneId])

  return {
    ...read,
    log,
    onEarlier: canPage ? earlier : undefined,
    taken: !!methods?.includes('isbell.file.upload'),
    // Waiting for an answer, with its screen read to answer from.
    asking: session.status === 'blocked' && read.text !== null,
  }
}

type Parts = { mid: string; paneId: string; project: Project; session: Session; state: SessionState }

/** The conversation as recorded, else as read off the screen, else the screen itself; the question
 * the agent waits on under it; and what went wrong. */
export function SessionBody({ mid, paneId, project, session, state }: Parts) {
  const t = useI18n()
  const showTerminal = useShowTerminal()
  const { reading, text, error, onEarlier, paging, more, log, asking, reread } = state
  // The screen's error, else the record's, which stops the chat following it.
  const failed = error ?? log.error
  const question =
    asking && text !== null ? (
      <>
        <Asking
          mid={mid}
          paneId={paneId}
          name={session.name}
          question={reading?.question}
          screen={text}
          onAnswered={reread}
        />
        {/* The question's own block offers the terminal when it was read. */}
        {reading?.question ? null : <AnswerElsewhere />}
      </>
    ) : null
  const turns = log.turns ?? (reading ? fromScreen(reading) : undefined)
  const top = log.turns ? (
    <Marker>
      {log.start ? t('chat.start') : <EarlierButton onClick={log.earlier} paging={log.paging} />}
    </Marker>
  ) : reading ? (
    <>
      <p className="m-0 mb-[18px] rounded-md border border-dashed border-line-strong px-2.5 py-1.5 text-xs text-faint">
        {t('chat.fromScreen')}
      </p>
      <Marker>
        {reading.start ? (
          t('chat.start')
        ) : onEarlier ? (
          <EarlierButton onClick={onEarlier} paging={paging} />
        ) : more && !settled(session.status) ? (
          t('chat.afterStop')
        ) : more ? (
          <span>
            {t('chat.earlier')} · <TerminalLink>{t('session.terminal')}</TerminalLink>
          </span>
        ) : (
          t('chat.noEarlier')
        )}
      </Marker>
    </>
  ) : null
  return (
    <>
      {turns ? (
        <PathRoot value={{ project, cwd: session.cwd ?? project.path }}>
          <Conversation
            turns={turns}
            kind={session.kind}
            status={session.status}
            statusSince={session.statusSince}
            top={top}
            asking={question}
          />
        </PathRoot>
      ) : text === null ? (
        <p className="m-0 text-muted">{t('session.reading')}</p>
      ) : (
        <>
          <div className="flex items-center gap-3 rounded-md border border-line-strong bg-raised px-3.5 py-2.5 text-[13px] text-muted">
            <span className="flex-1">{t('chat.unreadable')}</span>
            <button type="button" onClick={showTerminal} className={buttonClass('default', '', 'small')}>
              <SquareTerminal size={14} />
              {t('session.terminal')}
            </button>
          </div>
          {/* On the terminal's night page, in its ink (NIGHT in use-terminal.ts). */}
          <pre className="m-0 overflow-auto rounded-md bg-term px-4 py-3.5 font-mono text-[12.5px] leading-normal whitespace-pre-wrap text-[#e9e5d9]">
            {text}
          </pre>
          {question}
        </>
      )}
      {failed ? <p className="m-0 text-[13px] text-danger">{errorText(t, failed)}</p> : null}
    </>
  )
}

function EarlierButton({ onClick, paging }: { onClick: () => void; paging: boolean }) {
  const t = useI18n()
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={paging}
      className="h-[26px] cursor-pointer rounded-full border border-line bg-raised px-3 text-xs font-medium text-accent enabled:hover:bg-raised-2 focus-visible:outline-2 focus-visible:outline-accent disabled:cursor-default disabled:text-faint"
    >
      {paging ? t('chat.readingEarlier') : t('chat.showEarlier')}
    </button>
  )
}

/** While the agent asks, its question (in the chat above) takes the answer, since it takes no words
 * until then; otherwise a reply, with the status line under it. */
export function SessionDock({
  mid,
  paneId,
  project,
  session,
  state,
  onDraft,
}: Parts & { onDraft: () => void }) {
  const t = useI18n()
  const { reading, reread, taken, asking } = state
  if (asking) return <p className="m-0 text-[12.5px] text-muted">{t('chat.answerAbove')}</p>
  return (
    <Composer
      mid={mid}
      paneId={paneId}
      onSent={reread}
      onDraft={onDraft}
      uploads={{ machine: project.machine, taken }}
      stoppable={session.status === 'working'}
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

/** How to reach a pane by hand, and the path to it: a terminal's stream's `via`, else the path its
 * chat's calls take. Mounted only while shown, so the path stops being read with it. */
export function PaneFacts({
  mid,
  project,
  pane,
  via: stream,
}: {
  mid: string
  project: Project
  pane: Pane
  via: Via | 'calls' | undefined
}) {
  const t = useI18n()
  const view = useSpaceView()
  const now = useNow()
  const { via, ...link } = useLink(mid, stream)
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
