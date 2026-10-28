// The board on a computer: every agent, or one project's, on the four lanes, with the task box
// above them and, for a project, its plain shells below. `/` shows all of them; `/p/:key` the project's.

import { Link, useOutletContext, useParams } from 'react-router'
import { useI18n } from '../../core/i18n'
import { useProjects, useSpaceView } from '../../core/space'
import { lanes, type Project } from '../../model/projects'
import { projectsSettled } from '../../model/space'
import { useNow } from '../../utils/time'
import { Dispatch } from '../new-session/dispatch'
import { NoMachines } from './all-page'
import { Lanes } from './lanes'
import { AllHeader, ProjectHeader } from './project-header'
import { ShellStrip } from './shell-strip'

/** What the frame around the board lets it open. */
export type BoardActions = { openNew: () => void }

const NOTE = 'm-6 flex flex-col items-start gap-3 text-muted'

export function AgentsPage() {
  const t = useI18n()
  const view = useSpaceView()
  const projects = useProjects()
  const { key } = useParams()
  const { openNew } = useOutletContext<BoardActions>()
  const project = key ? projects.find(p => p.key === key) : undefined

  if (!view.loaded) return <p className={NOTE}>{t('board.loading')}</p>
  if (!key && !view.machines.length) return <NoMachines />
  // Until the projects settle, one not found may yet appear.
  if (key && !project)
    return projectsSettled(view) ? (
      <div className={NOTE}>
        <p className="m-0">{t('project.gone')}</p>
        <Link to="/">{t('project.back')}</Link>
      </div>
    ) : (
      <p className={NOTE}>{t('board.loading')}</p>
    )
  // Keyed so the lanes and the task box start over for each project.
  return <Board key={project?.key ?? ''} project={project} all={projects} onMore={openNew} />
}

function Board({
  project,
  all,
  onMore,
}: {
  project: Project | undefined
  all: Project[]
  onMore: () => void
}) {
  const t = useI18n()
  const now = useNow()
  const shown = project ? [project] : all
  const empty = !project ? t('all.empty') : project.online ? t('project.none') : t('project.offline')
  return (
    <div className="flex h-full flex-col">
      {project ? <ProjectHeader project={project} current="agents" /> : <AllHeader />}
      <main className="paper flex min-h-0 flex-1 flex-col gap-5 overflow-auto px-7 py-5">
        <Dispatch project={project} onMore={onMore} />
        {shown.some(p => p.sessions.length) ? (
          <Lanes lanes={lanes(shown)} now={now} scoped={!!project} />
        ) : (
          <p className="m-0 text-muted">{empty}</p>
        )}
        {project ? <ShellStrip project={project} /> : null}
      </main>
    </div>
  )
}
