// One session: what its agent shows, read from its screen as turns (or the screen text when it
// cannot be read so), a way to answer or add to it, and the facts needed to reach it by hand.

import { SquareTerminal } from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router'
import { buttonClass } from '../../components/button'
import { InfoFacts } from '../../components/info-panel'
import { errorText, useI18n } from '../../core/i18n'
import { attachCommand, connectionFacts, paneFacts } from '../../core/pane-facts'
import { markSeen, rememberView } from '../../core/prefs'
import { RELAY_URL, useProjects, useSpaceView } from '../../core/space'
import { PathRoot } from '../../core/tabs'
import { type Project, paneKey, type Session } from '../../model/projects'
import { machineOf } from '../../model/space'
import { settled } from '../../model/state'
import { projectHref, terminalHref } from '../../utils/hrefs'
import { useNow } from '../../utils/time'
import { Asking } from './asking'
import { Composer } from './composer'
import { EndPane } from './end-pane-dialog'
import type { PaneLayout } from './pane-layout'
import { Turns } from './turns'
import { useLink } from './use-link'
import { useReading } from './use-reading'

// The reading column: as wide as the pane up to a wide screen, then centred.
const COLUMN = 'mx-auto w-full max-w-[1240px] px-4 sm:px-8'

/** `after`: where to go once the session is ended or found gone; its project's board unless given. */
export function SessionPage({ layout, after }: { layout: PaneLayout; after?: string }) {
  const t = useI18n()
  const params = useParams()
  const mid = params.mid ?? ''
  const paneId = params.pane ?? ''
  const view = useSpaceView()
  const projects = useProjects()
  const project = projects.find(p => p.mid === mid && p.sessions.some(s => s.paneId === paneId))
  const session = project?.sessions.find(s => s.paneId === paneId)

  if (!view.loaded) return <p className="m-6 text-muted">{t('board.loading')}</p>
  if (!project || !session)
    return (
      <div className="m-6 flex flex-col items-start gap-3">
        <p className="m-0 text-muted">{t('session.gone')}</p>
        <Link to={after ?? '/'}>{t('project.back')}</Link>
      </div>
    )
  // Keyed, so moving to another session starts its page over instead of showing this one's screen.
  return (
    <SessionView
      key={paneKey(mid, paneId)}
      layout={layout}
      mid={mid}
      paneId={paneId}
      project={project}
      session={session}
      after={after ?? projectHref(project.key)}
    />
  )
}

function SessionView({
  layout: Layout,
  mid,
  paneId,
  project,
  session,
  after,
}: {
  layout: PaneLayout
  mid: string
  paneId: string
  project: Project
  session: Session
  after: string
}) {
  const t = useI18n()
  const view = useSpaceView()
  const navigate = useNavigate()
  const now = useNow()
  const promptError = (useLocation().state as { promptError?: { msg: string } } | null)?.promptError
  const [ending, setEnding] = useState(false)
  const { reading, text, error, reread, earlier, paging, more } = useReading(mid, paneId, session)
  // Reading the screen and sending keys are calls, so the page's path is the calls' path.
  const { via, ...link } = useLink(mid, 'calls')
  // Earlier turns are read a page at a time from a gateway that pages, while the agent is still.
  const canPage =
    more &&
    settled(session.status) &&
    !!machineOf(view.machines, mid)?.state.caps.methods.includes('isbell.agent.history')
  const uploads = !!machineOf(view.machines, mid)?.state.caps.methods.includes('isbell.file.upload')

  // The sidebar and the drawer open an agent in the view it was last seen in.
  useEffect(() => {
    rememberView(paneKey(mid, paneId), 'chat')
  }, [mid, paneId])

  // Looking at a finished session marks it read.
  useEffect(() => {
    if (session.status === 'done') markSeen(paneKey(mid, paneId), session.statusSince)
  }, [session, mid, paneId])

  // The page follows what comes in while it is scrolled to the end.
  const scroller = useRef<HTMLDivElement>(null)
  const pinned = useRef(true)
  useLayoutEffect(() => {
    const el = scroller.current
    if ((reading || text !== null) && el && pinned.current) el.scrollTop = el.scrollHeight
  }, [reading, text])

  const terminal = terminalHref(mid, paneId)
  const pane = { session }
  const asking = session.status === 'blocked' && text !== null
  const facts = (
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
  return (
    <>
      <Layout
        found={{ project, name: session.name, pane }}
        mid={mid}
        paneId={paneId}
        view="chat"
        onEnd={() => setEnding(true)}
        facts={facts}
      >
        <div
          ref={scroller}
          onScroll={e => {
            const el = e.currentTarget
            pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24
          }}
          className="paper min-h-0 flex-1 overflow-auto"
        >
          <div className={`${COLUMN} flex flex-col gap-3.5 pt-5 pb-7`}>
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
                  onEarlier={canPage ? earlier : undefined}
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
          </div>
        </div>
        <div className="flex-none border-t border-line bg-bg">
          <div className={`${COLUMN} pt-3 pb-3.5`}>
            {asking ? (
              <Asking
                mid={mid}
                paneId={paneId}
                name={session.name}
                question={reading?.question}
                screen={text}
                terminal={terminal}
                onAnswered={reread}
              />
            ) : null}
            {asking && reading?.question ? null : (
              <div className={asking ? 'mt-3' : ''}>
                <Composer mid={mid} paneId={paneId} onSent={reread} uploads={uploads} />
              </div>
            )}
          </div>
        </div>
      </Layout>
      <EndPane
        open={ending}
        onOpenChange={setEnding}
        mid={mid}
        paneId={paneId}
        name={session.name}
        machine={project.machine}
        path={project.display}
        agent
        onEnded={() => navigate(after)}
      />
    </>
  )
}
