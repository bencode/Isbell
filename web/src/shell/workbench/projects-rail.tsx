// The projects by the machine they are on, at either width of the column: the same rows, cut to their
// marks when thin. Pointing at a machine offers its facts and a new project; at a project, removing it.

import { Popover } from '@base-ui/react/popover'
import { Info, MoreHorizontal, Plus } from 'lucide-react'
import { useState } from 'react'
import { Link, matchPath, useLocation } from 'react-router'
import { ICON, IconButton } from '../../components/icon-button'
import { DropdownMenu } from '../../components/menu'
import { Tip } from '../../components/tip'
import { errorText, type Key, useI18n } from '../../core/i18n'
import { useKeepProjectLists, useProjects, useSpace, useSpaceView } from '../../core/space'
import { MachineFacts } from '../../features/machine/machine-facts'
import { AddProjectDialog } from '../../features/new-session/add-project-dialog'
import { parseRootKey } from '../../model/files/worktrees'
import { type ProjectConfig, projectActions } from '../../model/project-config'
import type { Project } from '../../model/projects'
import type { MachineEntry } from '../../model/space'
import { projectHref } from '../../utils/hrefs'
import { asking } from '../marks'
import { ProjectTile, shortName } from './tile'

const SMALL = { ...ICON, size: 14 }
const ALERT = 'm-0 mx-2 px-1.5 text-xs text-danger'
const TROUBLE: Partial<Record<ProjectConfig['state'], Key>> = {
  broken: 'workbench.brokenProjects',
  unwritable: 'workbench.unwritableProjects',
}
// A mark on the corner of a project's tile, when the row is cut to the tile.
const CORNER = 'absolute shadow-[0_0_0_1.5px_var(--side)]'

function ProjectRow({
  project,
  here,
  thin,
  onRemove,
}: {
  project: Project
  here: boolean
  thin: boolean
  onRemove: (() => void) | undefined
}) {
  const t = useI18n()
  // What an offline machine last reported cannot be answered.
  const need = project.online ? asking(project) : 0
  const live = project.online && project.sessions.some(s => s.status === 'working')
  const place = `${project.name} · ${project.machine}${project.online ? '' : ` · ${t('side.offline')}`}`
  const actions = onRemove && !thin
  // Where the actions come up, they take the place of what is at the end of the row.
  const yields = actions ? 'group-hover:opacity-0' : ''
  return (
    <div className="group relative mx-2 mb-px">
      <Tip label={place} side="right" disabled={!thin}>
        <Link
          to={projectHref(project.key)}
          aria-label={place}
          aria-current={here ? 'page' : undefined}
          className={`flex h-8 items-center gap-2 rounded-[7px] px-1.5 no-underline transition-colors duration-75 hover:bg-hover hover:text-text focus-visible:outline-2 focus-visible:outline-accent active:bg-press ${
            here ? 'bg-selected font-medium text-text' : project.online ? 'text-muted' : 'text-faint'
          }`}
        >
          <ProjectTile name={project.name} dim={!project.online} />
          <span className={`min-w-0 flex-1 truncate ${thin ? 'opacity-0' : ''}`}>{project.name}</span>
          {need ? (
            <span
              className={`flex-none bg-warn text-center font-mono font-semibold text-accent-ink ${
                thin
                  ? `${CORNER} top-0 right-0 min-w-3.5 rounded-[7px] px-[3px] text-[9.5px] leading-[14px]`
                  : `min-w-4 rounded-lg px-1 text-[10.5px] leading-4 ${yields}`
              }`}
            >
              {need}
            </span>
          ) : live ? (
            <span
              className={`size-1.5 flex-none rounded-full bg-accent ${
                thin ? `${CORNER} top-0.5 right-0.5` : `mr-[5px] ${yields}`
              }`}
            />
          ) : null}
        </Link>
      </Tip>
      {actions ? (
        <DropdownMenu
          trigger={
            <IconButton
              label={t('workbench.projectActions')}
              side="right"
              small
              className="absolute top-1 right-1 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 data-popup-open:opacity-100"
            >
              <MoreHorizontal {...SMALL} />
            </IconButton>
          }
          items={[{ label: t('workbench.removeProject'), onClick: onRemove }]}
        />
      ) : null}
    </div>
  )
}

