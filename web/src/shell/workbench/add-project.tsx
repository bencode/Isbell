// Adding a directory to a machine's projects, typed with the machine's help.

import { type FormEvent, useState } from 'react'
import { Button } from '../../components/button'
import { Modal } from '../../components/dialog'
import { errorText, uiLabels, useI18n } from '../../core/i18n'
import { useSpace } from '../../core/space'
import { useNewDir } from '../../features/new-session/dir-input'
import { NewDirField } from '../../features/new-session/new-dir'
import type { MachineState } from '../../model/state'

type Props = {
  machine: MachineState
  /** What the machine lists now. */
  paths: string[]
  onClose: () => void
}

export function AddProject({ machine, paths, onClose }: Props) {
  const t = useI18n()
  const space = useSpace()
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string>()
  const mid = machine.machine.id
  const helps = machine.caps.methods.includes('isbell.file.list')
  const typed = useNewDir(mid, value, helps)
  const dir = typed.dir?.startsWith('/') && !paths.includes(typed.dir) ? typed.dir : undefined

  const add = async (e: FormEvent) => {
    e.preventDefault()
    if (!dir || busy) return
    setBusy(true)
    setProblem(undefined)
    try {
      await space.saveProjects(mid, [...paths, dir])
      onClose()
    } catch (err) {
      console.error('could not add a project', err)
      setProblem(errorText(t, err))
      setBusy(false)
    }
  }

  return (
    <Modal
      open
      onOpenChange={open => {
        if (!open) onClose()
      }}
      title={t('workbench.addProjectOn', { machine: machine.machine.name })}
      closeLabel={uiLabels(t).close}
    >
      <form onSubmit={add} className="flex flex-col gap-3">
        <NewDirField
          machines={[machine]}
          mid={mid}
          onMid={() => {}}
          value={value}
          onChange={setValue}
          typed={typed}
          helps={helps}
          onBack={undefined}
        />
        {problem ? <p className="m-0 text-[13px] text-danger">{problem}</p> : null}
        <div className="flex justify-end">
          <Button type="submit" variant="primary" disabled={!dir || busy}>
            {t('workbench.add')}
          </Button>
        </div>
      </form>
    </Modal>
  )
}
