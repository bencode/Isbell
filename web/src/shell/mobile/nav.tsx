// The phone's drawer: what the computer's sidebar holds, in rows a finger can hit. Every project is
// shown open; a link closes the drawer as it goes.

import { LayoutGrid, Plus, Settings2, SquareTerminal } from 'lucide-react'
import { Link } from 'react-router'
import { Button } from '../../components/button'
import { useI18n } from '../../core/i18n'
import { useLocal } from '../../core/prefs'
import type { ConnStatus } from '../../model/connection'
import { needs, type Project, paneKey } from '../../model/projects'
import type { MachineEntry } from '../../model/space'
import { projectHref, sessionHref, terminalHref } from '../../utils/hrefs'
import { since, useNow } from '../../utils/time'
import type { Here } from '../common'
import { AskBadge, asking, MachineList, RelayStatus, StatusDot } from '../marks'

type Props = {
  projects: Project[]
  machines: MachineEntry[]
  status: ConnStatus
  here: Here
  onNew: () => void
  onSettings: () => void
  /** A link was followed. */
  onGo: () => void
}

const ROW =
  'flex min-h-11 items-center gap-2.5 rounded-lg px-2.5 text-text no-underline active:bg-raised focus-visible:outline-2 focus-visible:outline-accent'
const PANE = `${ROW} min-h-10! pl-8 text-sm`
// The row the page is on.
const ON = 'bg-accent-soft'
const LABEL = 'm-0 px-2.5 pt-3.5 pb-1 text-[11px] font-semibold tracking-[0.04em] text-faint uppercase'

export function MobileNav({ projects, machines, status, here, onNew, onSettings, onGo }: Props) {
  const t = useI18n()
  const total = needs(projects).length
  return (
    <>
      <div className="flex flex-none items-center gap-2 px-4 pt-3 pb-2">
        <SquareTerminal size={20} className="text-accent" aria-hidden="true" />
        <span className="flex-1 text-base font-bold">Isbell</span>
        <Button variant="primary" onClick={onNew}>
          <Plus size={15} />
          {t('app.newSession')}
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto px-2 pb-2">
        <Link to="/" onClick={onGo} className={`${ROW} ${here.project || here.pane ? '' : ON}`}>
          <LayoutGrid size={17} className="text-muted" />
          <span className="flex-1 font-medium">{t('side.all')}</span>
          {total ? <AskBadge n={total} label={t('needs.title')} /> : null}
        </Link>
        <p className={LABEL}>{t('side.projects')}</p>
        {projects.map(p => (
          <ProjectRows key={p.key} project={p} here={here} onGo={onGo} />
        ))}
      </div>
      <div className="flex flex-none flex-col gap-0.5 border-t border-line p-2">
        <p className={`${LABEL} pt-1`}>{t('side.machines')}</p>
        <MachineList machines={machines} />
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

/** A project, then its sessions, then its shells. */
function ProjectRows({ project: p, here, onGo }: { project: Project; here: Here; onGo: () => void }) {
  const t = useI18n()
  const now = useNow()
  const { terminal } = useLocal().layout
  const n = asking(p)
  return (
    <>
      <Link
        to={projectHref(p.key)}
        onClick={onGo}
        className={`${ROW} ${here.project?.key === p.key && !here.pane ? ON : ''}`}
      >
        <span className="min-w-0 flex-1 truncate">
          <span className="font-semibold">{p.name}</span>{' '}
          <span className="text-xs text-faint">
            {p.machine}
            {p.online ? '' : ` · ${t('side.offline')}`}
          </span>
        </span>
        {n ? <AskBadge n={n} label={t('side.asking', { n })} /> : null}
      </Link>
      {p.sessions.map(s => {
        const key = paneKey(s.mid, s.paneId)
        // Each session opens in the view it was last seen in, as in the sidebar.
        const href = (terminal.includes(key) ? terminalHref : sessionHref)(s.mid, s.paneId)
        return (
          <Link key={s.paneId} to={href} onClick={onGo} className={`${PANE} ${here.pane === key ? ON : ''}`}>
            <StatusDot status={s.status} label={t(`status.${s.status}`)} />
            <span className={`min-w-0 flex-1 truncate ${s.unread ? 'font-semibold' : ''}`}>{s.name}</span>
            <span className="text-xs text-faint">{since(s.statusSince, now)}</span>
          </Link>
        )
      })}
      {p.shells.map(s => (
        <Link
          key={s.paneId}
          to={terminalHref(s.mid, s.paneId)}
          onClick={onGo}
          title={s.title}
          className={`${PANE} ${here.pane === paneKey(s.mid, s.paneId) ? ON : ''}`}
        >
          <SquareTerminal size={14} className="flex-none text-faint" />
          <span className="min-w-0 flex-1 truncate font-mono text-xs">{s.paneId}</span>
          <span className="text-xs text-faint">{t('side.shell')}</span>
        </Link>
      ))}
    </>
  )
}
