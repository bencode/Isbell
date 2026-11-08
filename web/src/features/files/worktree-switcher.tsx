// Which of a project's worktrees its files are browsed in: the branch and directory above the tree,
// and a panel to find another by either, listed afresh each time it opens.

import { Autocomplete } from '@base-ui/react/autocomplete'
import { Popover } from '@base-ui/react/popover'
import { Check, ChevronsUpDown, GitBranch, RotateCw, Search } from 'lucide-react'
import { useState } from 'react'
import { useNavigate } from 'react-router'
import { useI18n } from '../../core/i18n'
import { useSpace } from '../../core/space'
import { refreshWorktrees } from '../../core/worktrees'
import { type FilesRoot, matchRoots } from '../../model/files/worktrees'
import type { Project } from '../../model/projects'
import { projectFilesHref } from '../../utils/hrefs'
import { Hits } from './search'

const OPTION =
  'flex cursor-pointer items-center gap-2 rounded-md px-2 py-1 outline-none select-none data-highlighted:bg-raised-2'

type Props = {
  project: Project
  /** The project's own directory, then its other worktrees. */
  roots: FilesRoot[]
  /** The one browsed. */
  root: FilesRoot
}

export function WorktreeSwitcher({ project, roots, root }: Props) {
  const t = useI18n()
  const { call } = useSpace()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [refreshing, setRefreshing] = useState(false)
  const found = matchRoots(roots, query)
  const branchOf = (at: FilesRoot) => at.branch ?? t('files.detached')

  const toggle = (next: boolean) => {
    setOpen(next)
    if (!next) return
    setQuery('')
    setRefreshing(true)
    refreshWorktrees(call, project).finally(() => setRefreshing(false))
  }
  const choose = (at: FilesRoot) => {
    setOpen(false)
    if (at.key !== root.key) navigate(projectFilesHref(at.key))
  }

  return (
    <Popover.Root open={open} onOpenChange={toggle}>
      <Popover.Trigger className="flex w-full min-w-0 cursor-pointer items-center gap-2 rounded-md border border-line bg-raised h-[30px] px-2 text-left hover:border-line-strong hover:bg-raised-2 focus-visible:outline-2 focus-visible:outline-accent data-popup-open:border-accent data-popup-open:bg-raised-2">
        <GitBranch size={14} className="flex-none text-muted" />
        <span title={branchOf(root)} className="min-w-0 max-w-[60%] truncate text-[13px] font-semibold">
          {branchOf(root)}
        </span>
        <span className="flex min-w-0 flex-1 justify-end">
          <CutPath path={root.display} />
        </span>
        <ChevronsUpDown size={13} className="flex-none text-muted" />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner sideOffset={6} align="start" className="z-50 outline-none">
          <Popover.Popup
            aria-label={t('files.switchWorktree')}
            className="flex max-h-[min(520px,var(--available-height))] w-[480px] flex-col overflow-hidden rounded-lg border border-line-strong bg-raised index-card-lifted outline-none"
          >
            <Autocomplete.Root
              inline
              open={open}
              onOpenChange={next => {
                if (!next) setOpen(false)
              }}
              items={found}
              filter={null}
              value={query}
              onValueChange={setQuery}
              itemToStringValue={branchOf}
              autoHighlight="always"
            >
              <div className="flex-none border-b border-line p-2">
                <div className="flex h-[30px] items-center gap-1.5 rounded-md border border-line bg-bg px-2 focus-within:border-accent">
                  <Search size={13} className="flex-none text-faint" />
                  <Autocomplete.Input
                    placeholder={t('files.findWorktree')}
                    aria-label={t('files.findWorktree')}
                    className="min-w-0 flex-1 border-0 bg-transparent text-[13px] text-text outline-none"
                  />
                  {refreshing ? <RotateCw size={13} className="flex-none animate-spin text-faint" /> : null}
                </div>
              </div>
              <Autocomplete.Empty className="px-3 py-2 text-[12.5px] text-faint empty:hidden">
                {t('files.noWorktree')}
              </Autocomplete.Empty>
              <Autocomplete.List className="min-h-0 flex-1 overflow-auto p-1 empty:hidden">
                {(at: FilesRoot) => (
                  <Autocomplete.Item key={at.key} value={at} onClick={() => choose(at)} className={OPTION}>
                    <GitBranch size={15} className="flex-none text-muted" />
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className={`truncate text-[13px] ${at.key === root.key ? 'font-semibold' : ''}`}>
                        <Hits text={branchOf(at)} query={query.trim()} />
                      </span>
                      <CutPath path={at.display} query={query.trim()} />
                    </span>
                    {at.own ? (
                      <span className="flex-none rounded-[3px] border border-line px-1.5 text-[10.5px] text-faint">
                        {t('files.here')}
                      </span>
                    ) : null}
                    <span className="w-[15px] flex-none text-accent">
                      {at.key === root.key ? <Check size={15} /> : null}
                    </span>
                  </Autocomplete.Item>
                )}
              </Autocomplete.List>
              <div className="flex flex-none justify-between border-t border-line px-3 py-1 text-[11.5px] text-faint">
                <span>
                  {query.trim()
                    ? `${found.length} / ${roots.length}`
                    : t('files.worktreeCount', { n: roots.length })}
                </span>
                <span>{t('files.worktreeKeys')}</span>
              </div>
            </Autocomplete.Root>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  )
}

/** A path cut at its start when too long: its end is what tells worktrees apart. */
function CutPath({ path, query = '' }: { path: string; query?: string }) {
  return (
    <span title={path} className="truncate text-left font-mono text-[11.5px] text-faint [direction:rtl]">
      <bdi>
        <Hits text={path} query={query} />
      </bdi>
    </span>
  )
}
