// Where to go next, under ⌘K: the next agent that needs you, and those that do; typed into, every
// agent on the machines online, by its name, its task or its project. Choosing one looks at it, as
// the right column does.

import { Autocomplete } from '@base-ui/react/autocomplete'
import { Dialog } from '@base-ui/react/dialog'
import { useState } from 'react'
import { useI18n } from '../../core/i18n'
import { useProjects } from '../../core/space'
import { lanes, nextNeeding, type Placed, placedKey, placedTitle } from '../../model/projects'
import { sessionTabId, tabOf } from '../../model/tabs'
import { useCommandKey } from '../../utils/command-key'
import { opensInTerminal, usePeek } from './peek'
import { isTab } from './tab-kinds'

type Group = { label: string; items: Placed[] }

const ITEM =
  'flex h-9 cursor-pointer items-center gap-2 rounded-md px-2.5 text-[13.5px] text-text outline-none select-none data-highlighted:bg-selected'

const textOf = (p: Placed) => `${p.session.name} ${placedTitle(p)} ${p.project.name}`

function Line({ placed }: { placed: Placed }) {
  const t = useI18n()
  const { session, project } = placed
  return (
    <>
      <span className="min-w-0 truncate font-medium">{placedTitle(placed)}</span>
      <span className="flex-none text-xs text-muted">{t(`status.${session.status}`)}</span>
      <span className="max-w-[40%] flex-none truncate text-xs text-faint">
        {project.configured ? project.name : project.display}
      </span>
    </>
  )
}

function Choices({ onClose }: { onClose: () => void }) {
  const t = useI18n()
  const [query, setQuery] = useState('')
  const all = lanes(useProjects())
  const { peek, search, open } = usePeek()
  const needing = [...all.asking, ...all.finished]
  const shown = tabOf(search, isTab)
  const at = peek ?? needing.find(p => sessionTabId(p.session.mid, p.session.paneId) === shown)?.session
  const next = nextNeeding(all, at)
  const elsewhere = next && !(next.session.mid === at?.mid && next.session.paneId === at?.paneId)
  const groups: Group[] = query
    ? [{ label: t('palette.agents'), items: [...needing, ...all.running, ...all.standing] }]
    : [
        ...(elsewhere ? [{ label: t('palette.next'), items: [next] }] : []),
        ...(needing.length ? [{ label: t('palette.needs'), items: needing }] : []),
      ]
  const go = (placed: Placed) => {
    onClose()
    open(placed, opensInTerminal(placed.session))
  }

  return (
    <Autocomplete.Root
      inline
      open
      onOpenChange={stays => stays || onClose()}
      items={groups}
      value={query}
      onValueChange={setQuery}
      itemToStringValue={textOf}
      autoHighlight="always"
    >
      <Autocomplete.Input
        placeholder={t('palette.placeholder')}
        className="h-12 flex-none border-0 border-b border-line bg-transparent px-4 text-[15px] text-text outline-none"
      />
      <Autocomplete.Empty className="px-4 py-6 text-center text-[13px] text-faint empty:hidden">
        {t(query ? 'palette.empty' : 'palette.clear')}
      </Autocomplete.Empty>
      <Autocomplete.List className="min-h-0 overflow-auto p-1.5 empty:hidden">
        {(group: Group) => (
          <Autocomplete.Group key={group.label} items={group.items} className="flex flex-col pb-1">
            <Autocomplete.GroupLabel className="px-2.5 pt-2 pb-1 text-[11px] font-semibold tracking-[0.04em] text-faint uppercase">
              {group.label}
            </Autocomplete.GroupLabel>
            <Autocomplete.Collection>
              {(placed: Placed) => (
                <Autocomplete.Item
                  key={placedKey(placed)}
                  value={placed}
                  onClick={() => go(placed)}
                  className={ITEM}
                >
                  <Line placed={placed} />
                </Autocomplete.Item>
              )}
            </Autocomplete.Collection>
          </Autocomplete.Group>
        )}
      </Autocomplete.List>
    </Autocomplete.Root>
  )
}

export function CommandPalette() {
  const t = useI18n()
  const [open, setOpen] = useState(false)
  useCommandKey(() => setOpen(was => !was))
  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-40 bg-scrim" />
        <Dialog.Popup className="fixed top-[14vh] left-1/2 z-50 flex max-h-[70vh] w-[min(560px,calc(100vw-32px))] -translate-x-1/2 flex-col overflow-hidden rounded-xl border border-line bg-raised shadow-lg outline-none">
          <Dialog.Title className="sr-only">{t('palette.title')}</Dialog.Title>
          <Choices onClose={() => setOpen(false)} />
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
