// A pane in the browser: an agent's or a shell's, under full control. Leave detaches and goes
// back; End terminal closes the pane.

import '@xterm/xterm/css/xterm.css'
import type { Project } from '@isbell/core'
import { ChevronLeft, MessageSquare, Square } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router'
import { Button, buttonClass } from '../../components/button'
import { errorText, useT } from '../../core/i18n'
import { useProjects, useSpace, useSpaceView } from '../../core/space'
import { projectHref, sessionHref } from '../../utils/hrefs'
import { EndTerminal } from './end-terminal'
import { useTerminal } from './use-terminal'

type Found = { project: Project; name: string; agent: boolean }

/** The project a pane belongs to, and what to call it: the agent's name, or the shell's title. */
const locate = (projects: Project[], mid: string, paneId: string): Found | undefined =>
  projects
    .filter(p => p.mid === mid)
    .flatMap(project => {
      const session = project.sessions.find(s => s.paneId === paneId)
      const shell = project.shells.find(s => s.paneId === paneId)
      if (session) return [{ project, name: session.name, agent: true }]
      return shell ? [{ project, name: shell.title ?? paneId, agent: false }] : []
    })[0]

export function TerminalPage() {
  const t = useT()
  const params = useParams()
  const mid = params.mid ?? ''
  const paneId = params.pane ?? ''
  const space = useSpace()
  const view = useSpaceView()
  const found = locate(useProjects(), mid, paneId)

  // Shells are pulled every so often; one opened a moment ago may not be listed yet.
  useEffect(() => {
    if (view.loaded && !found) void space.refreshShells(mid)
  }, [view.loaded, found, space, mid])

  if (!view.loaded) return <p className="m-6 text-muted">{t('board.loading')}</p>
  if (!found)
    return (
      <div className="m-6 flex flex-col items-start gap-3">
        <p className="m-0 text-muted">{t('terminal.gone')}</p>
        <Link to="/">{t('project.back')}</Link>
      </div>
    )
  return <Attached key={`${mid}/${paneId}`} mid={mid} paneId={paneId} found={found} />
}

function Attached({ mid, paneId, found }: { mid: string; paneId: string; found: Found }) {
  const t = useT()
  const navigate = useNavigate()
  const location = useLocation()
  const box = useRef<HTMLDivElement>(null)
  const { state, reconnect } = useTerminal(box, mid, paneId)
  const [ending, setEnding] = useState(false)
  const { project, name, agent } = found
  const home = projectHref(project.key)
  // Opened from a link, there is no page of ours to go back to.
  const leave = () => (location.key === 'default' ? navigate(home) : navigate(-1))

  return (
    <div className="flex h-full flex-col">
      <header className="flex h-[52px] flex-none items-center gap-2 border-b border-line px-3">
        <Button variant="quiet" onClick={leave} title={t('terminal.leaveHint')}>
          <ChevronLeft size={16} />
          {t('terminal.leave')}
        </Button>
        <span className="px-1 font-semibold">{name}</span>
        <span className="ml-1 truncate text-muted">
          {project.machine} · {project.display}
        </span>
        <span className="flex-1" />
        {agent ? (
          <Link to={sessionHref(mid, paneId)} className={buttonClass()}>
            <MessageSquare size={15} />
            {t('terminal.chat')}
          </Link>
        ) : null}
        <Button
          variant="end"
          onClick={() => setEnding(true)}
          title={agent ? t('session.endHint') : undefined}
        >
          <Square size={12} fill="currentColor" />
          {agent ? t('session.end') : t('terminal.end')}
        </Button>
      </header>
      <div className="relative min-h-0 flex-1 bg-raised p-2">
        <div ref={box} className="h-full w-full bg-raised text-text" />
        {state.phase === 'ended' ? (
          <div className="absolute inset-0 grid place-items-center bg-scrim">
            <div className="flex max-w-md flex-col items-start gap-3 rounded-xl border border-line bg-raised p-5">
              <p className="m-0 font-semibold">{t('terminal.ended')}</p>
              {state.error ? <p className="m-0 text-[13px] text-muted">{errorText(t, state.error)}</p> : null}
              <Button variant="primary" onClick={reconnect}>
                {t('terminal.reconnect')}
              </Button>
            </div>
          </div>
        ) : null}
      </div>
      <footer className="flex flex-none gap-4 border-t border-line px-4 py-1.5 font-mono text-xs text-faint">
        <span>
          {state.phase === 'opening' ? t('terminal.opening') : state.via ? t(`via.${state.via}`) : ''}
        </span>
        <span>{t('terminal.control')}</span>
        {state.size ? (
          <span>
            {state.size.cols}×{state.size.rows}
          </span>
        ) : null}
      </footer>
      <EndTerminal
        open={ending}
        onOpenChange={setEnding}
        mid={mid}
        paneId={paneId}
        name={name}
        machine={project.machine}
        path={project.display}
        agent={agent}
        onEnded={() => navigate(home)}
      />
    </div>
  )
}
