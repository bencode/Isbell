// The bar atop every page on a computer, kept out of the pages so it stays while a tab hides them:
// the project's (or every agent's), with the tabs in it, the page itself first among them.

import { useMatch } from 'react-router'
import { useI18n } from '../../core/i18n'
import { AllHeader, ProjectHeader } from '../../features/board/project-header'
import { PageTab, TabBar } from '../../features/tabs/tab-bar'
import type { Project } from '../../model/projects'
import type { TabEntry } from '../../model/tabs'
import { peekHref } from '../../utils/hrefs'

/** `open` and `active`: the tabs, and the one shown (null: the page). */
export function TopBar({
  project,
  open,
  active,
  onNew,
}: {
  project: Project | undefined
  open: TabEntry[]
  active: string | null
  onNew: () => void
}) {
  const t = useI18n()
  const files = useMatch('/p/:key/files/*')
  const terminal = useMatch('/t/:mid/:pane')
  const tabs = <TabBar open={open} active={active} />
  const title = project?.name ?? t('all.title')
  const pageTab = open.length
    ? { pageTab: <PageTab title={title} hint={project?.display} shown={active === null} /> }
    : {}
  if (!project) return <AllHeader tabs={tabs} onNew={onNew} {...pageTab} />
  // Beneath a tab, neither of the project's views is the one shown.
  const view = terminal || active !== null ? undefined : files ? 'files' : 'agents'
  // From an agent's terminal, Agents leads back to the board with the agent open beside it.
  const at = terminal?.params
  const agent = at && project.sessions.find(s => s.mid === at.mid && s.paneId === at.pane)
  return (
    <ProjectHeader
      project={project}
      tabs={tabs}
      onNew={onNew}
      {...pageTab}
      {...(view === undefined ? {} : { current: view })}
      {...(agent ? { agentsHref: peekHref(project.key, agent.mid, agent.paneId) } : {})}
    />
  )
}
