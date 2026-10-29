// A project's files on a phone, one step at a time: a folder's entries, each opening the folder or
// the file below it; a file read on its own. Back returns where it came from, else goes up a level.
// An address ending in '/' is a folder, as on a computer.

import { ChevronLeft, ChevronRight, File, Folder } from 'lucide-react'
import { useCallback } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router'
import { errorText, useI18n } from '../../core/i18n'
import { useSpaceView } from '../../core/space'
import { useRootOf } from '../../core/worktrees'
import { join, nameOf } from '../../model/files/paths'
import type { FilesRoot } from '../../model/files/worktrees'
import { machineOf } from '../../model/space'
import { projectFilesHref, projectHref } from '../../utils/hrefs'
import { since, useNow } from '../../utils/time'
import { filesNote } from './files-split'
import { Preview } from './preview'
import { useListing } from './use-remote'

const ROW =
  'flex min-h-12 items-center gap-3 border-b border-line px-4 text-[15px] text-text no-underline active:bg-raised-2 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent'

/** The folder holding `rel`, '' at the root. */
const parentOf = (rel: string) => rel.slice(0, Math.max(rel.lastIndexOf('/'), 0))

export function PhoneFiles() {
  const t = useI18n()
  const params = useParams()
  const { project, root, settled } = useRootOf(params.key ?? '')
  const machine = machineOf(useSpaceView().machines, project?.mid ?? '')
  const rel = params['*'] ?? ''
  const key = root?.key ?? params.key ?? ''
  // Stable, so a document's links are not rendered again for it.
  const hrefOf = useCallback((to: string) => projectFilesHref(key, to), [key])

  // Until the projects and worktrees settle, one not found may yet appear.
  if ((!project || !root) && !settled) return <p className="m-6 text-muted">{t('board.loading')}</p>
  if (!project)
    return (
      <div className="m-6 flex flex-col items-start gap-3">
        <p className="m-0 text-muted">{t('project.gone')}</p>
        <Link to="/">{t('project.back')}</Link>
      </div>
    )
  const dir = rel.endsWith('/') ? rel.slice(0, -1) : ''
  const file = rel.endsWith('/') ? '' : rel
  const at = file || dir
  const up = at ? projectFilesHref(key, parentOf(at) && `${parentOf(at)}/`) : projectHref(project.key)
  const branch = root && !root.own ? (root.branch ?? t('files.detached')) : undefined
  const note = filesNote(t, project, machine, root)
  return (
    <div className="flex h-full flex-col">
      <Bar
        up={up}
        title={at ? nameOf(at) : project.name}
        sub={[at ? project.name : undefined, branch].filter(Boolean).join(' · ')}
      />
      {note || !root ? (
        <p className="m-6 text-muted">{note}</p>
      ) : file ? (
        <div className="flex min-h-0 flex-1">
          {/* Keyed, so each file starts with its own view mode and scroll. */}
          <Preview key={file} mid={project.mid} root={root} rel={file} hrefOf={hrefOf} alone />
        </div>
      ) : (
        <Entries mid={project.mid} root={root} dir={dir} />
      )}
    </div>
  )
}

/** Back where it came from within Isbell, or up to `up` when opened here first. */
function Bar({ up, title, sub }: { up: string; title: string; sub: string }) {
  const t = useI18n()
  const navigate = useNavigate()
  const first = useLocation().key === 'default'
  return (
    <header className="flex h-[52px] flex-none items-center border-b border-line px-1">
      <button
        type="button"
        onClick={() => (first ? navigate(up) : navigate(-1))}
        aria-label={t('pane.back')}
        className="inline-flex size-11 flex-none cursor-pointer items-center justify-center rounded-lg border-0 bg-transparent text-accent active:bg-raised-2 focus-visible:outline-2 focus-visible:outline-accent"
      >
        <ChevronLeft size={24} />
      </button>
      <div className="flex min-w-0 flex-1 flex-col px-1 leading-tight">
        <span className="truncate font-semibold">{title}</span>
        {sub ? <span className="truncate text-xs text-faint">{sub}</span> : null}
      </div>
    </header>
  )
}

/** A folder's entries, a row each: a folder opens below, a file opens to read. */
function Entries({ mid, root, dir }: { mid: string; root: FilesRoot; dir: string }) {
  const t = useI18n()
  const now = useNow()
  const { data, error } = useListing(mid, join(root.path, dir))
  if (error) return <p className="m-6 text-danger">{errorText(t, error)}</p>
  if (!data) return <p className="m-6 text-muted">{t('board.loading')}</p>
  if (!data.entries.length) return <p className="m-6 text-muted">{t('files.empty')}</p>
  const hidden = data.total - data.entries.length
  return (
    <div className="min-h-0 flex-1 overflow-auto">
      {data.entries.map(entry => {
        const child = dir ? `${dir}/${entry.name}` : entry.name
        const folder = entry.kind === 'dir'
        return (
          <Link
            key={entry.name}
            to={projectFilesHref(root.key, folder ? `${child}/` : child)}
            className={ROW}
          >
            {folder ? (
              <Folder size={18} className="flex-none text-muted" />
            ) : (
              <File size={18} className="flex-none text-faint" />
            )}
            <span className="min-w-0 flex-1 truncate">{entry.name}</span>
            {folder ? (
              <ChevronRight size={18} className="flex-none text-faint" />
            ) : entry.mtime === undefined ? null : (
              <span className="flex-none text-xs text-faint">{since(entry.mtime, now)}</span>
            )}
          </Link>
        )
      })}
      {hidden > 0 ? (
        <p className="m-0 px-4 py-3 text-[13px] text-faint">{t('files.more', { n: hidden })}</p>
      ) : null}
    </div>
  )
}
