// The place to start when it is not a project yet: a machine, and a directory on it.

import { Segmented } from '../../components/segmented'
import { useI18n } from '../../core/i18n'
import type { MachineState } from '../../model/state'
import { DirInput, type useNewDir } from './dir-input'

const TONE = { danger: 'text-danger', warn: 'text-warn', muted: 'text-muted' }

type Props = {
  machines: MachineState[]
  mid: string
  onMid: (mid: string) => void
  value: string
  onChange: (value: string) => void
  typed: ReturnType<typeof useNewDir>
  helps: boolean
  /** Back to the projects there are; none when there are none. */
  onBack: (() => void) | undefined
}

export function NewDirField({ machines, mid, onMid, value, onChange, typed, helps, onBack }: Props) {
  const t = useI18n()
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <span className="flex items-center justify-between text-[13px] font-semibold">
        {t('dir.label')}
        {onBack ? (
          <button
            type="button"
            onClick={onBack}
            className="cursor-pointer border-0 bg-transparent p-0 text-[12.5px] font-normal text-accent hover:underline"
          >
            {t('ns.existing')}
          </button>
        ) : null}
      </span>
      {machines.length > 1 ? (
        <Segmented
          label={t('dir.machine')}
          value={mid}
          onChange={onMid}
          segments={machines.map(m => ({ value: m.machine.id, label: m.machine.name }))}
        />
      ) : null}
      <DirInput
        value={value}
        onChange={onChange}
        helps={helps}
        entries={typed.entries}
        picks={typed.picks}
        badge={typed.badge}
      />
      {typed.note ? <p className={`m-0 text-[13px] ${TONE[typed.note.tone]}`}>{typed.note.text}</p> : null}
    </div>
  )
}
