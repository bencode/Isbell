// Where to go next, under ⌘K: the next agent that needs you, those that do, a new task, the projects;
// typed into, every agent and project by name. Only going places and starting work, nothing else.

import { Autocomplete } from '@base-ui/react/autocomplete'
import { Dialog } from '@base-ui/react/dialog'
import { useState } from 'react'
import { useNavigate } from 'react-router'
import { useI18n } from '../../core/i18n'
import { lanes, nextNeeding, type Placed, type Project } from '../../model/projects'
import { boardHref, peekHref } from '../../utils/hrefs'

type Command =
  | { kind: 'next'; placed: Placed }
  | { kind: 'agent'; placed: Placed }
  | { kind: 'new' }
  /** undefined: every agent's board. */
  | { kind: 'board'; project: Project | undefined }

type Group = { label: string; items: Command[] }

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  projects: Project[]
  /** The project whose board this is (undefined: every agent's), which the agents it offers keep to. */
  scope: Project | undefined
  /** The session open beside the board, if any. */
  at: { mid: string; paneId: string } | undefined
  onNew: () => void
}

const ITEM =
  'flex h-9 cursor-pointer items-center gap-2 rounded-md px-2.5 text-[13.5px] text-text outline-none select-none data-highlighted:bg-accent-soft'

export function CommandPalette({ open, onOpenChange, projects, scope, at, onNew }: Props) {
  const t = useI18n()
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const all = lanes(projects)
  const here = scope ? lanes([scope]) : all
  const next = nextNeeding(here, at)
  const agent = (placed: Placed): Command => ({ kind: 'agent', placed })
  const boards: Command[] = [undefined, ...projects].map(project => ({ kind: 'board', project }))
  const groups: Group[] = query
    ? [
        {
          label: t('palette.agents'),
          items: [...all.asking, ...all.finished, ...all.running, ...all.standing, ...all.offline].map(agent),
        },
        { label: t('palette.projects'), items: boards },
      ]
    : [
        ...(next ? [{ label: t('palette.next'), items: [{ kind: 'next', placed: next } as const] }] : []),
        { label: t('palette.needs'), items: [...here.asking, ...here.finished].map(agent) },
        { label: t('project.newTask'), items: [{ kind: 'new' } as const] },
        { label: t('palette.projects'), items: boards },
      ]

  const close = (open: boolean) => {
    onOpenChange(open)
    if (!open) setQuery('')
  }
  const run = (c: Command) => {
    close(false)
    if (c.kind === 'new') return onNew()
    if (c.kind === 'board') return navigate(boardHref(c.project?.key))
    const { session, project } = c.placed
    // On every agent's board a session opens beside it; on a project's, beside its own project's.
    navigate(peekHref(scope ? project.key : undefined, session.mid, session.paneId))
  }
  const textOf = (c: Command) =>
    c.kind === 'new'
      ? t('project.newTask')
      : c.kind === 'board'
        ? (c.project?.name ?? t('side.all'))
        : `${c.placed.session.name} ${c.placed.project.name}`

  return (
    <Dialog.Root open={open} onOpenChange={close}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-40 bg-scrim" />
        <Dialog.Popup className="fixed top-[14vh] left-1/2 z-50 flex max-h-[70vh] w-[min(560px,calc(100vw-32px))] -translate-x-1/2 flex-col overflow-hidden rounded-lg border border-line bg-raised index-card-lifted outline-none">
          <Dialog.Title className="sr-only">{t('palette.title')}</Dialog.Title>
          <Autocomplete.Root
            inline
            open={open}
            onOpenChange={close}
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
              {t('palette.empty')}
            </Autocomplete.Empty>
            <Autocomplete.List className="min-h-0 overflow-auto p-1.5 empty:hidden">
              {(group: Group) => (
                <Autocomplete.Group key={group.label} items={group.items} className="flex flex-col pb-1">
                  <Autocomplete.GroupLabel className="px-2.5 pt-2 pb-1 text-[11px] font-semibold tracking-[0.04em] text-faint uppercase">
                    {group.label}
                  </Autocomplete.GroupLabel>
                  <Autocomplete.Collection>
                    {(c: Command) => (
                      <Autocomplete.Item key={keyOf(c)} value={c} onClick={() => run(c)} className={ITEM}>
                        <Line command={c} />
                      </Autocomplete.Item>
                    )}
                  </Autocomplete.Collection>
                </Autocomplete.Group>
              )}
            </Autocomplete.List>
          </Autocomplete.Root>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

const keyOf = (c: Command) =>
  c.kind === 'new'
    ? 'new'
    : c.kind === 'board'
      ? `board:${c.project?.key ?? ''}`
      : `${c.kind}:${c.placed.session.mid}/${c.placed.session.paneId}`

/** An agent with its state and project; a project with its machine. */
function Line({ command: c }: { command: Command }) {
  const t = useI18n()
  if (c.kind === 'new') return <span className="font-medium">{t('project.newTask')}</span>
  if (c.kind === 'board')
    return (
      <>
        <span className="truncate font-medium">{c.project?.name ?? t('side.all')}</span>
        {c.project ? <span className="truncate text-xs text-faint">{c.project.machine}</span> : null}
      </>
    )
  const { session, project } = c.placed
  return (
    <>
      <span className="truncate font-medium">{session.name}</span>
      <span className="flex-none text-xs text-muted">{t(`status.${session.status}`)}</span>
      <span className="truncate text-xs text-faint">{project.name}</span>
    </>
  )
}
