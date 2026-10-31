// Projects are derived, never stored: a project is the root of a directory on a machine where an
// agent or a shell is running, or where Isbell's hook recorded a session. A directory's root is the
// git repository it is in, or the directory itself when it is in none; only the pane's own directory
// decides, never the panes around it.

import { shownName } from './agent-name'
import type { Shell } from './herdr'
import type { Roots } from './sessions'
import type { MachineEntry } from './space'
import type { AgentStatus } from './state'

export type Session = {
  mid: string
  paneId: string
  /** What it is called on the page; see `shownName`. */
  name: string
  /** Its name in herdr, when it has one: what the CLI and renaming go by. */
  herdrName?: string
  kind?: string
  status: AgentStatus
  /** Milliseconds on the gateway's clock. */
  statusSince: number
  title?: string
  unread: boolean
  /** Where the agent works, when it said. */
  cwd?: string
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
  /** When a session recorded in it was last active, if any was. */
  updated?: number
}

/** Whether anything runs in the project; one without is there for the sessions recorded in it. */
export const hasPanes = (p: Project) => p.sessions.length > 0 || p.shells.length > 0

/** When each session was last looked at: its statusSince at the time, by `paneKey`. */
export type Seen = Record<string, number>

export const paneKey = (mid: string, paneId: string) => `${mid}/${paneId}`
/** A directory on a machine, as the repositories found for directories are kept. */
export const dirKey = (mid: string, dir: string) => `${mid}:${dir}`

/** FNV-1a, 32 bits, in base 36. */
const hash = (text: string) =>
  [...text]
    .reduce((h, c) => Math.imul(h ^ (c.codePointAt(0) ?? 0), 0x01000193) >>> 0, 0x811c9dc5)
    .toString(36)

/** A project's key, plain enough to stand in an address as it is: its directory's name, in letters,
 * digits and '-', and a hash of the machine and the path, which tells apart projects of one name. */
export function projectKey(mid: string, path: string) {
  const slug = (path.split('/').pop() ?? '')
    .replace(/[^A-Za-z\d]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 32)
  const tail = hash(dirKey(mid, path))
  return slug ? `${slug}-${tail}` : tail
}

const HOME = /^\/(?:Users|home)\/[^/]+/

/** The home directory as it shows in a machine's paths, if any does. */
export const homeOf = (paths: string[]): string | undefined => paths.map(p => HOME.exec(p)?.[0]).find(Boolean)

/** The repository roots found for the directories machines report, by `dirKey(mid, cwd)`. */
export type Repos = Readonly<Record<string, string>>

const trimSlash = (path: string) => (path.length > 1 ? path.replace(/\/+$/, '') : path)

/** `path` with the home directory written `~`. */
export const tildify = (path: string, home: string | undefined) =>
  home && (path === home || path.startsWith(`${home}/`)) ? `~${path.slice(home.length)}` : path

/** Ordered by machine, so the projects of a machine stand together; then those with panes by name,
 * so each keeps its place as its sessions change; then the rest, the last active first.
 * `recorded`: the roots of each machine's recorded sessions, by machine id. */
export function deriveProjects(
  machines: MachineEntry[],
  shells: Shell[],
  seen: Seen,
  repos: Repos,
  recorded: Readonly<Record<string, Roots>> = {},
): Project[] {
  return machines
    .flatMap(({ state, online }) => {
      const mid = state.machine.id
      const rootOf = (cwd: string | undefined) => (cwd ? (repos[dirKey(mid, cwd)] ?? trimSlash(cwd)) : '')
      const agents = state.agents.map(a => ({ ...a, cwd: trimSlash(a.cwd ?? ''), root: rootOf(a.cwd) }))
      const mine = shells
        .filter(s => s.mid === mid)
        .map(s => ({ shell: { ...s, cwd: trimSlash(s.cwd) }, root: rootOf(s.cwd) }))
      const kept = recorded[mid] ?? {}
      const roots = [...new Set([...agents.map(a => a.root), ...mine.map(s => s.root), ...Object.keys(kept)])]
      const home = homeOf(roots)
      return roots.map(path => ({
        key: projectKey(mid, path),
        ...(kept[path] ? { updated: kept[path].updated } : {}),
        mid,
        machine: state.machine.name,
        online,
        path,
        display: path ? tildify(path, home) : '?',
        name: path.split('/').pop() || (path ? '/' : state.machine.name),
        sessions: agents
          .filter(a => a.root === path)
          .map(a => ({
            mid,
            paneId: a.paneId,
            name: shownName(a.name, a.kind, a.paneId),
            ...(a.name ? { herdrName: a.name } : {}),
            ...(a.cwd ? { cwd: a.cwd } : {}),
            ...(a.kind ? { kind: a.kind } : {}),
            status: a.status,
            statusSince: a.statusSince,
            ...(a.title ? { title: a.title } : {}),
            unread: a.status === 'done' && a.statusSince > (seen[paneKey(mid, a.paneId)] ?? 0),
          })),
        shells: mine.filter(s => s.root === path).map(s => s.shell),
      }))
    })
    .sort(
      (a, b) =>
        a.machine.localeCompare(b.machine) ||
        a.mid.localeCompare(b.mid) ||
        Number(hasPanes(b)) - Number(hasPanes(a)) ||
        (hasPanes(a) ? 0 : (b.updated ?? 0) - (a.updated ?? 0)) ||
        a.name.localeCompare(b.name) ||
        a.path.localeCompare(b.path),
    )
}

