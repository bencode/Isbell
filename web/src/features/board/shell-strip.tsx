// The plain shells running in a project, under its board; each opens in its terminal. All agents
// leaves them out: every project's shells together are more noise than use.

import { SquareTerminal } from 'lucide-react'
import { Link } from 'react-router'
import { useI18n } from '../../core/i18n'
import type { Project } from '../../model/projects'
import { terminalHref } from '../../utils/hrefs'

export function ShellStrip({ project }: { project: Project }) {
  const t = useI18n()
  if (!project.shells.length) return null
  return (
    <section className="flex flex-none flex-wrap items-center gap-2">
      <h2 className="m-0 mr-1 text-[11px] font-semibold tracking-[0.04em] text-faint uppercase">
        {t('shells.title', { n: project.shells.length })}
      </h2>
      {project.shells.map(shell => {
        // Where it is below the project's root, when it is not at the root.
        const below = shell.cwd.slice(project.path.length)
        return (
          <Link
            key={shell.paneId}
            to={terminalHref(shell.mid, shell.paneId)}
            title={shell.title}
            className="inline-flex h-7 items-center gap-1.5 rounded-md border border-line bg-raised px-2.5 font-mono text-xs text-muted no-underline hover:border-line-strong hover:text-text"
          >
            <SquareTerminal size={13} />
            {shell.paneId}
            {below ? <span className="text-faint">{below}</span> : null}
          </Link>
        )
      })}
    </section>
  )
}
