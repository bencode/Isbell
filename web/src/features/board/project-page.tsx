import { SquareTerminal } from 'lucide-react'
import { useState } from 'react'
import { Link, useParams } from 'react-router'
import { useI18n } from '../../core/i18n'
import { useProjects, useSpaceView } from '../../core/space'
import { lanes, type Project } from '../../model/projects'
import type { AgentStatus } from '../../model/state'
import { terminalHref } from '../../utils/hrefs'
import { useNow } from '../../utils/time'
import { AskingCard } from './cards/asking-card'
import { FinishedCard } from './cards/finished-card'
import { SessionCard } from './session-card'

const FILTERS: AgentStatus[] = ['blocked', 'working', 'done', 'idle']

/** The project the board is focused on, from the route. */
function useFocused(projects: Project[]): Project | undefined {
  const { key } = useParams()
  return key ? projects.find(p => p.key === key) : undefined
}

/** The plain shells running in a project; each opens in a terminal. */
function Shells({ project }: { project: Project }) {
  if (!project.shells.length) return null
  return (
    <div className="flex flex-wrap gap-2">
      {project.shells.map(s => (
        <Link
          key={s.paneId}
          to={terminalHref(s.mid, s.paneId)}
          className="inline-flex h-8 items-center gap-2 rounded-lg border border-line bg-raised px-3 font-mono text-[12.5px] text-muted no-underline hover:text-text"
        >
          <SquareTerminal size={13} />
          {s.paneId} · {project.display}
          {s.cwd.slice(project.path.length)}
        </Link>
      ))}
    </div>
  )
}

export function ProjectView() {
  const t = useI18n()
  const view = useSpaceView()
  const projects = useProjects()
  const project = useFocused(projects)

  if (!view.loaded) return <p className="m-0 text-muted">{t('board.loading')}</p>
  if (!project)
    return (
      <div className="flex flex-col items-start gap-3">
        <p className="m-0 text-muted">{t('project.gone')}</p>
        <Link to="/">{t('project.back')}</Link>
      </div>
    )
  // Keyed so the status filter starts over for each project.
  return <Focused key={project.key} project={project} />
}

function Focused({ project }: { project: Project }) {
  const t = useI18n()
  const now = useNow()
  const [filter, setFilter] = useState<AgentStatus | null>(null)
  const counts = FILTERS.map(
    status => [status, project.sessions.filter(s => s.status === status).length] as const,
  )
  // A status whose last session left shows nothing; fall back to all.
  const active = filter && counts.some(([status, n]) => status === filter && n > 0) ? filter : null
  const shown = project.sessions.filter(s => !active || s.status === active)
  const chip = (on: boolean) =>
    `inline-flex h-[30px] cursor-pointer items-center gap-1.5 rounded-full border px-3 text-[13px] font-medium capitalize ${on ? 'border-line-strong bg-raised-2 text-text' : 'border-line bg-transparent text-muted'}`

  return (
    <>
      <div className="flex flex-wrap items-baseline gap-2.5">
        <h1 className="m-0 text-[23px] font-bold after:mt-1 after:block after:h-[3px] after:w-7 after:rounded-sm after:bg-accent after:content-['']">
          {project.name}
        </h1>
        <span className="font-mono text-xs text-faint">{project.display}</span>
        <span className="rounded-md border border-line px-1.5 text-xs text-muted">{project.machine}</span>
        {project.online ? null : (
          <span className="rounded-full border border-line px-2 text-xs text-muted">{t('side.offline')}</span>
        )}
      </div>
      <Needs project={project} now={now} />
      <section className="flex flex-col gap-3">
        <h2 className="m-0 flex items-baseline gap-2 text-base font-semibold">
          {t('project.live')}{' '}
          <span className="text-sm font-normal text-faint">{project.sessions.length}</span>
        </h2>
        {project.sessions.length ? (
          <>
            <div className="flex flex-wrap gap-1.5">
              <button type="button" className={chip(active === null)} onClick={() => setFilter(null)}>
                {t('project.all')} <span className="text-xs text-faint">{project.sessions.length}</span>
              </button>
              {counts
                .filter(([, n]) => n)
                .map(([status, n]) => (
                  <button
                    key={status}
                    type="button"
                    className={chip(active === status)}
                    onClick={() => setFilter(status)}
                  >
                    {t(`status.${status}`)} <span className="text-xs text-faint">{n}</span>
                  </button>
                ))}
            </div>
            <div className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-3">
              {shown.map(s => (
                <SessionCard key={s.paneId} session={s} now={now} />
              ))}
            </div>
          </>
        ) : (
          <p className="m-0 text-muted">{project.online ? t('project.none') : t('project.offline')}</p>
        )}
        <Shells project={project} />
      </section>
    </>
  )
}

/** The project's agents that ask or finished unseen, answered on their cards. */
function Needs({ project, now }: { project: Project; now: number }) {
  const t = useI18n()
  const { asking, finished } = lanes([project])
  if (!asking.length && !finished.length) return null
  return (
    <section className="flex flex-col gap-2.5">
      <h2 className="m-0 flex items-baseline gap-2 text-base font-semibold">
        {t('needs.title')}{' '}
        <span className="text-sm font-normal text-faint">{asking.length + finished.length}</span>
      </h2>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(320px,1fr))] items-start gap-3">
        {asking.map(p => (
          <AskingCard key={p.session.paneId} placed={p} now={now} />
        ))}
        {finished.map(p => (
          <FinishedCard key={p.session.paneId} placed={p} now={now} />
        ))}
      </div>
    </section>
  )
}
