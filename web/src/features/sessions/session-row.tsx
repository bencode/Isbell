// One session recorded in a project: what it was first and last asked, where under the project it
// ran, and when; a way to its pane while it runs, else to resume it in a new one where it ran.

import { ArrowRight, Play } from 'lucide-react'
import { useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { errorText, useI18n } from '../../core/i18n'
import { useSpace } from '../../core/space'
import { startAgent } from '../../model/herdr'
import type { Project } from '../../model/projects'
import { type MonthLine, resumeArgs, type SessionRecord } from '../../model/sessions'
import { peekHref } from '../../utils/hrefs'

const ACTION =
  'inline-flex size-7 flex-none cursor-pointer items-center justify-center rounded-md border border-line bg-raised text-muted hover:border-line-strong hover:text-text disabled:cursor-default disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-accent'

type Props = {
  project: Project
  session: SessionRecord | MonthLine
  /** When it was last active, as the list shows it. */
  at: string
  /** The pane it runs in now, if it does. */
  pane?: string | undefined
}

export function SessionRow({ project, session, at, pane }: Props) {
  const t = useI18n()
  const space = useSpace()
  const navigate = useNavigate()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const args = resumeArgs(session.agent, session.id)
  const last = 'last' in session && session.last !== session.first ? session.last : undefined
  const under = session.cwd.startsWith(`${project.path}/`) ? session.cwd.slice(project.path.length + 1) : ''

  const resume = async () => {
    if (!args || busy) return
    setBusy(true)
    setError(undefined)
    try {
      const started = await startAgent(space.call, project.mid, {
        cwd: session.cwd,
        kind: session.agent,
        args,
      })
      navigate(peekHref(project.key, project.mid, started.paneId))
    } catch (err) {
      setError(errorText(t, err))
    } finally {
      // The list stays as it was beneath other pages, to be resumed from again.
      setBusy(false)
    }
  }

  return (
    <li className="flex flex-col gap-1 px-3 py-2.5">
      <div className="flex items-center gap-3">
        <span className="w-[54px] flex-none rounded-full border border-line-strong text-center font-mono text-[11px] text-muted">
          {session.agent}
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate font-semibold">{session.first}</div>
          {last ? <div className="truncate text-[12.5px] text-faint">{last}</div> : null}
        </div>
        {under ? (
          <span className="max-w-[30%] flex-none truncate font-mono text-[11.5px] text-faint">{under}</span>
        ) : null}
        <span className="flex-none font-mono text-[11.5px] text-faint">{at}</span>
        {pane ? (
          <>
            <span className="flex flex-none items-center gap-1.5 text-xs text-accent">
              <span className="size-[7px] rounded-full bg-accent" />
              {t('sessions.running')}
            </span>
            <Link
              to={peekHref(project.key, project.mid, pane)}
              title={t('sessions.jump')}
              aria-label={t('sessions.jump')}
              className={ACTION}
            >
              <ArrowRight size={14} />
            </Link>
          </>
        ) : args && project.online ? (
          <button
            type="button"
            onClick={() => void resume()}
            disabled={busy}
            title={t('sessions.resume')}
            aria-label={t('sessions.resume')}
            className={ACTION}
          >
            <Play size={13} />
          </button>
        ) : null}
      </div>
      {error ? <p className="m-0 pl-[66px] text-xs text-danger">{error}</p> : null}
    </li>
  )
}
