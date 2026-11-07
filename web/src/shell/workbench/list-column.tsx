// The second column: a project's sessions or its files, as the address says. Going between them
// leaves the tab shown as it is.

import { lazy, Suspense } from 'react'
import { Link, useLocation } from 'react-router'
import { useI18n } from '../../core/i18n'
import { useFilesAt } from '../../core/worktrees'
import { dirOf } from '../../model/files/paths'
import { parseRootKey } from '../../model/files/worktrees'
import { projectFilesHref, projectHref } from '../../utils/hrefs'
import { filesOf, rootKeyOf } from './address'
import { BAR } from './bar'

// The tree reads with the same code as a project's files, and loads it when first shown.
const FilesPanel = lazy(() => import('./files-panel').then(m => ({ default: m.FilesPanel })))

const TAB =
  'relative flex h-full items-center text-[13px] no-underline transition-colors duration-75 hover:text-text focus-visible:outline-2 focus-visible:outline-accent'
const SHOWN =
  "font-semibold text-text after:absolute after:inset-x-0 after:bottom-0 after:h-0.5 after:bg-text after:content-['']"

function ListHead({ project, files }: { project: string; files: boolean }) {
  const t = useI18n()
  const { search } = useLocation()
  const at = useFilesAt(project)
  const tab = (shown: boolean, pathname: string, label: string) => (
    <Link
      to={{ pathname, search }}
      aria-current={shown ? 'page' : undefined}
      className={`${TAB} ${shown ? SHOWN : 'font-medium text-muted'}`}
    >
      {label}
    </Link>
  )
  return (
    <div className={`${BAR} gap-3.5 pr-2 pl-11`}>
      {tab(!files, projectHref(project), t('workbench.sessions'))}
      {/* What the old frame left open may be a file; here a file is a tab, so its directory. */}
      {tab(
        files,
        at ? projectFilesHref(at.root, dirOf(at.rel)) : projectFilesHref(project),
        t('workbench.files'),
      )}
    </div>
  )
}

export function ListColumn() {
  const { pathname } = useLocation()
  const key = rootKeyOf(pathname)
  const files = filesOf(pathname)
  if (!key) return <div className={BAR} />
  const project = parseRootKey(key).project
  return (
    <>
      <ListHead project={project} files={files !== undefined} />
      {files ? (
        <Suspense>
          {/* At a file's address, about to become its tab, the tree is at its directory. */}
          <FilesPanel key={project} rootKey={key} at={dirOf(files['*'] ?? '')} />
        </Suspense>
      ) : null}
    </>
  )
}
