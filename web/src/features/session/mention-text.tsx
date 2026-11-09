// The paths an agent mentions, made into links that open them where the reply's project is known:
// a file in its tab, a directory in the project's files; elsewhere the words as they are.

import { Fragment, useContext } from 'react'
import { Link } from 'react-router'
import { useFilesRoots } from '../../core/worktrees'
import { type Mention, mentions } from '../../model/files/mentions'
import { projectFilesHref } from '../../utils/hrefs'
import { keyed } from '../../utils/keyed'
import { PathRoot } from './context'

/** Where a path mentioned leads. */
const mentionHref = (m: Mention) => projectFilesHref(m.root, m.dir ? `${m.rel}/` : m.rel)

/** How a reply finds the paths in its words, and where each leads; null where its project is not
 * known. */
export function useMentions() {
  const root = useContext(PathRoot)
  // Paths may lead into the project's other worktrees too, where they can be opened.
  const { roots } = useFilesRoots(root?.project)
  if (!root || root.filesOpen === false) return null
  return { find: (text: string) => mentions(text, roots, root.cwd), href: mentionHref }
}

export function MentionText({ text }: { text: string }) {
  const found = useMentions()
  if (!found) return text
  return keyed(found.find(text), p => (typeof p === 'string' ? p : p.text)).map(([key, piece]) =>
    typeof piece === 'string' ? (
      <Fragment key={key}>{piece}</Fragment>
    ) : (
      <Link
        key={key}
        to={found.href(piece)}
        className="text-inherit underline decoration-line-strong decoration-1 underline-offset-[3px] hover:text-accent hover:decoration-current focus-visible:outline-2 focus-visible:outline-accent"
      >
        {piece.text}
      </Link>
    ),
  )
}
