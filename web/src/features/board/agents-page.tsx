// The board on a computer: every agent, or one project's, on the four lanes, and for a project its
// plain shells below them. `/` shows all of them; `/p/:key` the project's. A session opened from a
// card (`…/s/:mid/:pane`) shows beside the board, which folds into one column meanwhile.

import { Group, Panel, useDefaultLayout } from 'react-resizable-panels'
import { Link, useParams } from 'react-router'
import { ResizeHandle } from '../../components/resize-handle'
import { useI18n } from '../../core/i18n'
import { useProjects, useSpaceView } from '../../core/space'
import { lanes, type Project } from '../../model/projects'
import { projectsSettled } from '../../model/space'
import { boardHref } from '../../utils/hrefs'
import { useKeptScroll } from '../../utils/kept-scroll'
import { useNow } from '../../utils/time'
import { PeekPane } from '../pane/peek-pane'
import { SessionPage } from '../pane/session-page'
import { NoMachines } from './all-page'
import { Lanes } from './lanes'
import { ShellStrip } from './shell-strip'

const NOTE = 'm-6 flex flex-col items-start gap-3 text-muted'

export function AgentsPage() {
  const t = useI18n()
  const view = useSpaceView()
  const projects = useProjects()
  const { key } = useParams()
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
  // Keyed so the lanes start over for each project.
  return <Board key={project?.key ?? ''} project={project} all={projects} />
}

function Board({ project, all }: { project: Project | undefined; all: Project[] }) {
  const t = useI18n()
  const now = useNow()
  const { mid, pane } = useParams()
  const peek = !!(mid && pane)
  const scroll = useKeptScroll<HTMLElement>()
  // The column's width beside a session, the same on every board.
  const split = useDefaultLayout({
    id: 'isbell.peek-split',
    panelIds: peek ? PANELS : ['lanes'],
    storage: localStorage,
  })
  const shown = project ? [project] : all
  const empty = !project ? t('all.empty') : project.online ? t('project.none') : t('project.offline')
  return (
    <div className="flex h-full flex-col">
      {/* Always the same panels first, so the lanes keep what is being written on them as a session
          opens and closes beside them. */}
      <Group
        orientation="horizontal"
        className="min-h-0 flex-1"
        defaultLayout={split.defaultLayout}
        onLayoutChanged={split.onLayoutChanged}
      >
        <Panel
          id="lanes"
          className="flex"
          defaultSize={peek ? '360px' : '100%'}
          minSize="280px"
          groupResizeBehavior="preserve-pixel-size"
        >
          <main
            {...scroll}
            className={`paper flex min-h-0 flex-1 flex-col gap-5 overflow-auto py-5 ${peek ? 'px-4' : 'px-7'}`}
          >
            {shown.some(p => p.sessions.length) ? (
              <Lanes lanes={lanes(shown)} now={now} stacked={peek} scoped={!!project} />
            ) : (
              <p className="m-0 text-muted">{empty}</p>
            )}
            {project ? <ShellStrip project={project} /> : null}
          </main>
        </Panel>
        {peek ? (
          <>
            <ResizeHandle label={t('peek.resize')} />
            <Panel id="peek" className="flex" minSize="480px">
              <SessionPage layout={PeekPane} after={boardHref(project?.key)} />
            </Panel>
          </>
        ) : null}
      </Group>
    </div>
  )
}

const PANELS = ['lanes', 'peek']
