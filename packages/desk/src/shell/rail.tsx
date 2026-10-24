// The sidebar folded to a rail of icons: projects by their initial, no sessions. Each icon is
// named for screen readers by hidden text beside it, so a badge is still read with its name.

import { needs } from '@isbell/core'
import { ChevronsRight, LayoutGrid, Plus, Search, Settings2, SquareTerminal } from 'lucide-react'
import { Link } from 'react-router'
import { useI18n } from '../core/i18n'
import { toggleRail } from '../core/prefs'
import { projectHref } from '../utils/hrefs'
import { AskBadge, asking, RelayStatus, type SideProps } from './sidebar'

const ITEM =
  'relative inline-flex size-9 flex-none cursor-pointer items-center justify-center rounded-md border-0 bg-transparent text-muted no-underline hover:bg-raised hover:text-text focus-visible:outline-2 focus-visible:outline-accent disabled:cursor-default disabled:opacity-60 disabled:hover:bg-transparent'
// Important, to win over the transparent background ITEM gives buttons.
const ON = 'bg-accent-soft! text-text'
const CORNER = 'absolute -top-1 -right-1.5 h-4 min-w-4 text-[10px]'

export function Rail({ projects, status, here, onNew, onSettings }: SideProps) {
  const t = useI18n()
  const total = needs(projects).length
  return (
    <nav
      aria-label={t('side.projects')}
      className="flex w-14 flex-none flex-col items-center gap-1 border-r border-line bg-side py-2.5"
    >
      <span className="inline-flex size-9 items-center justify-center" title="Isbell">
        <SquareTerminal size={20} className="text-accent" aria-hidden="true" />
      </span>
      <button type="button" onClick={onNew} title={t('app.newSession')} className={`${ITEM} text-accent!`}>
        <Plus size={18} />
        <span className="sr-only">{t('app.newSession')}</span>
      </button>
      <button type="button" disabled title={t('side.searchSoon')} className={ITEM}>
        <Search size={17} />
        <span className="sr-only">{t('side.search')}</span>
      </button>
      <hr className="my-1.5 w-6 border-0 border-t border-line" />
      <Link to="/" title={t('side.all')} className={`${ITEM} ${here.project || here.pane ? '' : ON}`}>
        <LayoutGrid size={17} />
        <span className="sr-only">{t('side.all')}</span>
        {total ? <AskBadge n={total} label={t('needs.title')} className={CORNER} /> : null}
      </Link>
      <div className="flex min-h-0 flex-1 flex-col items-center gap-1 overflow-auto pt-1">
        {projects.map(p => {
          const label = `${p.name} · ${p.machine}`
          const n = asking(p)
          return (
            <Link
              key={p.key}
              to={projectHref(p.key)}
              title={label}
              className={`${ITEM} text-[13px] font-bold ${here.project?.key === p.key ? ON : ''}`}
            >
              <span aria-hidden="true">{p.name.slice(0, 1).toUpperCase()}</span>
              <span className="sr-only">{label}</span>
              {n ? <AskBadge n={n} label={t('side.asking', { n })} className={CORNER} /> : null}
            </Link>
          )
        })}
      </div>
      <RelayStatus status={status} compact />
      <button type="button" onClick={onSettings} title={t('side.settings')} className={ITEM}>
        <Settings2 size={17} />
        <span className="sr-only">{t('side.settings')}</span>
      </button>
      <button type="button" onClick={toggleRail} title={t('side.expand')} className={ITEM}>
        <ChevronsRight size={17} />
        <span className="sr-only">{t('side.expand')}</span>
      </button>
    </nav>
  )
}
