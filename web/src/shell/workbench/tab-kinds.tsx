// The kinds of tab, each with the pattern its ids match (a file's is `file/<root key>/<rel>`, a
// session's or a shell's `session/<machine>/<pane>`, a session that ran
// `closed/<machine>/<agent>/<id>`): what one shows, and what it says in the bar.
// Another kind of tab is another line in KINDS.

import { FileText, History, type LucideIcon, SquareTerminal } from 'lucide-react'
import { type ComponentType, lazy } from 'react'
import { matchPath, type Params, type To } from 'react-router'
import type { Lookup } from '../../core/session-records'
import { nameOf } from '../../model/files/paths'
import { parseRootKey } from '../../model/files/worktrees'
import { locate, type Project } from '../../model/projects'
import { under } from '../../model/sessions'
import type { AgentStatus } from '../../model/state'
import { sessionTabId, withTab, withTerminal } from '../../model/tabs'
import { projectHref } from '../../utils/hrefs'

/** What a tab's label is read from: the projects, and the sessions recorded so far. */
export type LabelFrom = {
  projects: Project[]
  lookup: Lookup
}

type TabKind = {
  pattern: string
  Icon: LucideIcon
  Pane: ComponentType<{ id: string; params: Params }>
  /** What the tab says: its name, where it is from, and both at length; an agent's, how it stands. */
  label: (
    params: Params,
    from: LabelFrom,
  ) => { name: string; where: string; full: string; status?: AgentStatus }
}

// A file reads with the same libraries as a project's files, and loads them with its first tab.
const FilePane = lazy(() => import('../../features/files/file-tab').then(m => ({ default: m.FileTabPane })))
// A session brings its terminal, which loads with the first.
const SessionPane = lazy(() =>
  import('../../features/session/session-tab').then(m => ({ default: m.SessionTabPane })),
)
const ClosedPane = lazy(() =>
  import('../../features/session/closed-tab').then(m => ({ default: m.ClosedTabPane })),
)

const KINDS: TabKind[] = [
  {
    pattern: '/file/:key/*',
    Icon: FileText,
    Pane: FilePane,
    label: ({ key = '', '*': rel = '' }, { projects }) => {
      const at = parseRootKey(key)
      const project = projects.find(p => p.key === at.project)
      const [name, display] = [project?.name ?? at.project, project?.display ?? at.project]
      return at.branch === undefined
        ? { name: nameOf(rel), where: name, full: `${display}/${rel}` }
        : { name: nameOf(rel), where: `${name} · ${at.branch}`, full: `${display}@${at.branch}/${rel}` }
    },
  },
  {
    // A pane's id may hold '/'.
    pattern: '/session/:mid/*',
    Icon: SquareTerminal,
    Pane: SessionPane,
    label: ({ mid = '', '*': paneId = '' }, { projects }) => {
      const found = locate(projects, mid, paneId)
      if (!found) return { name: paneId, where: '', full: paneId }
      const { project, name, pane } = found
      const full = `${name} · ${project.machine}:${project.display}`
      return 'session' in pane
        ? { name, where: project.name, full, status: pane.session.status }
        : { name: pane.shell.title ?? name, where: project.name, full }
    },
  },
  {
    pattern: '/closed/:mid/:agent/:id',
    Icon: History,
    Pane: ClosedPane,
    label: ({ mid = '', agent = '', id = '' }, { projects, lookup }) => {
      const line = lookup(mid, agent, id)
      // The deepest project it ran in, as projects may hold one another.
      const project = line
        ? projects
            .filter(p => p.mid === mid && under(line.cwd, p.path))
            .sort((a, b) => b.path.length - a.path.length)[0]
        : undefined
      const name = line?.first ?? agent
      return {
        name,
        where: project?.name ?? '',
        full: project ? `${name} · ${project.machine}:${project.display}` : name,
      }
    },
  },
]

/** A file's tab, by the key of the root it is under. */
export const fileTabId = (key: string, rel: string) => `file/${key}/${rel}`

/** A session's tab in its project. */
export const sessionTabHref = (projectKey: string, mid: string, paneId: string, terminal = false): To => ({
  pathname: projectHref(projectKey),
  search: withTab(withTerminal('', terminal), sessionTabId(mid, paneId)),
})

/** The kind of tab `id` names, and what its pattern took from it; each part must name something. */
export function kindOf(id: string) {
  for (const kind of KINDS) {
    const match = matchPath(kind.pattern, `/${id}`)
    if (match && Object.values(match.params).every(Boolean)) return { kind, params: match.params }
  }
  return undefined
}

export const isTab = (id: string) => kindOf(id) !== undefined

export function TabPane({ id }: { id: string }) {
  const found = kindOf(id)
  return found ? <found.kind.Pane id={id} params={found.params} /> : null
}
