// The project's folders, each listed only while it is open; or, while a search is typed, the files
// found. Which folders are open is kept per project.

import { RotateCw } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Button } from '../../components/button'
import { errorText, useI18n } from '../../core/i18n'
import { openDirs, toggleDir, useLocal } from '../../core/prefs'
import { ancestors, join } from '../../model/files/paths'
import type { Project } from '../../model/projects'
import { since, useNow } from '../../utils/time'
import { FileRow, FolderRow, indent } from './rows'
import { SearchBox, SearchResults } from './search'
import { useListing } from './use-remote'

type Where = {
  mid: string
  project: Project
  /** A directory to open down to, relative to the root ('' for none). */
  dir: string
  /** The file being read, relative to the root ('' for none). */
  current: string
  hrefOf: (rel: string) => string
}

export function Tree(where: Where) {
  const t = useI18n()
  const { project, dir, current } = where
  const open = useLocal().layout.files[project.key]
  const [round, setRound] = useState(0)
  const [query, setQuery] = useState('')

  // The directory asked for, and the folders of a file being read, are always open.
  useEffect(() => {
    if (dir) openDirs(project.key, [...ancestors(dir), dir])
  }, [project.key, dir])
  useEffect(() => {
    if (current) openDirs(project.key, ancestors(current))
  }, [project.key, current])

  return (
    <aside className="flex min-w-0 flex-1 flex-col bg-side">
      <div className="flex flex-col gap-2 border-b border-line px-3 py-2.5">
        <div className="flex min-w-0 items-center gap-2">
          <b className="truncate">{project.name}</b>
          <span className="min-w-0 truncate font-mono text-[11.5px] text-faint">{project.display}</span>
          <span className="flex-1" />
          <Button
            size="icon"
            variant="quiet"
            onClick={() => setRound(r => r + 1)}
            aria-label={t('files.refresh')}
            title={t('files.refresh')}
          >
            <RotateCw size={14} />
          </Button>
        </div>
        <SearchBox onQuery={setQuery} />
      </div>
      {/* A new round lists every open folder again. */}
      <div key={round} className="min-h-0 flex-1 overflow-auto px-1.5 py-1.5">
        {query ? (
          <SearchResults where={where} query={query} />
        ) : (
          <Level where={where} rel="" depth={0} open={open ?? []} />
        )}
      </div>
    </aside>
  )
}

/** The entries of the folder at `rel`; open subfolders list theirs below them. */
function Level({ where, rel, depth, open }: { where: Where; rel: string; depth: number; open: string[] }) {
  const t = useI18n()
  const now = useNow()
  const { data, error } = useListing(where.mid, join(where.project.path, rel))
  const pad = indent(depth)
  if (error)
    return (
      <p className="m-0 py-1 text-[12.5px] text-danger" style={pad}>
        {errorText(t, error)}
      </p>
    )
  if (!data)
    return (
      <p className="m-0 py-1 text-[12.5px] text-faint" style={pad}>
        {t('board.loading')}
      </p>
    )
  if (!data.entries.length)
    return (
      <p className="m-0 py-1 text-[12.5px] text-faint" style={pad}>
        {t('files.empty')}
      </p>
    )
  const hidden = data.total - data.entries.length
  return (
    <>
      {data.entries.map(entry => {
        const child = rel ? `${rel}/${entry.name}` : entry.name
        if (entry.kind !== 'dir')
          return (
            <FileRow
              key={entry.name}
              depth={depth}
              name={entry.name}
              to={where.hrefOf(child)}
              on={child === where.current}
              label={entry.name}
              extra={
                entry.mtime === undefined ? null : (
                  <span className="flex-none text-[11.5px] text-faint">{since(entry.mtime, now)}</span>
                )
              }
            />
          )
        const isOpen = open.includes(child)
        return (
          <div key={entry.name}>
            <FolderRow
              depth={depth}
              open={isOpen}
              onToggle={() => toggleDir(where.project.key, child)}
              label={entry.name}
            />
            {isOpen ? <Level where={where} rel={child} depth={depth + 1} open={open} /> : null}
          </div>
        )
      })}
      {hidden > 0 ? (
        <p className="m-0 py-1 text-[12px] text-faint" style={pad}>
          {t('files.more', { n: hidden })}
        </p>
      ) : null}
    </>
  )
}
