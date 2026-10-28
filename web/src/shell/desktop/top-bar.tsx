// The bar atop every page on a computer, kept out of the pages so it stays while a file tab hides
// them: the project's (or every agent's), with the file tabs in it.

import { useMatch, useParams } from 'react-router'
import { showTab } from '../../core/tabs'
import { AllHeader, ProjectHeader } from '../../features/board/project-header'
import { TabBar } from '../../features/tabs/tab-bar'
import type { Project } from '../../model/projects'
import { peekHref } from '../../utils/hrefs'

/** `tabShown`: a file tab is showing, so neither of the project's views is. */
export function TopBar({
  project,
  tabShown,
  onNew,
}: {
  project: Project | undefined
  tabShown: boolean
  onNew: () => void
}) {
  const { mid, pane } = useParams()
  const files = useMatch('/p/:key/files/*')
  const terminal = useMatch('/t/:mid/:pane')
  const tabs = <TabBar />
  if (!project) return <AllHeader tabs={tabs} onNew={onNew} />
  const view = terminal ? undefined : files ? 'files' : 'agents'
  // From an agent's terminal, Agents leads back to the board with the agent open beside it.
  const agent = terminal && project.sessions.some(s => s.mid === mid && s.paneId === pane)
  return (
    <ProjectHeader
      project={project}
      tabs={tabs}
      onNew={onNew}
      {...(view === undefined ? {} : { current: view })}
      // Beneath a file tab, the page's own view shows it again as it was, without going anywhere.
      reveal={tabShown ? () => showTab(null) : undefined}
      {...(agent && mid && pane ? { agentsHref: peekHref(project.key, mid, pane) } : {})}
    />
  )
}
