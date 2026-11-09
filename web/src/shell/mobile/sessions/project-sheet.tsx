// Whose sessions are listed on a phone: the project beside the search, and a sheet from the bottom to
// find another, by machine. Those of a machine offline cannot be read, so cannot be picked.

import { Dialog } from '@base-ui/react/dialog'
import { Check, ChevronDown } from 'lucide-react'
import { useRef, useState } from 'react'
import { useI18n } from '../../../core/i18n'
import { Marked } from '../../../features/session/session-row'
import type { Project } from '../../../model/projects'
import { SearchField } from '../files/search'

type Props = { projects: Project[]; current: Project; onPick: (project: Project) => void }

export function ProjectSheet({ projects, current, onPick }: Props) {
  const t = useI18n()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const sheet = useRef<HTMLDivElement>(null)
  const needle = query.trim().toLowerCase()
  const found = projects
    .filter(p => [p.name, p.display].some(text => text.toLowerCase().includes(needle)))
    .sort((a, b) => Number(b.online) - Number(a.online))
  const mids = [...new Set(found.map(p => p.mid))]

  const toggle = (next: boolean) => {
    setOpen(next)
    if (next) setQuery('')
  }
  const choose = (project: Project) => {
    setOpen(false)
    if (project.key !== current.key) onPick(project)
  }

  return (
    <Dialog.Root open={open} onOpenChange={toggle}>
      <Dialog.Trigger
        aria-label={t('mobile.switchProject')}
        className="flex h-11 max-w-[136px] min-w-0 flex-none cursor-pointer items-center gap-1 rounded-[10px] border border-line-strong bg-raised pr-2 pl-[11px]"
      >
        <b className="min-w-0 truncate text-sm font-semibold">{current.name}</b>
        <ChevronDown size={16} className="flex-none text-muted" />
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-40 bg-scrim" />
        {/* As the sheet of worktrees: of a set height, and given the focus itself. */}
        <Dialog.Popup
          ref={sheet}
          initialFocus={sheet}
          className="fixed inset-x-0 bottom-0 z-50 flex h-[70dvh] flex-col rounded-t-2xl bg-raised px-2 pb-[env(safe-area-inset-bottom)] outline-none"
        >
          <div className="mx-auto mt-2 mb-2.5 h-1 w-9 flex-none rounded-sm bg-line-strong" />
          <Dialog.Title className="sr-only">{t('mobile.switchProject')}</Dialog.Title>
          <div className="flex flex-none px-0.5 pb-1">
            <SearchField value={query} onChange={setQuery} placeholder={t('mobile.findProject')} />
          </div>
          <div className="min-h-0 flex-1 overflow-auto">
            {mids.map(mid => {
              const here = found.filter(p => p.mid === mid)
              return (
                <section key={mid}>
                  <h3 className="m-0 flex items-center gap-[7px] px-2.5 pt-3 pb-[5px] text-[12.5px] font-normal text-faint">
                    <span
                      className={`size-[7px] rounded-full ${here[0]?.online ? 'bg-ok' : 'bg-line-strong'}`}
                    />
                    {here[0]?.machine}
                  </h3>
                  {here.map(p => (
                    <button
                      key={p.key}
                      type="button"
                      disabled={!p.online}
                      onClick={() => choose(p)}
                      className="flex min-h-14 w-full cursor-pointer items-center gap-2.5 border-0 bg-transparent px-2.5 py-[7px] text-left disabled:cursor-default disabled:opacity-50"
                    >
                      <span className="flex min-w-0 flex-1 flex-col">
                        <span className="truncate text-[15px] leading-[1.3] font-medium">
                          <Marked text={p.name} needle={needle} />
                        </span>
                        <span className="truncate font-mono text-[11.5px] text-faint">{p.display}</span>
                      </span>
                      <span className="w-[18px] flex-none text-accent">
                        {p.key === current.key ? <Check size={18} /> : null}
                      </span>
                    </button>
                  ))}
                </section>
              )
            })}
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
