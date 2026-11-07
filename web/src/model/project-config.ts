// The directories a machine lists as its projects, in order, in a file of its own: what every browser
// reaches it from shows the same projects, and only adding or removing one changes them.

import { read } from './files/remote'
import { isBroad } from './files/repo'
import { hasPanes, type Project, trimSlash } from './projects'
import type { MachineEntry, Space } from './space'
import { CallError } from './streams'

export const projectsPath = '~/.isbell/projects.json'

const VERSION = 1
const FILE_MAX = 1 << 20

/** A file that cannot be read is never written over: someone may have meant what is in it. One that
 * could not be started is left to the machine's next time online. */
export type ProjectConfig =
  | { state: 'listed'; paths: string[] }
  | { state: 'missing' }
  | { state: 'broken' }
  | { state: 'unwritable' }

const isEntry = (entry: unknown): entry is { path: string } => {
  const path = (entry as { path?: unknown } | null)?.path
  return typeof path === 'string' && path.startsWith('/')
}

/** The directories `text` lists; undefined when it is no such file, or lists anything but absolute
 * paths, which no pane's directory would ever match. */
export function parseProjects(text: string): string[] | undefined {
  try {
    const file = JSON.parse(text) as { version?: unknown; projects?: unknown } | null
    if (file?.version !== VERSION || !Array.isArray(file.projects) || !file.projects.every(isEntry))
      return undefined
    return file.projects.map(entry => trimSlash(entry.path))
  } catch (err) {
    if (err instanceof SyntaxError) return undefined
    throw err
  }
}

export const serializeProjects = (paths: string[]) =>
  `${JSON.stringify({ version: VERSION, projects: paths.map(path => ({ path })) }, null, 2)}\n`

/** What machine `mid` lists as its projects, read from its file now. A gateway that takes no path
 * under `~` has no file as far as anyone can tell. */
export async function readProjects(open: Space['openStream'], mid: string): Promise<ProjectConfig> {
  try {
    const found = await read(open, mid, projectsPath, FILE_MAX)
    const paths = found.bytes && parseProjects(new TextDecoder().decode(found.bytes))
    if (paths) return { state: 'listed', paths }
    console.warn('the projects listed cannot be read', mid)
    return { state: 'broken' }
  } catch (err) {
    if (!(err instanceof CallError)) throw err
    if (err.code === 'not_found' || err.code === 'bad_request') return { state: 'missing' }
    if (err.code !== 'not_a_file' && err.code !== 'permission_denied') throw err
    console.warn('the projects listed cannot be read', mid, err)
    return { state: 'broken' }
  }
}

/** What a machine starts by listing: where it has something running. */
const initialPaths = (projects: Project[]) =>
  projects.filter(p => hasPanes(p) && p.path && !isBroad(p.path)).map(p => p.path)

export type ProjectActions = {
  /** What to write as the machine's first list, when that is due. */
  start?: string[]
  adds: boolean
  removes: boolean
}

const NONE: ProjectActions = { adds: false, removes: false }

/** What can be done to a machine's list: never to what is kept from before, or a file not read. With
 * no file yet, a machine waits to say where its panes run, since it would start from too little and
 * stay there; then it starts from them, or takes a project by hand where there is nothing to start
 * from. `projects` are those it shows. */
export function projectActions(
  { state, online }: MachineEntry,
  config: ProjectConfig | undefined,
  shellsKnown: boolean,
  projects: Project[],
): ProjectActions {
  if (!online || !state.caps.methods.includes('isbell.file.write')) return NONE
  if (config?.state === 'listed') return { adds: true, removes: true }
  if (config?.state !== 'missing' || !shellsKnown) return NONE
  const start = initialPaths(projects)
  if (!start.length) return { adds: true, removes: false }
  return state.herdr.status === 'ready' ? { ...NONE, start } : NONE
}

/** The directories each machine lists, by machine id, as read or else as last kept. A machine read to
 * list nothing, or nothing readable, has none. */
export function listedPaths(
  configs: Readonly<Record<string, ProjectConfig>>,
  kept: Readonly<Record<string, string[]>>,
): Record<string, string[]> {
  const said = Object.entries(configs).flatMap(([mid, config]) =>
    config.state === 'listed' ? [[mid, config.paths] as const] : [],
  )
  return Object.fromEntries([...Object.entries(kept).filter(([mid]) => !configs[mid]), ...said])
}
