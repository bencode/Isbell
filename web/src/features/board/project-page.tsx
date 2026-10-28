import { Link, useParams } from 'react-router'
import { useI18n } from '../../core/i18n'
import { useProjects, useSpaceView } from '../../core/space'
import { lanes, type Project } from '../../model/projects'
import { projectsSettled } from '../../model/space'
import { useNow } from '../../utils/time'
import { Lanes } from './lanes'
import { ShellStrip } from './shell-strip'

/** The project the board is focused on, from the route. */
function useFocused(projects: Project[]): Project | undefined {
  const { key } = useParams()
  return key ? projects.find(p => p.key === key) : undefined
}

/** One project's agents on the home's lanes, on a phone; `stacked` lays the lanes one under another. */
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
      </div>
      {project.sessions.length ? (
        <Lanes lanes={lanes([project])} now={now} stacked={stacked} scoped />
      ) : (
        <p className="m-0 text-muted">{project.online ? t('project.none') : t('project.offline')}</p>
      )}
      <ShellStrip project={project} />
    </>
  )
}
