// New's fields: chat or terminal, where (a project, or a directory that is not one yet), the agent,
// and, for a chat, the task. Side by side in a computer's panel; `stacked`, on a phone's page.

import { Plus } from 'lucide-react'
import { Segmented } from '../../components/segmented'
import { SelectBox } from '../../components/select'
import { useI18n } from '../../core/i18n'
import { onSubmitKey } from '../../utils/shortcuts'
import { NewDirField } from './new-dir'
import { type NewSessionForm, SHELL } from './use-new-session'

export function NewSessionFields({ form, stacked = false }: { form: NewSessionForm; stacked?: boolean }) {
  const t = useI18n()
  const { machine, chat } = form
  const machines = [...new Set(form.startable.map(p => p.machine))]
  const installed = machine
    ? [
        {
          label: t('ns.installed', { machine: machine.name }),
          options: form.offered.map(k => ({ value: k, label: k })),
        },
      ]
    : []
  const plain =
    machine && !chat ? [{ label: t('ns.plain'), options: [{ value: SHELL, label: t('ns.shell') }] }] : []
  return (
    <>
      {/* A block wrapper, so the switch keeps its own width in the column. */}
      <div>
        <Segmented
          value={form.mode}
          onChange={form.setMode}
          label={t('ns.mode')}
          segments={[
            { value: 'chat', label: t('ns.chat') },
            { value: 'terminal', label: t('ns.terminal') },
          ]}
        />
      </div>
      <div className={stacked ? 'flex flex-col gap-4' : 'grid grid-cols-[1fr_180px] gap-3'}>
        {form.inDir ? (
          <NewDirField
            machines={form.online}
            mid={form.mid}
            onMid={form.setPicked}
            value={form.dir}
            onChange={form.setDir}
            typed={form.fresh}
            helps={form.helps}
            onBack={form.startable.length ? form.toProject : undefined}
          />
        ) : (
          <label className="flex flex-col gap-1.5" htmlFor="ns-project">
            <span className="text-[13px] font-semibold">{t('ns.project')}</span>
            <SelectBox
              id="ns-project"
              value={form.key}
              onChange={form.pickProject}
              placeholder={t('ns.chooseProject')}
              groups={machines.map(m => ({
                label: m,
                options: form.startable
                  .filter(p => p.machine === m)
                  .map(p => ({ value: p.key, label: p.name, hint: p.display })),
              }))}
              extra={
                <button
                  type="button"
                  onClick={form.toDir}
                  className="mt-1 flex w-full cursor-pointer items-center gap-2 rounded-lg border-0 bg-transparent px-2.5 py-2 text-left text-sm text-accent hover:bg-raised"
                >
                  <Plus size={15} />
                  {t('ns.newDir')}
                </button>
              }
            />
          </label>
        )}
        <label className="flex flex-col gap-1.5" htmlFor="ns-agent">
          <span className="text-[13px] font-semibold">{t('ns.agent')}</span>
          <SelectBox
            id="ns-agent"
            value={form.kind}
            onChange={form.setChosen}
            disabled={!machine}
            placeholder={
              machine
                ? t(form.kinds.length ? 'ns.noChatAgents' : 'ns.noAgents', { machine: machine.name })
                : '—'
            }
            groups={[...installed, ...plain]}
          />
        </label>
      </div>
      {chat ? (
        <label className="flex flex-col gap-1.5">
          <span className="text-[13px] font-semibold">{t('ns.task')}</span>
          <textarea
            // biome-ignore lint/a11y/noAutofocus: the panel opens to write the task.
            autoFocus={!stacked && !form.inDir && form.key !== null}
            value={form.task}
            onChange={e => form.setTask(e.target.value)}
            onKeyDown={onSubmitKey(() => void form.start())}
            placeholder={t('ns.placeholder')}
            className={`${stacked ? 'min-h-[220px]' : 'min-h-[260px]'} resize-y rounded-lg border border-line bg-bg px-3.5 py-3 text-sm leading-relaxed text-text outline-none focus:outline-2 focus:outline-accent`}
          />
        </label>
      ) : null}
    </>
  )
}
