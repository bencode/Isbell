// The folders of the directory browsed, each listed only while it is open; or, while a search is
// typed, the files found there. A project with other worktrees switches between them above the
// tree. Which folders are open is kept for each directory.

import { RotateCw } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Button } from '../../components/button'
import { errorText, useI18n } from '../../core/i18n'
import { openDirs, toggleDir, useLocal } from '../../core/prefs'
import { useSpace } from '../../core/space'
import { refreshWorktrees } from '../../core/worktrees'
import { ancestors, join } from '../../model/files/paths'
import type { FilesRoot } from '../../model/files/worktrees'
import type { Project } from '../../model/projects'
import { projectFilesHref } from '../../utils/hrefs'
import { useKeptScroll } from '../../utils/kept-scroll'
import { since, useNow } from '../../utils/time'
import { FileRow, FolderRow, indent } from './rows'
import { SearchBox, SearchResults } from './search'
import { useListing } from './use-remote'
import { WorktreeSwitcher } from './worktree-switcher'

type Props = {
  mid: string
  project: Project
  /** The project's own directory, then its other worktrees. */
  roots: FilesRoot[]
  /** The one the address names. */
  root: FilesRoot
  /** A directory to open down to, relative to `root` ('' for none). */
  dir: string
  /** The file being read, relative to `root` ('' for none). */
  current: string
  /** Keeps a file open, on a double click. */
  onPin: (rel: string) => void
}

export type Where = { mid: string; root: FilesRoot; current: string; onPin: Props['onPin'] }

export function Tree({ mid, project, roots, root, dir, current, onPin }: Props) {
  const { key } = root
  const t = useI18n()
  const { call } = useSpace()
  const layout = useLocal().layout
  const [round, setRound] = useState(0)
  const [query, setQuery] = useState('')
  const scroll = useKeptScroll<HTMLDivElement>()

  // The directory asked for and the folders of a file being read are always open.
  useEffect(() => {
    if (dir) openDirs(key, [...ancestors(dir), dir])
  }, [key, dir])
  useEffect(() => {
    if (current) openDirs(key, ancestors(current))
  }, [key, current])

  const several = roots.length > 1
  return (
    <aside className="flex min-w-0 flex-1 flex-col bg-side">
      <div className="flex flex-col gap-2 border-b border-line px-3 py-2.5">
        <div className="flex min-w-0 items-center gap-2">
          <b className="truncate">{project.name}</b>
          {several ? null : (
            <span className="min-w-0 truncate font-mono text-[11.5px] text-faint">{project.display}</span>
          )}
          <span className="flex-1" />
          <Button
            size="icon"
            variant="quiet"
            onClick={() => {
              refreshWorktrees(call, project)
              setRound(r => r + 1)
            }}
            aria-label={t('files.refresh')}
            title={t('files.refresh')}
          >
            <RotateCw size={14} />
          </Button>
        </div>
        {several ? <WorktreeSwitcher project={project} roots={roots} root={root} /> : null}
        <SearchBox onQuery={setQuery} placeholder={several ? t('files.searchHere') : undefined} />
      </div>
      <div {...scroll} className="min-h-0 flex-1 overflow-auto px-1.5 py-1.5">
        {/* A new round lists every open folder again. */}
        <div key={round}>
          {query ? (
            <SearchResults where={{ mid, root, current, onPin }} query={query} />
          ) : (
            <Level where={{ mid, root, current, onPin }} rel="" depth={0} open={layout.files[key] ?? []} />
          )}
        </div>
      </div>
    </aside>
  )
}

/** The entries of the folder at `rel`; open subfolders list theirs below them. */
function Level({ where, rel, depth, open }: { where: Where; rel: string; depth: number; open: string[] }) {
  const t = useI18n()
  const now = useNow()
  const { data, error } = useListing(where.mid, join(where.root.path, rel))
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
              to={projectFilesHref(where.root.key, child)}
              on={child === where.current}
              onDoubleClick={() => where.onPin(child)}
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
              onToggle={() => toggleDir(where.root.key, child)}
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
