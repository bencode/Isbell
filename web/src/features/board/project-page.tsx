import { SquareTerminal } from 'lucide-react'
import { Link, useParams } from 'react-router'
import { useI18n } from '../../core/i18n'
import { useProjects, useSpaceView } from '../../core/space'
import { lanes, type Project } from '../../model/projects'
import { projectsSettled } from '../../model/space'
import { terminalHref } from '../../utils/hrefs'
import { useNow } from '../../utils/time'
import { Lanes } from './lanes'
import { ProjectTabs } from './project-tabs'

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

/** One project's agents on the home's lanes; `stacked` lays the lanes one under another. */
export function ProjectView({ stacked = false }: { stacked?: boolean }) {
  const t = useI18n()
  const view = useSpaceView()
  const projects = useProjects()
  const project = useFocused(projects)

  // Until the projects settle, one not found may yet appear.
  if (!project && !projectsSettled(view)) return <p className="m-0 text-muted">{t('board.loading')}</p>
  if (!project)
    return (
      <div className="flex flex-col items-start gap-3">
        <p className="m-0 text-muted">{t('project.gone')}</p>
        <Link to="/">{t('project.back')}</Link>
      </div>
    )
  // Keyed so the lanes start over for each project.
  return <Focused key={project.key} project={project} stacked={stacked} />
}

function Focused({ project, stacked }: { project: Project; stacked: boolean }) {
  const t = useI18n()
  const now = useNow()
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
        {/* Phones have no files view. */}
        {stacked ? null : (
          <span className="ml-auto self-center">
            <ProjectTabs projectKey={project.key} current="overview" />
          </span>
        )}
      </div>
      <Shells project={project} />
      {project.sessions.length ? (
        <Lanes lanes={lanes([project])} now={now} stacked={stacked} />
      ) : (
        <p className="m-0 text-muted">{project.online ? t('project.none') : t('project.offline')}</p>
      )}
    </>
  )
}