function MachineDetails({ entry }: { entry: MachineEntry }) {
  const t = useI18n()
  return (
    <Popover.Root>
      <Popover.Trigger
        render={
          <IconButton label={t('machine.info')} side="right" small>
            <Info {...SMALL} />
          </IconButton>
        }
      />
      <Popover.Portal>
        <Popover.Positioner side="right" align="start" sideOffset={8} className="z-50 outline-none">
          <Popover.Popup className="flex max-h-[70vh] w-[340px] flex-col gap-5 overflow-auto rounded-[10px] border border-line-strong bg-raised p-4 text-[13px] shadow-[0_8px_28px_rgb(0_0_0/0.2)] outline-none">
            <MachineFacts entry={entry} />
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  )
}

function MachineGroup({
  entry,
  config,
  shellsKnown,
  projects,
  hereKey,
  thin,
}: {
  entry: MachineEntry
  config: ProjectConfig | undefined
  shellsKnown: ReadonlySet<string>
  projects: Project[]
  hereKey: string | undefined
  thin: boolean
}) {
  const t = useI18n()
  const space = useSpace()
  const [adding, setAdding] = useState(false)
  const [problem, setProblem] = useState<string>()
  const { machine } = entry.state
  const { adds, removes } = projectActions(entry, config, shellsKnown, projects)
  const remove = (path: string) => {
    setProblem(undefined)
    space
      .changeProjects(machine.id, paths => paths?.filter(p => p !== path))
      .catch((err: unknown) => {
        console.error('could not remove a project', err)
        setProblem(errorText(t, err))
      })
  }
  const offline = entry.online ? '' : t('side.offline')
  const troubleKey = config && TROUBLE[config.state]
  const trouble = troubleKey ? t(troubleKey) : ''
  return (
    <section>
      <Tip label={[machine.name, offline, trouble].filter(Boolean).join(' · ')} side="right" disabled={!thin}>
        <h2
          className={`group relative m-0 mt-3 mb-0.5 ml-2 flex h-[22px] items-center overflow-hidden pl-1.5 text-[11px] font-semibold whitespace-nowrap text-faint ${thin ? 'gap-[3px]' : 'mr-2 gap-1.5'}`}
        >
          <span
            className={`size-1.5 flex-none rounded-full ${
              trouble ? 'bg-danger' : entry.online ? 'bg-ok' : 'shadow-[inset_0_0_0_1.5px_var(--faint)]'
            }`}
          />
          {thin ? (
            shortName(machine.name)
          ) : (
            <>
              <span className="min-w-0 flex-1 truncate">{machine.name}</span>
              {offline ? <span className="pr-1.5 font-normal">{offline}</span> : null}
              {/* Over the heading, so that it takes no room from the name at rest. */}
              <span className="absolute right-0 flex bg-side opacity-0 group-hover:opacity-100 focus-within:opacity-100 has-data-popup-open:opacity-100">
                <MachineDetails entry={entry} />
                {adds ? (
                  <IconButton
                    label={t('workbench.addProject')}
                    side="right"
                    small
                    onClick={() => setAdding(true)}
                  >
                    <Plus {...SMALL} />
                  </IconButton>
                ) : null}
              </span>
            </>
          )}
        </h2>
      </Tip>
      {trouble && !thin ? <p className={ALERT}>{trouble}</p> : null}
      {problem ? <p className={ALERT}>{problem}</p> : null}
      {projects.map(p => (
        <ProjectRow
          key={p.key}
          project={p}
          here={p.key === hereKey}
          thin={thin}
          onRemove={removes ? () => remove(p.path) : undefined}
        />
      ))}
      {!projects.length && !thin ? (
        <p className="m-0 mx-2 px-1.5 text-xs leading-8 text-faint">{t('workbench.noProjects')}</p>
      ) : null}
      {adding ? <AddProjectDialog machine={entry.state} onClose={() => setAdding(false)} /> : null}
    </section>
  )
}

export function ProjectsRail({ thin }: { thin: boolean }) {
  useKeepProjectLists()
  const { machines, configs, shellsKnown } = useSpaceView()
  const projects = useProjects()
  const { pathname } = useLocation()
  const key = matchPath('/p/:key/*', pathname)?.params.key
  const hereKey = key ? parseRootKey(key).project : undefined
  return (
    <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto pt-1 pb-2 [scrollbar-width:none]">
      {machines.map(entry => (
        <MachineGroup
          key={entry.state.machine.id}
          entry={entry}
          config={configs[entry.state.machine.id]}
          shellsKnown={shellsKnown}
          projects={projects.filter(p => p.mid === entry.state.machine.id && p.configured && p.path)}
          hereKey={hereKey}
          thin={thin}
        />
      ))}
    </div>
  )
}
