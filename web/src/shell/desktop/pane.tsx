import { ProjectHeader } from '../../features/board/project-header'
import { PaneBar } from '../../features/pane/pane-bar'
import type { PaneParts } from '../../features/pane/pane-layout'
import { peekHref, projectHref } from '../../utils/hrefs'

/** A pane's terminal on a computer, the page's whole width: under its project's bar, whose Agents
 * leads back to the board with an agent open beside it, then the pane's own bar. */
export function DesktopPane({ found, mid, paneId, onEnd, facts, children }: PaneParts) {
  const { project, pane } = found
  const agents = 'session' in pane ? peekHref(project.key, mid, paneId) : projectHref(project.key)
  return (
    <div className="flex h-full flex-col">
      <ProjectHeader project={project} agentsHref={agents} />
      <PaneBar found={found} onEnd={onEnd} facts={facts} showProject={false} />
      {children}
    </div>
  )
}
