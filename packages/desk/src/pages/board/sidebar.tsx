import { type MachineEntry, needs, type Project } from '@isbell/core'
import { Plus } from 'lucide-react'
import { Link } from 'react-router'
import { useT } from '../../i18n'
import { projectHref } from '../../routes'
import { useOpen } from './layout'

const ITEM =
  'flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-text no-underline hover:bg-raised'

function Badge({ project }: { project: Project }) {
  const t = useT()
  const asking = project.sessions.filter(s => s.status === 'blocked').length
  if (asking)
    return (
      <span
        className="inline-flex size-5 flex-none items-center justify-center rounded-full bg-warn text-[11px] font-bold text-accent-ink"
        title={t('side.asking', { n: asking })}
      >
        {asking}
        <span className="sr-only">{t('side.asking', { n: asking })}</span>
      </span>
    )
  return project.sessions.length ? (
    <span className="flex-none text-xs text-faint">{project.sessions.length}</span>
  ) : null
}

function NumberKey({ n }: { n: number }) {
  return (
    <span className="inline-flex h-[18px] min-w-[18px] flex-none items-center justify-center rounded border border-line font-mono text-[11px] text-faint">
      {n}
    </span>
  )
}

export function Sidebar({
  projects,
  focused,
  machines,
}: {
  projects: Project[]
  focused: Project | undefined
  machines: MachineEntry[]
}) {
  const t = useT()
  const open = useOpen()
  const total = needs(projects).length
  return (
    <nav
      aria-label={t('side.projects')}
      className="flex w-[232px] flex-none flex-col gap-0.5 overflow-auto border-r border-line p-3"
    >
      <Link to="/" className={`${ITEM} ${focused ? '' : 'bg-raised-2'}`}>
        <span className="flex-1 font-semibold">{t('side.all')}</span>
        {total ? (
          <span className="inline-flex size-5 items-center justify-center rounded-full bg-warn text-[11px] font-bold text-accent-ink">
            {total}
          </span>
        ) : null}
        <NumberKey n={0} />
      </Link>
      <div className="mt-3 flex items-center justify-between pr-1 pl-2.5">
        <span className="text-xs font-semibold text-faint">{t('side.projects')}</span>
        <button
          type="button"
          onClick={() => open('add')}
          aria-label={t('side.add')}
          title={`${t('side.add')} (a)`}
          className="inline-flex size-[26px] cursor-pointer items-center justify-center rounded-md border-0 bg-transparent text-muted hover:bg-raised-2 hover:text-text"
        >
          <Plus size={15} />
        </button>
      </div>
      {projects.map((p, i) => (
        <Link
          key={p.key}
          to={projectHref(p.key)}
          className={`${ITEM} ${focused?.key === p.key ? 'bg-raised-2' : ''}`}
        >
          <span className="flex min-w-0 flex-1 flex-col">
            <span className={`truncate font-semibold ${p.sessions.length ? '' : 'text-muted'}`}>
              {p.name}
            </span>
            <span className="truncate text-xs text-faint">
              {p.machine}
              {p.online ? '' : ` · ${t('side.offline')}`}
            </span>
          </span>
          <Badge project={p} />
          {i < 9 ? <NumberKey n={i + 1} /> : null}
        </Link>
      ))}
      <div className="mt-auto flex flex-col gap-0.5 pt-4">
        <span className="px-2.5 pb-1 text-xs font-semibold text-faint">{t('side.machines')}</span>
        {machines.map(({ state, online }) => {
          const herdr = state.herdr.status
          const note = !online ? t('side.offline') : herdr === 'ready' ? '' : t(`side.herdr.${herdr}`)
          return (
            <span key={state.machine.id} className="flex items-center gap-2.5 px-2.5 py-1">
              <span
                className={`size-2 flex-none rounded-full ${!online ? 'border-[1.5px] border-faint' : herdr === 'ready' ? 'bg-ok' : 'bg-warn'}`}
              />
              <span className="flex min-w-0 flex-col">
                <span className="truncate font-medium">{state.machine.name}</span>
                {note ? <span className="text-xs text-faint">{note}</span> : null}
              </span>
            </span>
          )
        })}
      </div>
    </nav>
  )
}
