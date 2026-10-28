import { JoinCommands } from '../../components/join-commands'
import { uiLabels, useI18n } from '../../core/i18n'
import { useLocal } from '../../core/prefs'
import { useProjects, useSpaceView } from '../../core/space'
import { lanes } from '../../model/projects'
import { useNow } from '../../utils/time'
import { Lanes } from './lanes'

/** Every agent on one board, by what it is doing; `stacked` lays the lanes one under another. */
export function AllAgents({ stacked = false }: { stacked?: boolean }) {
  const t = useI18n()
  const view = useSpaceView()
  const projects = useProjects()
  const now = useNow()

  if (!view.loaded) return <p className="m-0 text-muted">{t('board.loading')}</p>
  if (!view.machines.length) return <NoMachines />

  const online = view.machines.filter(m => m.online).length
  const agents = projects.reduce((n, p) => n + p.sessions.length, 0)
  return (
    <>
      <div className="flex flex-wrap items-baseline gap-3">
        <h1 className="m-0 text-[23px] font-bold after:mt-1 after:block after:h-[3px] after:w-7 after:rounded-sm after:bg-accent after:content-['']">
          {t('all.title')}
        </h1>
        <span className="text-muted">
          {t('all.summary', { projects: projects.length, machines: view.machines.length, online, agents })}
        </span>
      </div>
      {agents ? (
        <Lanes lanes={lanes(projects)} now={now} stacked={stacked} />
      ) : (
        <p className="m-0 text-muted">{t('all.empty')}</p>
      )}
    </>
  )
}

/** No machine in the space yet: how to add one. */
export function NoMachines() {
  const t = useI18n()
  const { key } = useLocal()
  return (
    <div className="m-auto flex w-[min(620px,100%)] flex-col gap-3">
      <h1 className="m-0 text-xl font-semibold">{t('empty.title')}</h1>
      <p className="m-0 text-muted">{t('empty.body')}</p>
      {key ? <JoinCommands spaceKey={key} labels={uiLabels(t)} /> : null}
    </div>
  )
}
