// The kinds of tab, each with the pattern its ids match (a file's is `file/<root key>/<rel>`): what
// one shows, and what it says in the bar. Another kind of tab is another line in KINDS.

import { FileText, type LucideIcon } from 'lucide-react'
import { type ComponentType, lazy } from 'react'
import { matchPath, type Params } from 'react-router'
import { nameOf } from '../../model/files/paths'
import { parseRootKey } from '../../model/files/worktrees'
import type { Project } from '../../model/projects'

type TabKind = {
  pattern: string
  Icon: LucideIcon
  Pane: ComponentType<{ id: string; params: Params }>
  /** What the tab says: its name, where it is from, and both at length. */
  label: (params: Params, projects: Project[]) => { name: string; where: string; full: string }
}

// A file reads with the same libraries as a project's files, and loads them with its first tab.
const FilePane = lazy(() => import('./file-tab').then(m => ({ default: m.FileTabPane })))

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
]

/** A file's tab, by the key of the root it is under. */
export const fileTabId = (key: string, rel: string) => `file/${key}/${rel}`

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
