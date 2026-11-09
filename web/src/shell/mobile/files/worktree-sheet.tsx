// Which of a project's worktrees its files are browsed in, on a phone: the branch beside the search,
// and a sheet from the bottom to find another by branch or directory, listed afresh each time.

import { Dialog } from '@base-ui/react/dialog'
import { Check, ChevronsUpDown, GitBranch } from 'lucide-react'
import { useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { useI18n } from '../../../core/i18n'
import { useSpace } from '../../../core/space'
import { refreshWorktrees } from '../../../core/worktrees'
import { Hits } from '../../../features/files/search'
import { CutPath } from '../../../features/files/worktree-switcher'
import { type FilesRoot, matchRoots } from '../../../model/files/worktrees'
import type { Project } from '../../../model/projects'
import { projectFilesHref } from '../../../utils/hrefs'
import { SearchField } from './search'

type Props = { project: Project; roots: FilesRoot[]; root: FilesRoot }

export function WorktreeSheet({ project, roots, root }: Props) {
  const t = useI18n()
  const { call } = useSpace()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const sheet = useRef<HTMLDivElement>(null)
  const found = matchRoots(roots, query)
  const branchOf = (at: FilesRoot) => at.branch ?? t('files.detached')

  const toggle = (next: boolean) => {
    setOpen(next)
    if (!next) return
    setQuery('')
    void refreshWorktrees(call, project)
  }
  const choose = (at: FilesRoot) => {
    setOpen(false)
    // In place, so that back still leaves the files.
    if (at.key !== root.key) void navigate(projectFilesHref(at.key), { replace: true })
  }

  return (
    <Dialog.Root open={open} onOpenChange={toggle}>
      <Dialog.Trigger
        aria-label={t('files.switchWorktree')}
        className="flex h-11 max-w-[56%] min-w-0 flex-none cursor-pointer items-center gap-2 rounded-[10px] border border-line bg-raised px-2.5 text-text"
      >
        <GitBranch size={15} className="flex-none text-muted" />
        <b className="min-w-0 truncate text-sm font-semibold">{branchOf(root)}</b>
        <ChevronsUpDown size={15} className="flex-none text-muted" />
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-40 bg-scrim" />
        {/* Of a set height, so the box stays put as the list narrows, above where the keyboard comes
            up; given the focus itself, so the keyboard comes up only when the box is touched. */}
        <Dialog.Popup
          ref={sheet}
          initialFocus={sheet}
          className="fixed inset-x-0 bottom-0 z-50 flex h-[70dvh] flex-col rounded-t-2xl bg-raised px-2 pb-[env(safe-area-inset-bottom)] outline-none"
        >
          <div className="mx-auto mt-2 mb-1 h-1 w-9 flex-none rounded-sm bg-line-strong" />
          <Dialog.Title className="m-0 flex-none px-2.5 py-2 text-[15px] font-semibold">
            {t('files.switchWorktree')}{' '}
            <small className="ml-1 text-[12.5px] font-normal text-faint">
              {t('files.worktreeCount', { n: roots.length })}
            </small>
          </Dialog.Title>
          <div className="flex flex-none px-0.5 pb-2">
            <SearchField value={query} onChange={setQuery} placeholder={t('files.findWorktree')} />
          </div>
          <div className="min-h-0 flex-1 overflow-auto">
            {found.length ? null : (
              <p className="m-0 px-2.5 py-3 text-[13px] text-faint">{t('files.noWorktree')}</p>
            )}
            {found.map(at => (
              <button
                key={at.key}
                type="button"
                onClick={() => choose(at)}
                className="flex min-h-14 w-full cursor-pointer items-center gap-2.5 border-0 border-t border-solid border-line bg-transparent px-2.5 py-[7px] text-left text-text"
              >
                <GitBranch size={16} className="flex-none text-muted" />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-[15px] leading-[1.3] font-medium">
                    <Hits text={branchOf(at)} query={query.trim()} />
                  </span>
                  <CutPath path={at.display} query={query.trim()} />
                </span>
                {at.own ? (
                  <span className="flex-none rounded-[3px] border border-line px-1.5 text-[10.5px] text-faint">
                    {t('files.here')}
                  </span>
                ) : null}
                <span className="w-[18px] flex-none text-accent">
                  {at.key === root.key ? <Check size={18} /> : null}
                </span>
              </button>
            ))}
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
