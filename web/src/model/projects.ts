// Projects are derived, never stored: a project is a directory on a machine where an agent or a
// shell is running. Agents nested in another agent's directory belong to that outer project;
// shells join the project they sit in, or stand as their own when they sit in none.

import type { Shell } from './herdr'
import type { MachineEntry } from './space'
import type { AgentStatus } from './state'

export type Session = {
  mid: string
  paneId: string
  name: string
  kind?: string
  status: AgentStatus
  /** Milliseconds on the gateway's clock. */
  statusSince: number
  title?: string
  unread: boolean
}

export type Project = {
  key: string
  mid: string
  machine: string
  online: boolean
  path: string
  /** `path` with the machine's home shown as `~`. */
  display: string
  name: string
  sessions: Session[]
  shells: Shell[]
}

/** When each session was last looked at: its statusSince at the time, by `paneKey`. */
export type Seen = Record<string, number>

export const paneKey = (mid: string, paneId: string) => `${mid}/${paneId}`
export const projectKey = (mid: string, path: string) => `${mid}:${path}`

const HOME = /^\/(?:Users|home)\/[^/]+/

/** The home directory as it shows in a machine's paths, if any does. */
export const homeOf = (paths: string[]): string | undefined => paths.map(p => HOME.exec(p)?.[0]).find(Boolean)

/** A home directory or above never groups the directories below it. */
const isBroad = (path: string) =>
  path === '/' || path === '/root' || /^\/(?:Users|home)(?:\/[^/]+)?$/.test(path)

const contains = (root: string, path: string) =>
  path === root || (!isBroad(root) && path.startsWith(`${root}/`))

/** The directories none of the others contain. */
const outermost = (paths: string[]) => {
  const unique = [...new Set(paths)]
  return unique.filter(p => !unique.some(q => q !== p && contains(q, p)))
}

const trimSlash = (path: string) => (path.length > 1 ? path.replace(/\/+$/, '') : path)

const tildify = (path: string, home: string | undefined) =>
  home && (path === home || path.startsWith(`${home}/`)) ? `~${path.slice(home.length)}` : path

/** Ordered by name, so a project keeps its place (and its number key) as its sessions change. */
export function deriveProjects(machines: MachineEntry[], shells: Shell[], seen: Seen): Project[] {
  return machines
    .flatMap(({ state, online }) => {
      const mid = state.machine.id
      const agents = state.agents.map(a => ({ ...a, cwd: trimSlash(a.cwd ?? '') }))
      const mine = shells.filter(s => s.mid === mid).map(s => ({ ...s, cwd: trimSlash(s.cwd) }))
      const agentRoots = outermost(agents.map(a => a.cwd).filter(Boolean))
      const shellRoots = outermost(
        mine.map(s => s.cwd).filter(cwd => !agentRoots.some(root => contains(root, cwd))),
      )
      const roots = [...agentRoots, ...shellRoots, ...(agents.some(a => !a.cwd) ? [''] : [])]
      const home = homeOf(roots)
      const rootOf = (cwd: string) => (cwd ? roots.find(root => root && contains(root, cwd)) : '')
      return roots.map(path => ({
        key: projectKey(mid, path),
        mid,
        machine: state.machine.name,
        online,
        path,
        display: path ? tildify(path, home) : '?',
        name: path.split('/').pop() || (path ? '/' : state.machine.name),
        sessions: agents
          .filter(a => rootOf(a.cwd) === path)
          .map(a => ({
            mid,
            paneId: a.paneId,
            name: a.name ?? a.paneId,
            ...(a.kind ? { kind: a.kind } : {}),
            status: a.status,
            statusSince: a.statusSince,
            ...(a.title ? { title: a.title } : {}),
            unread: a.status === 'done' && a.statusSince > (seen[paneKey(mid, a.paneId)] ?? 0),
          })),
        shells: mine.filter(s => rootOf(s.cwd) === path),
      }))
    })
    .sort(
      (a, b) =>
        a.name.localeCompare(b.name) || a.machine.localeCompare(b.machine) || a.path.localeCompare(b.path),
    )
}

/** Blocked sessions first, then finished ones not yet looked at; newest first within each. */
export const needs = (projects: Project[]): Session[] =>
  projects
    .flatMap(p => p.sessions)
    .filter(s => s.status === 'blocked' || s.unread)
    .sort(
      (a, b) =>
        Number(b.status === 'blocked') - Number(a.status === 'blocked') || b.statusSince - a.statusSince,
    )

export type Pane = { session: Session } | { shell: Shell }

export type Found = { project: Project; name: string; pane: Pane }

/** The project a pane belongs to, and what to call it: the agent's name, or the shell's title. */
export const locate = (projects: Project[], mid: string, paneId: string): Found | undefined =>
  projects
    .filter(p => p.mid === mid)
    .flatMap((project): Found[] => {
      const session = project.sessions.find(s => s.paneId === paneId)
      const shell = project.shells.find(s => s.paneId === paneId)
      if (session) return [{ project, name: session.name, pane: { session } }]
      return shell ? [{ project, name: shell.title ?? paneId, pane: { shell } }] : []
    })[0]

export type AddJudgement =
  | { kind: 'none' }
  | { kind: 'bad' }
  /** `inside` when the directory is below the project's own. */
  | { kind: 'open'; project: Project; inside: boolean }
  | { kind: 'add'; dir: string }

/** What adding `input` on machine `mid` would do. Whether the directory exists is the machine's call. */
export function judgeAdd(projects: Project[], mid: string, input: string): AddJudgement {
  const typed = trimSlash(input.trim())
  if (!typed) return { kind: 'none' }
  if (!typed.startsWith('/') && !typed.startsWith('~')) return { kind: 'bad' }
  const mine = projects.filter(p => p.mid === mid && p.path)
  const home = homeOf(mine.map(p => p.path))
  const dir = typed.startsWith('~') && home ? home + typed.slice(1) : typed
  const project = mine.find(p => contains(p.path, dir))
  return project ? { kind: 'open', project, inside: dir !== project.path } : { kind: 'add', dir }
}