/** Blocked sessions first, then finished ones not yet looked at; newest first within each. Only on
 * machines that are online: what an offline one last reported cannot be answered. */
export const needs = (projects: Project[]): Session[] =>
  projects
    .filter(p => p.online)
    .flatMap(p => p.sessions)
    .filter(s => s.status === 'blocked' || s.unread)
    .sort(
      (a, b) =>
        Number(b.status === 'blocked') - Number(a.status === 'blocked') || b.statusSince - a.statusSince,
    )

/** A session with the project it runs in. */
export type Placed = { session: Session; project: Project }

/** Every agent, by what it is doing; each is in exactly one lane. */
/** A plain shell in a project. */
export type PlacedShell = { shell: Shell; project: Project }

export type Lanes = {
  asking: Placed[]
  finished: Placed[]
  running: Placed[]
  /** The rest on machines that are online: read, idle, or of unknown status. */
  standing: Placed[]
  /** Everything on machines that are offline, whatever they last reported. */
  offline: Placed[]
  /** The plain shells on machines that are online, by project. */
  shells: PlacedShell[]
}

/** The lanes that wait on you list the longest waiting first; the ones standing, the latest. */
export function lanes(projects: Project[]): Lanes {
  const placed = projects
    .flatMap(project => project.sessions.map(session => ({ session, project })))
    .sort((a, b) => a.session.statusSince - b.session.statusSince)
  const live = placed.filter(p => p.project.online)
  const has = (p: Placed, status: AgentStatus) => p.session.status === status
  return {
    asking: live.filter(p => has(p, 'blocked')),
    finished: live.filter(p => has(p, 'done') && p.session.unread),
    running: live.filter(p => has(p, 'working')),
    standing: live
      .filter(p => (has(p, 'done') && !p.session.unread) || has(p, 'idle') || has(p, 'unknown'))
      .reverse(),
    offline: placed.filter(p => !p.project.online).reverse(),
    shells: projects
      .filter(p => p.online)
      .flatMap(project => project.shells.map(shell => ({ shell, project }))),
  }
}

/** How long an agent standing by stays still before it is put aside. */
export const STALE_MS = 24 * 60 * 60 * 1000

/** Agents standing by, split by whether they have been still for STALE_MS. */
export const splitStale = (standing: Placed[], now: number) => ({
  recent: standing.filter(p => now - p.session.statusSince < STALE_MS),
  stale: standing.filter(p => now - p.session.statusSince >= STALE_MS),
})

/** The agent to see to after `at`: down the asking lane, then the finished one, in the board's order
 * (the longest waiting first), around to the top; the first when `at` is not among them. */
export function nextNeeding(l: Lanes, at: { mid: string; paneId: string } | undefined): Placed | undefined {
  const list = [...l.asking, ...l.finished]
  const i = list.findIndex(p => p.session.mid === at?.mid && p.session.paneId === at.paneId)
  return list[i < 0 ? 0 : (i + 1) % list.length]
}

export type Pane = { session: Session } | { shell: Shell }

export type Found = { project: Project; name: string; pane: Pane }

/** The project a pane belongs to, and what to call it: the agent's name, or the shell's pane, as a
 * shell's title may read like another's. */
export const locate = (projects: Project[], mid: string, paneId: string): Found | undefined =>
  projects
    .filter(p => p.mid === mid)
    .flatMap((project): Found[] => {
      const session = project.sessions.find(s => s.paneId === paneId)
      const shell = project.shells.find(s => s.paneId === paneId)
      if (session) return [{ project, name: session.name, pane: { session } }]
      return shell ? [{ project, name: paneId, pane: { shell } }] : []
    })[0]

export type DirJudgement = { kind: 'none' } | { kind: 'bad' } | { kind: 'dir'; dir: string }

/** What a directory typed for machine `mid` is: nothing yet, not a full path, or the directory.
 * Whether it is there is the machine's call. */
export function judgeDir(projects: Project[], mid: string, input: string): DirJudgement {
  const typed = trimSlash(input.trim())
  if (!typed) return { kind: 'none' }
  if (!typed.startsWith('/') && !typed.startsWith('~')) return { kind: 'bad' }
  return { kind: 'dir', dir: expandHome(projects, mid, typed) }
}

const projectsOf = (projects: Project[], mid: string) => projects.filter(p => p.mid === mid && p.path)

/** `typed` with a leading ~ as machine `mid`'s home, as its projects show it; unchanged when no
 * home shows. */
export function expandHome(projects: Project[], mid: string, typed: string): string {
  const home = homeOf(projectsOf(projects, mid).map(p => p.path))
  return typed.startsWith('~') && home ? home + typed.slice(1) : typed
}

/** How directory `dir` stands among machine `mid`'s projects: one itself, and how many it holds. */
export function projectsAt(projects: Project[], mid: string, dir: string) {
  const paths = projectsOf(projects, mid).map(p => p.path)
  return { is: paths.includes(dir), holds: paths.filter(p => p.startsWith(`${dir}/`)).length }
}
