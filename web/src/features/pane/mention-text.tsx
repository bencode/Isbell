// The paths an agent mentions, made into links that open them, where the page can open them and the
// reply's project is known; elsewhere the words as they are.

import { Fragment, useContext } from 'react'
import { FileOpener, PathRoot } from '../../core/tabs'
import { type Mention, mentions } from '../../model/files/mentions'
import { keyed } from '../../utils/keyed'

/** How a reply finds the paths in its words and opens them; null where it cannot. */
export function useMentions() {
  const root = useContext(PathRoot)
  const open = useContext(FileOpener)
  if (!root || !open) return null
  return {
    find: (text: string) => mentions(text, root.project, root.cwd),
    open: (m: Mention) => open(root.project, m.rel, m.dir),
  }
}

export function MentionText({ text }: { text: string }) {
  const found = useMentions()
  if (!found) return text
  return keyed(found.find(text), p => (typeof p === 'string' ? p : p.text)).map(([key, piece]) =>
    typeof piece === 'string' ? (
      <Fragment key={key}>{piece}</Fragment>
    ) : (
      <button
        key={key}
        type="button"
        onClick={() => found.open(piece)}
        className="cursor-pointer border-0 bg-transparent p-0 text-left [font:inherit] text-inherit underline decoration-line-strong decoration-1 underline-offset-[3px] hover:text-accent hover:decoration-current focus-visible:outline-2 focus-visible:outline-accent"
      >
        {piece.text}
      </button>
    ),
  )
}
