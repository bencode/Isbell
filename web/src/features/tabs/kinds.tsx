// The kinds of tab, each with the pattern its ids match (a file's is `file/<project>/<rel>`): what
// one shows, and what it says in the bar. Another kind of tab is another line in KINDS.

import { FileText, type LucideIcon } from 'lucide-react'
import { type ComponentType, lazy } from 'react'
import { matchPath, type Params } from 'react-router'
import { nameOf } from '../../model/files/paths'
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
      const project = projects.find(p => p.key === key)
      return { name: nameOf(rel), where: project?.name ?? key, full: `${project?.display ?? key}/${rel}` }
    },
  },
]

export const fileTabId = (projectKey: string, rel: string) => `file/${projectKey}/${rel}`

/** The kind of tab `id` names, and what its pattern took from it. */
export function kindOf(id: string) {
  for (const kind of KINDS) {
    const match = matchPath(kind.pattern, `/${id}`)
    if (match) return { kind, params: match.params }
  }
  return undefined
}

export const isTab = (id: string) => kindOf(id) !== undefined

export function TabPane({ id }: { id: string }) {
  const found = kindOf(id)
  return found ? <found.kind.Pane id={id} params={found.params} /> : null
}
