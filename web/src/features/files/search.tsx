// Finding a file by part of its path: typed into the tree's box, asked of the machine once typing
// pauses, and shown in place of the tree as a tree of its own.

import { Search } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { errorText, useI18n } from '../../core/i18n'
import { matchParts, type PathNode, pathTree } from '../../model/files/path-tree'
import type { Project } from '../../model/projects'
import { FileRow, FolderRow } from './rows'
import { useSearch } from './use-remote'

const PAUSE_MS = 300

/** The search box; `onQuery` hears the trimmed text once typing pauses, and '' when it is cleared. */
export function SearchBox({ onQuery }: { onQuery: (query: string) => void }) {
  const t = useI18n()
  const [text, setText] = useState('')
  useEffect(() => {
    const timer = setTimeout(() => onQuery(text.trim()), PAUSE_MS)
    return () => clearTimeout(timer)
  }, [text, onQuery])
  return (
    <label className="flex h-[30px] items-center gap-1.5 rounded-md border border-line bg-raised px-2 focus-within:border-accent">
      <Search size={13} className="flex-none text-faint" />
      <input
        type="search"
        value={text}
        onChange={e => setText(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Escape') setText('')
        }}
        // The machine takes up to 200 characters.
        maxLength={200}
        placeholder={t('files.search')}
        aria-label={t('files.search')}
        className="min-w-0 flex-1 border-0 bg-transparent text-[13px] outline-none"
      />
    </label>
  )
}

export function SearchResults({
  where: { mid, project, current, hrefOf },
  query,
}: {
  where: { mid: string; project: Project; current: string; hrefOf: (rel: string) => string }
  query: string
}) {
  const t = useI18n()
  const { data, error } = useSearch(mid, project.path, query)
  const tree = useMemo(() => (data ? pathTree(data.paths) : []), [data])
  // Folders the reader closed; every other folder of the results shows open.
  const [closed, setClosed] = useState<ReadonlySet<string>>(new Set())
  if (error) return <p className="m-0 px-1.5 py-1 text-[12.5px] text-danger">{errorText(t, error)}</p>
  if (!data) return <p className="m-0 px-1.5 py-1 text-[12.5px] text-faint">{t('files.searching')}</p>
  if (!data.paths.length)
    return <p className="m-0 px-1.5 py-1 text-[12.5px] text-faint">{t('files.noMatch')}</p>
  const toggle = (rel: string) =>
    setClosed(was => (was.has(rel) ? new Set([...was].filter(r => r !== rel)) : new Set([...was, rel])))
  return (
    <>
      <Nodes nodes={tree} depth={0} at={{ query, current, hrefOf, closed, toggle }} />
      {data.truncated ? (
        <p className="m-0 px-1.5 py-1 text-[12px] text-faint">
          {t('files.moreMatches', { n: data.paths.length })}
        </p>
      ) : null}
    </>
  )
}

type ResultsCtx = {
  query: string
  current: string
  hrefOf: (rel: string) => string
  closed: ReadonlySet<string>
  toggle: (rel: string) => void
}

function Nodes({ nodes, depth, at }: { nodes: PathNode[]; depth: number; at: ResultsCtx }) {
  return nodes.map(node =>
    node.kind === 'file' ? (
      <FileRow
        key={node.rel}
        depth={depth}
        name={node.name}
        to={at.hrefOf(node.rel)}
        on={node.rel === at.current}
        title={node.rel}
        label={<Hits text={node.name} query={at.query} />}
      />
    ) : (
      <div key={node.rel}>
        <FolderRow
          depth={depth}
          open={!at.closed.has(node.rel)}
          onToggle={() => at.toggle(node.rel)}
          title={node.rel}
          label={<Hits text={node.name} query={at.query} />}
        />
        {at.closed.has(node.rel) ? null : <Nodes nodes={node.children} depth={depth + 1} at={at} />}
      </div>
    ),
  )
}

/** `text` with the parts the query matched marked. */
function Hits({ text, query }: { text: string; query: string }) {
  return matchParts(text, query).map(part =>
    part.hit ? (
      <mark key={part.at} className="rounded-[2px] bg-accent-soft text-text">
        {part.text}
      </mark>
    ) : (
      part.text
    ),
  )
}
