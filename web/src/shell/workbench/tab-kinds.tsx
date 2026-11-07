// The kinds of tab, each with the pattern its ids match (a file's is `file/<root key>/<rel>`, a
// session's or a shell's `session/<machine>/<pane>`): what one shows, and what it says in the bar.
// Another kind of tab is another line in KINDS.

import { FileText, type LucideIcon, SquareTerminal } from 'lucide-react'
import { type ComponentType, lazy } from 'react'
import { matchPath, type Params, type To } from 'react-router'
import { nameOf } from '../../model/files/paths'
import { parseRootKey } from '../../model/files/worktrees'
import { locate, type Project } from '../../model/projects'
import type { AgentStatus } from '../../model/state'
import { withTab } from '../../model/tabs'
import { projectHref } from '../../utils/hrefs'

type TabKind = {
  pattern: string
  Icon: LucideIcon
  Pane: ComponentType<{ id: string; params: Params }>
  /** What the tab says: its name, where it is from, and both at length; an agent's, how it stands. */
  label: (
    params: Params,
    projects: Project[],
  ) => { name: string; where: string; full: string; status?: AgentStatus }
}

// A file reads with the same libraries as a project's files, and loads them with its first tab.
const FilePane = lazy(() => import('../../features/files/file-tab').then(m => ({ default: m.FileTabPane })))
// A session brings its terminal, which loads with the first.
const SessionPane = lazy(() =>
  import('../../features/session/session-tab').then(m => ({ default: m.SessionTabPane })),
)

const KINDS: TabKind[] = [
  {
    pattern: '/file/:key/*',
    Icon: FileText,
    Pane: FilePane,
    label: ({ key = '', '*': rel = '' }, projects) => {
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
    label: ({ mid = '', '*': paneId = '' }, projects) => {
      const found = locate(projects, mid, paneId)
      if (!found) return { name: paneId, where: '', full: paneId }
      const { project, name, pane } = found
      const full = `${name} · ${project.machine}:${project.display}`
      return 'session' in pane
        ? { name, where: project.name, full, status: pane.session.status }
        : { name: pane.shell.title ?? name, where: project.name, full }
    },
  },
]

/** A file's tab, by the key of the root it is under. */
export const fileTabId = (key: string, rel: string) => `file/${key}/${rel}`

/** A session's tab, or a shell's, by its machine and pane. */
export const sessionTabId = (mid: string, paneId: string) => `session/${mid}/${paneId}`

/** A session's tab in its project. */
export const sessionTabHref = (projectKey: string, mid: string, paneId: string): To => ({
  pathname: projectHref(projectKey),
  search: withTab('', sessionTabId(mid, paneId)),
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
