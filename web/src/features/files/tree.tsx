// The project's folders, each listed only while it is open; or, while a search is typed, the files
// found. Which folders are open is kept per project.

import { ChevronDown, ChevronRight, File, FileCode, FileText, Folder, RotateCw } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { Button } from '../../components/button'
import { errorText, useI18n } from '../../core/i18n'
import { openDirs, toggleDir, useLocal } from '../../core/prefs'
import { kindOf } from '../../model/files/content'
import { ancestors, join } from '../../model/files/paths'
import type { Entry } from '../../model/files/remote'
import type { Project } from '../../model/projects'
import { since, useNow } from '../../utils/time'
import { SearchBox, SearchResults } from './search'
import { useListing } from './use-remote'

const ROW =
  'flex h-[26px] w-full min-w-0 items-center gap-1.5 rounded-md pr-2 text-left text-[13px] no-underline text-text hover:bg-raised-2'

type Where = {
  mid: string
  project: Project
  /** The pane's directory relative to the root ('' for the root); marked, and opened at first. */
  cwd: string
  /** The file being read, relative to the root ('' for none). */
  current: string
  hrefOf: (rel: string) => string
}

export function Tree(where: Where) {
  const t = useI18n()
  const { project, cwd, current } = where
  const open = useLocal().layout.files[project.key]
  const [round, setRound] = useState(0)
  const [query, setQuery] = useState('')

  // A project seen for the first time opens down to the pane's directory; a file being read
  // always has its folders open.
  useEffect(() => {
    if (!open) openDirs(project.key, cwd ? [...ancestors(cwd), cwd] : [])
  }, [open, project.key, cwd])
  useEffect(() => {
    if (current) openDirs(project.key, ancestors(current))
  }, [project.key, current])

  return (
    <aside className="flex w-[300px] flex-none flex-col border-r border-line bg-side">
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
  const pad = { paddingLeft: 6 + depth * 14 }
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
          return <FileRow key={entry.name} where={where} rel={child} entry={entry} depth={depth} now={now} />
        const isOpen = open.includes(child)
        return (
          <div key={entry.name}>
            <button
              type="button"
              className={`${ROW} cursor-pointer border-0 bg-transparent`}
              style={pad}
              onClick={() => toggleDir(where.project.key, child)}
            >
              {isOpen ? (
                <ChevronDown size={13} className="flex-none text-faint" />
              ) : (
                <ChevronRight size={13} className="flex-none text-faint" />
              )}
              <Folder size={14} className="flex-none text-muted" />
              <span className="truncate">{entry.name}</span>
              {child === where.cwd ? (
                <span className="flex-none rounded-[3px] border border-line px-1 font-mono text-[10px] text-faint">
                  {t('files.cwd')}
                </span>
              ) : null}
            </button>
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

const ICONS = { markdown: FileText, html: FileCode, text: File }

function FileRow({
  where,
  rel,
  entry,
  depth,
  now,
}: {
  where: Where
  rel: string
  entry: Entry
  depth: number
  now: number
}) {
  const Icon = ICONS[kindOf(entry.name)]
  const on = rel === where.current
  return (
    <Link
      to={where.hrefOf(rel)}
      aria-current={on ? 'page' : undefined}
      className={`${ROW} ${on ? 'bg-accent-soft' : ''}`}
      // The chevron's room, so names line up with folders'.
      style={{ paddingLeft: 6 + depth * 14 + 19 }}
    >
      <Icon size={14} className="flex-none text-faint" />
      <span className="min-w-0 flex-1 truncate">{entry.name}</span>
      {entry.mtime === undefined ? null : (
        <span className="flex-none text-[11.5px] text-faint">{since(entry.mtime, now)}</span>
      )}
    </Link>
  )
}
