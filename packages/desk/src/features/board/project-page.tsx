import { type AgentStatus, needs, type Project } from '@isbell/core'
import { SquareTerminal } from 'lucide-react'
import { useState } from 'react'
import { Link, useParams } from 'react-router'
import { useI18n } from '../../core/i18n'
import { useProjects, useSpaceView } from '../../core/space'
import { terminalHref } from '../../utils/hrefs'
import { useNow } from '../../utils/time'
import { NeedsSection, SessionCard } from './session-card'

const FILTERS: AgentStatus[] = ['blocked', 'working', 'done', 'idle']

/** The project the board is focused on, from the route. */
export function useFocused(projects: Project[]): Project | undefined {
  const { key } = useParams()
  return key ? projects.find(p => p.key === key) : undefined
}

/** The plain shells running in a project; each opens in a terminal. */
export function Shells({ project }: { project: Project }) {
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
          {s.paneId}
          {s.title ? ` · ${s.title}` : ''}
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
  const shown = project.sessions.filter(s => !filter || s.status === filter)
  const chip = (on: boolean) =>
    `inline-flex h-[30px] cursor-pointer items-center gap-1.5 rounded-full border px-3 text-[13px] font-medium capitalize ${on ? 'border-line-strong bg-raised-2 text-text' : 'border-line bg-transparent text-muted'}`

  return (
    <>
      <div className="flex flex-wrap items-center gap-2.5">
        <h1 className="m-0 text-[19px] font-semibold">{project.name}</h1>
        <span className="font-mono text-xs text-faint">{project.display}</span>
        <span className="rounded-md border border-line px-1.5 text-xs text-muted">{project.machine}</span>
        {project.online ? null : (
          <span className="rounded-full border border-line px-2 text-xs text-muted">{t('side.offline')}</span>
        )}
      </div>
      <NeedsSection rows={needs([project]).map(session => ({ session }))} />
      <section className="flex flex-col gap-3">
        <h2 className="m-0 flex items-baseline gap-2 text-base font-semibold">
          {t('project.live')}{' '}
          <span className="text-sm font-normal text-faint">{project.sessions.length}</span>
        </h2>
        {project.sessions.length ? (
          <>
            <div className="flex flex-wrap gap-1.5">
              <button type="button" className={chip(filter === null)} onClick={() => setFilter(null)}>
                {t('project.all')} <span className="text-xs text-faint">{project.sessions.length}</span>
              </button>
              {counts
                .filter(([, n]) => n)
                .map(([status, n]) => (
                  <button
                    key={status}
                    type="button"
                    className={chip(filter === status)}
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
