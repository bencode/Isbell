// The directories a machine lists as its projects, in order, in a file of its own: what every browser
// reaches it from shows the same projects, and only adding or removing one changes them.

import { isBroad } from './files/repo'
import { hasPanes, type Project } from './projects'

export const projectsPath = '~/.isbell/projects.json'

const VERSION = 1

/** A file that cannot be read is never written over: someone may have meant what is in it. */
export type ProjectConfig = { state: 'listed'; paths: string[] } | { state: 'missing' } | { state: 'broken' }

const isEntry = (entry: unknown): entry is { path: string } =>
  typeof (entry as { path?: unknown } | null)?.path === 'string'

/** The directories `text` lists; undefined when it is no such file. */
export function parseProjects(text: string): string[] | undefined {
  try {
    const { version, projects } = JSON.parse(text) as { version?: unknown; projects?: unknown }
    if (version !== VERSION || !Array.isArray(projects) || !projects.every(isEntry)) return undefined
    return projects.map(entry => entry.path)
  } catch (err) {
    if (err instanceof SyntaxError || err instanceof TypeError) return undefined
    throw err
  }
}

export const serializeProjects = (paths: string[]) =>
  `${JSON.stringify({ version: VERSION, projects: paths.map(path => ({ path })) }, null, 2)}\n`

/** What a machine starts by listing: where it has something running. */
export const initialPaths = (projects: Project[]) =>
  projects.filter(p => hasPanes(p) && p.path && !isBroad(p.path)).map(p => p.path)

/** The directories each machine lists, by machine id, as read or else as last kept. A machine read to
 * list nothing, or nothing readable, has none. */
export function listedPaths(
  configs: Readonly<Record<string, ProjectConfig>>,
  kept: Readonly<Record<string, string[]>>,
): Record<string, string[]> {
  const read = Object.entries(configs).flatMap(([mid, config]) =>
    config.state === 'listed' ? [[mid, config.paths] as const] : [],
  )
  return Object.fromEntries([...Object.entries(kept).filter(([mid]) => !configs[mid]), ...read])
}
