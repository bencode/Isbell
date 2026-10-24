// One session: what its agent shows (screen text until the conversation view arrives with
// isbell-ext), a way to answer or add to it, and the facts needed to reach it by hand.

import { type Project, paneKey, readScreen, type Session } from '@isbell/core'
import { ChevronLeft, Square, SquareTerminal } from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router'
import { Button, buttonClass } from '../../components/button'
import { StatusChip } from '../../components/chip'
import { shellArg } from '../../components/command'
import { InfoPanel, InfoToggle } from '../../components/info-panel'
import { errorText, useI18n } from '../../core/i18n'
import { connectionFacts, paneFacts } from '../../core/pane-facts'
import { getLocal, toggleInfo, updateLocal, useLocal } from '../../core/prefs'
import { RELAY_URL, useProjects, useSpace, useSpaceView } from '../../core/space'
import { projectHref, terminalHref } from '../../utils/hrefs'
import { useNow } from '../../utils/time'
import { Asking } from './asking'
import { Composer } from './composer'
import { EndSession } from './end-session'

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
  const attach = `isbell terminal attach --control ${shellArg(`${project.machine}/${session.name}`)}`
  return (
    <div className="flex h-full flex-col">
      <header className="flex h-[52px] flex-none items-center gap-2 border-b border-line px-3">
        <Link to={back} className={buttonClass('quiet', '', 'icon')} aria-label={t('session.back')}>
          <ChevronLeft size={18} />
        </Link>
        <span className="px-1 font-semibold">{session.name}</span>
        <StatusChip status={session.status} label={t(`status.${session.status}`)} />
        <span className="ml-2 truncate text-muted">
          {project.machine} · {project.display}
        </span>
        <span className="flex-1" />
        <Button onClick={() => navigate(terminalHref(mid, paneId))}>
          <SquareTerminal size={15} />
          {t('session.terminal')}
        </Button>
        <Button variant="end" onClick={() => setEnding(true)} title={t('session.endHint')}>
          <Square size={12} fill="currentColor" />
          {t('session.end')}
        </Button>
        <InfoToggle open={info} onToggle={toggleInfo} label={t('info.toggle')} />
      </header>
      <div className="flex min-h-0 flex-1">
        <div className="flex min-w-0 flex-1 flex-col gap-4 p-5">
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
            className="m-0 min-h-0 flex-1 overflow-auto rounded-xl border border-line bg-raised p-4 font-mono text-[12.5px] leading-snug whitespace-pre-wrap text-text"
          >
            {screen ?? t('session.reading')}
          </pre>
          {error ? <p className="m-0 text-[13px] text-danger">{errorText(t, error)}</p> : null}
          <Composer mid={mid} paneId={paneId} onSent={reread} />
        </div>
        {info ? (
          <InfoPanel
            groups={[
              ...paneFacts(t, now, project, { session }),
              // Reading the screen and sending keys are calls, and calls go through the relay.
              connectionFacts(t, { via: 'relay', relay: { url: RELAY_URL, status: view.status } }),
            ]}
            command={{ label: t('facts.attach'), text: attach }}
          />
        ) : null}
      </div>
      <EndSession
        open={ending}
        onOpenChange={setEnding}
        mid={mid}
        paneId={paneId}
        name={session.name}
        machine={project.machine}
        path={project.display}
        onEnded={() => navigate(back)}
      />
    </div>
  )
}
