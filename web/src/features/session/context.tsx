// What the parts of a session's tab share without passing it down: where its replies' paths lead,
// and how to switch the tab to the session's terminal.

import { createContext, type ReactNode, useContext } from 'react'
import type { Project } from '../../model/projects'

/** The project a reply's paths lead into, read from the agent's directory. */
export const PathRoot = createContext<{ project: Project; cwd: string } | null>(null)

/** Shows the session's terminal in its tab. */
export const ShowTerminal = createContext<(() => void) | null>(null)

export function useShowTerminal() {
  const show = useContext(ShowTerminal)
  if (!show) throw new Error("A session's tab is required.")
  return show
}

/** A link to the session's terminal, in the words of what it is for. */
export function TerminalLink({ children }: { children: ReactNode }) {
  const show = useShowTerminal()
  return (
    <button
      type="button"
      onClick={show}
      className="cursor-pointer border-0 bg-transparent p-0 [font:inherit] text-accent hover:underline focus-visible:outline-2 focus-visible:outline-accent"
    >
      {children}
    </button>
  )
}
