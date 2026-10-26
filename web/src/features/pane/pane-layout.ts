import type { ComponentType, ReactNode } from 'react'
import type { Found } from '../../model/projects'

/** What a pane page hands its shell to arrange. */
export type PaneParts = {
  found: Found
  mid: string
  paneId: string
  /** Which view of an agent's pane this is; a shell has only the terminal. */
  view: 'chat' | 'terminal'
  onEnd: () => void
  /** The facts; mounted only while shown, so what they poll stops with them. */
  facts: ReactNode
  /** The page itself: the turns and the composer, or the terminal and its status line. */
  children: ReactNode
}

/** How a shell arranges a pane page around its body. */
export type PaneLayout = ComponentType<PaneParts>
