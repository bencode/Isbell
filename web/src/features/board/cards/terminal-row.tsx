// A plain shell in a project, at the foot of the standing lane: where it is, a way into its
// terminal, and a way to end it.

import { SquareTerminal } from 'lucide-react'
import { Link } from 'react-router'
import { useEnding } from '../../../core/ending'
import type { PlacedShell } from '../../../model/projects'
import { terminalHref } from '../../../utils/hrefs'
import { EndButton, EndingNote } from './card'

/** `scoped`: all of one project's, so the row need not say which. */
export function TerminalRow({
  placed: { shell, project },
  scoped,
}: {
  placed: PlacedShell
  scoped: boolean
}) {
  const ending = useEnding(shell.mid, shell.paneId)
  // Where it is below the project's root, when it is not at the root.
  const below = shell.cwd.slice(project.path.length)
  return (
    <div
      className={`flex min-h-[34px] items-center gap-1.5 rounded-lg border border-line bg-raised px-2.5 py-1 text-[13px] ${ending ? 'opacity-60' : ''}`}
    >
      <Link
        to={terminalHref(shell.mid, shell.paneId)}
        title={shell.title}
        className="flex min-w-0 flex-1 items-center gap-1.5 text-muted no-underline hover:text-text"
      >
        <SquareTerminal size={13} className="flex-none" />
        <span className="flex-none font-mono text-xs">{shell.paneId}</span>
        {below ? <span className="min-w-0 truncate font-mono text-xs text-faint">{below}</span> : null}
        {scoped ? null : <span className="min-w-0 truncate text-[11.5px] text-faint">{project.name}</span>}
      </Link>
      {ending ? <EndingNote pane={shell} ending={ending} /> : <EndButton pane={shell} />}
    </div>
  )
}
