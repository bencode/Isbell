// The tree of a project's directory or worktree on a phone, its folders opening in place and
// scrolling with the page; or, while a search is typed, the files found.

import { ChevronDown, ChevronRight, Folder, FolderOpen, RotateCw } from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Link } from 'react-router'
import { errorText, useI18n } from '../../../core/i18n'
import { openDirs, toggleDir, useLocal } from '../../../core/prefs'
import { useListing } from '../../../core/remote-files'
import { useSpace } from '../../../core/space'
import { refreshWorktrees } from '../../../core/worktrees'
import { guides, hidden, iconOf, indent } from '../../../features/files/rows'
import { PAUSE_MS } from '../../../features/files/search'
import { ancestors, join } from '../../../model/files/paths'
import type { FilesRoot } from '../../../model/files/worktrees'
import type { Project } from '../../../model/projects'
import { projectFilesHref } from '../../../utils/hrefs'
import { BackButton, PhoneBar, TAP } from '../bar'
import { SearchField, SearchResults } from './search'
import { WorktreeSheet } from './worktree-sheet'

const ROW =
  'flex h-11 w-full min-w-0 items-center gap-[7px] rounded-lg pr-2 text-left text-[15px] text-text no-underline active:bg-press'
/** A file's name lines up with a folder's, past the chevron. */
const CHEVRON = 15 + 7

type Props = {
  project: Project
  /** The project's own directory, then its other worktrees. */
  roots: FilesRoot[]
  root: FilesRoot
  /** A directory to open down to, relative to `root` ('' for none). */
  dir: string
}

export function FilesTree({ project, roots, root, dir }: Props) {
  const t = useI18n()
  const { call } = useSpace()
  const open = useLocal().layout.files[root.key] ?? []
  const [round, setRound] = useState(0)
  const [text, setText] = useState('')
  const [query, setQuery] = useState('')
  useEffect(() => {
    const timer = setTimeout(() => setQuery(text.trim()), PAUSE_MS)
    return () => clearTimeout(timer)
  }, [text])
  useEffect(() => {
    if (dir) openDirs(root.key, [...ancestors(dir), dir])
  }, [root.key, dir])

  // Back at the spot it was left each time it shows again from behind a file.
  const place = useRef(0)
  useLayoutEffect(() => {
    window.scrollTo(0, place.current)
    const remember = () => {
      place.current = window.scrollY
    }
    window.addEventListener('scroll', remember, { passive: true })
    return () => window.removeEventListener('scroll', remember)
  }, [])

  const refresh = () => {
    void refreshWorktrees(call, project)
    setRound(r => r + 1)
  }
  const under = (
    <div className="flex items-center gap-1.5 border-t border-line px-2.5 py-2">
      {roots.length > 1 ? <WorktreeSheet project={project} roots={roots} root={root} /> : null}
      <SearchField value={text} onChange={setText} placeholder={t('files.search')} />
    </div>
  )
  return (
    <div className="flex min-h-dvh flex-col">
      <PhoneBar under={under}>
        <BackButton />
        <div className="min-w-0 flex-1">
          <b className="block truncate text-[14.5px] leading-tight font-semibold">{t('workbench.files')}</b>
          <span className="block truncate text-[11.5px] leading-tight text-faint">
            {project.name} · {project.machine}
          </span>
        </div>
        <button type="button" onClick={refresh} aria-label={t('files.refresh')} className={TAP}>
          <RotateCw size={19} />
        </button>
      </PhoneBar>
      {/* A new round lists every open folder again. */}
      <main key={round} className="min-w-0 flex-1 px-2 pt-1.5 pb-4">
        {query ? (
          <SearchResults mid={project.mid} root={root} query={query} />
        ) : (
          <Level mid={project.mid} root={root} rel="" depth={0} open={open} />
        )}
      </main>
    </div>
  )
}

type LevelProps = { mid: string; root: FilesRoot; rel: string; depth: number; open: string[] }

/** The entries of the folder at `rel`; open subfolders list theirs below them. */
function Level({ mid, root, rel, depth, open }: LevelProps) {
  const t = useI18n()
  const { data, error } = useListing(mid, join(root.path, rel))
  const note = (words: string, color = 'text-faint') => (
    <p className={`m-0 py-2 text-[13px] ${color}`} style={indent(depth)}>
      {words}
    </p>
  )
  if (error) return note(errorText(t, error), 'text-danger')
  if (!data) return note(t('board.loading'))
  if (!data.entries.length) return note(t('files.empty'))
  const unlisted = data.total - data.entries.length
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
              to={projectFilesHref(root.key, child)}
            />
          )
        const isOpen = open.includes(child)
        return (
          <div key={entry.name}>
            <FolderRow
              depth={depth}
              name={entry.name}
              open={isOpen}
              onToggle={() => toggleDir(root.key, child)}
            />
            {isOpen ? <Level mid={mid} root={root} rel={child} depth={depth + 1} open={open} /> : null}
          </div>
        )
      })}
      {unlisted > 0 ? note(t('files.more', { n: unlisted })) : null}
    </>
  )
}

function FolderRow({
  depth,
  name,
  open,
  onToggle,
}: {
  depth: number
  name: string
  open: boolean
  onToggle: () => void
}) {
  const Chevron = open ? ChevronDown : ChevronRight
  const Icon = open ? FolderOpen : Folder
  return (
    <button
      type="button"
      aria-expanded={open}
      onClick={onToggle}
      className={`${ROW} cursor-pointer border-0 bg-transparent`}
      style={{ ...indent(depth), ...guides(depth) }}
    >
      <Chevron size={15} className="flex-none text-faint" />
      <Icon size={17} className="flex-none text-muted" />
      <span className={`min-w-0 flex-1 truncate ${hidden(name) ? 'text-faint' : ''}`}>{name}</span>
    </button>
  )
}

function FileRow({ depth, name, to }: { depth: number; name: string; to: string }) {
  const Icon = iconOf(name)
  return (
    <Link
      to={to}
      className={ROW}
      style={{ ...guides(depth), paddingLeft: indent(depth).paddingLeft + CHEVRON }}
    >
      <Icon size={17} className="flex-none text-muted" />
      <span className={`min-w-0 flex-1 truncate ${hidden(name) ? 'text-faint' : ''}`}>{name}</span>
    </Link>
  )
}
