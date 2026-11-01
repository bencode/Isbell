// A phone's project above its lanes, as a grouped list: where it is, on which machine and whether that
// is online, and its other views, the sessions recorded in it and its files.

import { ChevronRight, FolderOpen, History } from 'lucide-react'
import type { ReactNode } from 'react'
import { Link } from 'react-router'
import { useI18n } from '../../core/i18n'
import type { Project } from '../../model/projects'
import { projectFilesHref, projectSessionsHref } from '../../utils/hrefs'

const CELL = 'flex min-h-12 items-center gap-3 px-3.5 py-2'

export function ProjectFacts({ project }: { project: Project }) {
  const t = useI18n()
  return (
    <div className="flex flex-col divide-y divide-line overflow-hidden rounded-xl border border-line bg-raised">
      <div className={CELL}>
        <span className="w-14 flex-none text-[13px] text-muted">{t('facts.dir')}</span>
        <span className="min-w-0 flex-1 truncate font-mono text-[13px]">{project.display}</span>
      </div>
      <div className={CELL}>
        <span className="w-14 flex-none text-[13px] text-muted">{t('info.machine')}</span>
        <span className="flex min-w-0 flex-1 items-center gap-2">
          <span className={`size-2 flex-none rounded-full ${project.online ? 'bg-ok' : 'bg-faint'}`} />
          <span className="truncate">{project.machine}</span>
          {project.online ? null : (
            <span className="flex-none text-[13px] text-muted">{t('facts.offline')}</span>
          )}
        </span>
      </div>
      <View
        to={projectSessionsHref(project.key)}
        icon={<History size={18} />}
        label={t('project.sessions')}
      />
      <View to={projectFilesHref(project.key)} icon={<FolderOpen size={18} />} label={t('project.files')} />
    </div>
  )
}

function View({ to, icon, label }: { to: string; icon: ReactNode; label: string }) {
  return (
    <Link
      to={to}
      className={`${CELL} text-text no-underline active:bg-raised-2 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent`}
    >
      <span className="flex w-5 flex-none justify-center text-muted">{icon}</span>
      <span className="flex-1">{label}</span>
      <ChevronRight size={16} className="flex-none text-faint" />
    </Link>
  )
}
