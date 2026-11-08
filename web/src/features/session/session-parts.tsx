// The parts of a session's chat: its conversation as the agent records it, the dock that adds to
// it, and the facts needed to reach it by hand. What the agent's screen shows is in its terminal.

import { type ReactNode, useEffect } from 'react'
import { InfoFacts } from '../../components/info-panel'
import { useChatLog } from '../../core/chat-log'
import { errorText, useI18n } from '../../core/i18n'
import { markSeen } from '../../core/prefs'
import { useSessionRecords } from '../../core/session-records'
import { RELAY_URL, useSpaceView } from '../../core/space'
import { type Pane, type Project, paneKey, type Session } from '../../model/projects'
import { machineOf, type Via } from '../../model/space'
import { useNow } from '../../utils/time'
import { AskingBanner } from './asking'
import { Composer } from './composer'
import { PathRoot, TerminalLink } from './context'
import { Conversation, EarlierButton, Marker } from './conversation'
import { attachCommand, connectionFacts, paneFacts } from './facts'
import { useLink } from './use-link'

/** A session as its chat shows it: its conversation as recorded, and what can be done with it. */
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
  const { recent } = useSessionRecords(project)
  // Not a session of the agent the pane ran before this one.
  const own = ran?.agent === session.kind ? ran : undefined
  const transcript = own && recent?.find(r => r.agent === own.agent && r.id === own.id)?.transcript
  const log = useChatLog(mid, session.kind, transcript, session.status)
  const methods = machineOf(view.machines, mid)?.state.caps.methods

  // Looking at a finished session marks it read.
  useEffect(() => {
    if (session.status === 'done') markSeen(paneKey(mid, paneId), session.statusSince)
  }, [session, mid, paneId])

  // Until the project's records are read, a record may still be found.
  return { log, transcript, read: recent !== undefined, taken: !!methods?.includes('isbell.file.upload') }
}

type Parts = { mid: string; paneId: string; project: Project; session: Session; state: SessionState }

/**
 * The conversation as recorded, with what was just sent until the record has it, and the agent's
 * question, answered in its terminal. Without a record yet, why there may be none.
 */
export function SessionBody({
  mid,
  paneId,
  project,
  session,
  state,
  pending,
}: Parts & { pending: string | undefined }) {
  const t = useI18n()
  const { log, transcript, read } = state
  const asking =
    session.status === 'blocked' ? <AskingBanner mid={mid} paneId={paneId} name={session.name} /> : null
  const note = (children: ReactNode) => (
    <p className="m-0 mb-[18px] text-[13px] leading-relaxed text-muted">{children}</p>
  )
  const top = log.turns ? (
    <Marker>
      {log.start ? t('chat.start') : <EarlierButton onClick={log.earlier} paging={log.paging} />}
    </Marker>
  ) : log.unread ? (
    note(t('chat.unreadRecord'))
  ) : transcript || !read ? (
    note(t('session.reading'))
  ) : (
    note(
      <>
        {t('chat.noRecord')} <TerminalLink>{t('session.terminal')}</TerminalLink>
      </>,
    )
  )
  return (
    <>
      <PathRoot value={{ project, cwd: session.cwd ?? project.path }}>
        <Conversation
          turns={log.turns ?? []}
          kind={session.kind}
          status={session.status}
          statusSince={session.statusSince}
          top={top}
          asking={asking}
          pending={pending}
        />
      </PathRoot>
      {log.error ? <p className="m-0 text-[13px] text-danger">{errorText(t, log.error)}</p> : null}
    </>
  )
}

/** A reply, sent as typed into the agent; while the agent asks, its terminal takes the answer, as
 * words typed here would land in its menu. */
export function SessionDock({
  mid,
  paneId,
  project,
  session,
  state,
  onDraft,
  onSent,
}: Parts & { onDraft: () => void; onSent: (text: string) => void }) {
  const t = useI18n()
  if (session.status === 'blocked')
    return (
      <p className="m-0 text-[12.5px] text-muted">
        {t('chat.answerAbove')} <TerminalLink>{t('ask.inTerminal')}</TerminalLink>
      </p>
    )
  return (
    <Composer
      mid={mid}
      paneId={paneId}
      onSent={onSent}
      onDraft={onDraft}
      uploads={{ machine: project.machine, taken: state.taken }}
      stoppable={session.status === 'working'}
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
