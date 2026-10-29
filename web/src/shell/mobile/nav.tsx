// The phone's drawer: the sidebar's projects by the machine they are on, in rows a finger can hit.
// The agents themselves are on the boards; a link closes the drawer as it goes.

import { LayoutGrid, Plus, Settings2, SquareTerminal } from 'lucide-react'
import { Link } from 'react-router'
import { useI18n } from '../../core/i18n'
import type { ConnStatus } from '../../model/connection'
import { needs, type Project } from '../../model/projects'
import type { MachineEntry } from '../../model/space'
import type { Here } from '../common'
import { MachineGroups } from '../machine-groups'
import { AskBadge, RelayStatus } from '../marks'

type Props = {
  projects: Project[]
  machines: MachineEntry[]
  status: ConnStatus
  here: Here
  /** Starts a session in a new directory. */
  onNewDir: () => void
  onSettings: () => void
  /** A link was followed. */
  onGo: () => void
}

const ROW =
  'flex min-h-11 items-center gap-2.5 rounded-lg px-2.5 text-text no-underline active:bg-raised focus-visible:outline-2 focus-visible:outline-accent'

export function MobileNav({ projects, machines, status, here, onNewDir, onSettings, onGo }: Props) {
  const t = useI18n()
  const total = needs(projects).length
  return (
    <>
      <div className="flex flex-none items-center gap-2 px-4 pt-4 pb-2">
        <SquareTerminal size={20} className="text-accent" aria-hidden="true" />
        <span className="text-base font-bold">Isbell</span>
      </div>
      <div className="min-h-0 flex-1 overflow-auto px-2 pb-2">
        <Link to="/" onClick={onGo} className={`${ROW} ${here.project || here.pane ? '' : 'bg-accent-soft'}`}>
          <LayoutGrid size={17} className="text-muted" />
          <span className="flex-1 font-medium">{t('side.all')}</span>
          {total ? <AskBadge n={total} label={t('needs.title')} /> : null}
        </Link>
        <div className="flex items-center justify-between pt-3 pr-0.5 pl-2.5">
          <span className="text-[11px] font-semibold tracking-[0.04em] text-faint uppercase">
            {t('side.projects')}
          </span>
          <button
            type="button"
            onClick={onNewDir}
            aria-label={t('side.add')}
            className="inline-flex size-10 cursor-pointer items-center justify-center rounded-lg border-0 bg-transparent text-muted active:bg-raised focus-visible:outline-2 focus-visible:outline-accent"
          >
            <Plus size={18} />
          </button>
        </div>
        <MachineGroups projects={projects} machines={machines} here={here} touch onGo={onGo} />
      </div>
      <div className="flex flex-none flex-col gap-0.5 border-t border-line p-2">
        <RelayStatus status={status} />
        <button
          type="button"
          onClick={onSettings}
          className={`${ROW} min-h-10! cursor-pointer border-0 bg-transparent text-left text-sm`}
        >
          <Settings2 size={16} className="text-muted" />
          {t('side.settings')}
        </button>
      </div>
    </>
  )
}
