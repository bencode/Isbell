// One session: what its agent shows (screen text until the conversation view arrives with
// isbell-ext), a way to answer or add to it, and the facts needed to reach it by hand.

import { type Project, paneKey, readScreen, type Session } from '@isbell/core'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router'
import { InfoPanel } from '../../components/info-panel'
import { errorText, useI18n } from '../../core/i18n'
import { attachCommand, connectionFacts, paneFacts } from '../../core/pane-facts'
import { getLocal, updateLocal, useLocal } from '../../core/prefs'
import { RELAY_URL, useProjects, useSpace, useSpaceView } from '../../core/space'
import { projectHref } from '../../utils/hrefs'
import { useNow } from '../../utils/time'
import { Asking } from './asking'
import { Composer } from './composer'
import { EndPane } from './end-pane-dialog'
import { PaneHeader } from './pane-header'

const READ_EVERY_MS = 2_000

/**
 * The pane's output, read again 2s after each read returns while the page is visible. herdr
 * captures a full-screen agent's scrollback only while it is known to be idle; otherwise the
 * screen alone is read.
 */
function useScreen(mid: string, paneId: string, scrollback: boolean) {
  const space = useSpace()
  const [screen, setScreen] = useState<string | null>(null)
  const [error, setError] = useState<unknown>()
  // Bumped to read at once; the chain then starts over.
  const [round, setRound] = useState(0)
  // biome-ignore lint/correctness/useExhaustiveDependencies: `round` is how reread starts a new chain.
  useEffect(() => {
    // One read at a time; once the effect is over, its chain stops and a late answer is dropped.
    let live = true
    const tick = async () => {
      if (!live) return
      if (document.visibilityState === 'visible')
        await readScreen(space.call, mid, paneId, scrollback ? 'recent' : 'visible').then(
          text => {
            if (!live) return
            setScreen(text)
            setError(undefined)
          },
          err => {
            if (live) setError(err)
          },
        )
      if (live) setTimeout(tick, READ_EVERY_MS)
    }
    void tick()
    return () => {
      live = false
    }
  }, [space, mid, paneId, scrollback, round])
  return { screen, error, reread: () => setRound(n => n + 1) }
}

export function SessionPage() {
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
        <Link to="/">{t('project.back')}</Link>
      </div>
    )
  // Keyed, so moving to another session starts its page over instead of showing this one's screen.
  return (
    <SessionView key={paneKey(mid, paneId)} mid={mid} paneId={paneId} project={project} session={session} />
  )
}

function SessionView({
  mid,
  paneId,
  project,
  session,
}: {
  mid: string
  paneId: string
  project: Project
  session: Session
}) {
  const t = useI18n()
  const view = useSpaceView()
  const navigate = useNavigate()
  const now = useNow()
  const promptError = (useLocation().state as { promptError?: { msg: string } } | null)?.promptError
  const [ending, setEnding] = useState(false)
  const info = useLocal().layout.info
  const settled = session.status === 'idle' || session.status === 'done'
  const { screen, error, reread } = useScreen(mid, paneId, settled)

  // Looking at a finished session marks it read.
  useEffect(() => {
    if (session.status !== 'done') return
    const key = paneKey(mid, paneId)
    if ((getLocal().seen[key] ?? 0) >= session.statusSince) return
    updateLocal(l => ({ seen: { ...l.seen, [key]: session.statusSince } }))
  }, [session, mid, paneId])

  const pre = useRef<HTMLPreElement>(null)
  const pinned = useRef(true)
  useLayoutEffect(() => {
    if (screen !== null && pre.current && pinned.current) pre.current.scrollTop = pre.current.scrollHeight
  }, [screen])

  const back = projectHref(project.key)
  const pane = { session }
  return (
    <div className="flex h-full flex-col">
      <PaneHeader
        found={{ project, name: session.name, pane }}
        mid={mid}
        paneId={paneId}
        view="chat"
        onEnd={() => setEnding(true)}
      />
      <div className="flex min-h-0 flex-1">
        <div className="paper flex min-w-0 flex-1 flex-col gap-4 p-5">
          {promptError ? (
            <p className="m-0 rounded-lg border border-ask-line bg-ask px-3.5 py-2 text-[13px]">
              {t('session.promptFailed', { msg: promptError.msg })}
            </p>
          ) : null}
          {session.status === 'blocked' && screen !== null ? (
            <Asking mid={mid} paneId={paneId} name={session.name} screen={screen} />
          ) : null}
          <pre
            ref={pre}
            onScroll={e => {
              const el = e.currentTarget
              pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24
            }}
            className="m-0 min-h-0 flex-1 overflow-auto rounded-lg border border-line bg-raised p-4 font-mono text-[12.5px] leading-snug whitespace-pre-wrap text-text"
          >
            {screen ?? t('session.reading')}
          </pre>
          {error ? <p className="m-0 text-[13px] text-danger">{errorText(t, error)}</p> : null}
          <Composer mid={mid} paneId={paneId} onSent={reread} />
        </div>
        {info ? (
          <InfoPanel
            groups={[
              ...paneFacts(t, now, project, pane),
              // Reading the screen and sending keys are calls, and calls go through the relay.
              connectionFacts(t, { via: 'relay', relay: { url: RELAY_URL, status: view.status } }),
            ]}
            command={{ label: t('facts.attach'), text: attachCommand(project, pane) }}
          />
        ) : null}
      </div>
      <EndPane
        open={ending}
        onOpenChange={setEnding}
        mid={mid}
        paneId={paneId}
        name={session.name}
        machine={project.machine}
        path={project.display}
        agent
        onEnded={() => navigate(back)}
      />
    </div>
  )
}
