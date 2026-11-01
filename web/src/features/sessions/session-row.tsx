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

/** What a row says besides the first question: the last one, when it differs, and where under the
 * project it ran. */
const told = (project: Project, session: Props['session']) => ({
  last: 'last' in session && session.last !== session.first ? session.last : undefined,
  under: session.cwd.startsWith(`${project.path}/`) ? session.cwd.slice(project.path.length + 1) : '',
})

/** Resumes the session in a new pane where it ran, and goes to it; `args` undefined for an agent
 * that cannot be resumed. */
function useResume(project: Project, session: Props['session']) {
  const t = useI18n()
  const space = useSpace()
  const navigate = useNavigate()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const args = resumeArgs(session.agent, session.id)

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
  return { args, busy, error, resume }
}

export function SessionRow({ project, session, at, pane }: Props) {
  const t = useI18n()
  const { args, busy, error, resume } = useResume(project, session)
  const { last, under } = told(project, session)

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

// A finger-sized action, its words saying what it does.
const PHONE_ACTION =
  'inline-flex h-10 flex-none cursor-pointer items-center rounded-lg border px-3 text-[13px] font-semibold text-accent no-underline disabled:cursor-default disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-accent'

/** The same on a phone: what it was asked over two lines, the last question and where and when under
 * it, and the action as a button a finger can hit. */
export function PhoneSessionRow({ project, session, at, pane }: Props) {
  const t = useI18n()
  const { args, busy, error, resume } = useResume(project, session)
  const { last, under } = told(project, session)
  return (
    <li className="flex items-start gap-2.5 py-2.5 pr-3 pl-3.5">
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="line-clamp-2 font-semibold break-words">{session.first}</div>
        {last ? <div className="truncate text-[13px] text-muted">{last}</div> : null}
        <div className="flex min-w-0 gap-1.5 text-xs text-faint">
          {under ? <span className="min-w-0 truncate font-mono text-[11.5px]">{under}</span> : null}
          <span className="flex-none">{session.agent}</span>
          <span className="flex-none">{at}</span>
        </div>
        {error ? <p className="m-0 text-xs text-danger">{error}</p> : null}
      </div>
      {pane ? (
        <Link
          to={peekHref(project.key, project.mid, pane)}
          className={`${PHONE_ACTION} border-transparent bg-accent-soft active:opacity-80`}
        >
          {t('sessions.open')}
        </Link>
      ) : args && project.online ? (
        <button
          type="button"
          onClick={() => void resume()}
          disabled={busy}
          className={`${PHONE_ACTION} border-line-strong bg-raised active:bg-raised-2`}
        >
          {t('sessions.resumeShort')}
        </button>
      ) : null}
    </li>
  )
}
