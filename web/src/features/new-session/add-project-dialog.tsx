// Adding a directory to a machine's projects, typed with the machine's help.

import { type FormEvent, useState } from 'react'
import { Button } from '../../components/button'
import { Modal } from '../../components/dialog'
import { errorText, uiLabels, useI18n } from '../../core/i18n'
import { useSpace } from '../../core/space'
import { list } from '../../model/files/remote'
import type { Caller } from '../../model/herdr'
import type { MachineState } from '../../model/state'
import { CallError } from '../../model/streams'
import { DirInput, DirNote, useNewDir } from './dir-input'

type Props = {
  machine: MachineState
  onClose: () => void
}

async function hasNoDir(call: Caller, mid: string, dir: string) {
  try {
    await list(call, mid, dir)
    return false
  } catch (err) {
    if (err instanceof CallError && ['not_found', 'not_a_directory'].includes(err.code)) return true
    throw err
  }
}

export function AddProjectDialog({ machine, onClose }: Props) {
  const t = useI18n()
  const space = useSpace()
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string>()
  const mid = machine.machine.id
  const helps = machine.caps.methods.includes('isbell.file.list')
  const typed = useNewDir(mid, value, helps)
  const dir = typed.dir?.startsWith('/') ? typed.dir : undefined
  // A `~` only the machine could resolve: its home shows in its projects, and it has none yet.
  const noHome = typed.dir?.startsWith('~')

  const add = async (e: FormEvent) => {
    e.preventDefault()
    if (!dir || busy) return
    setBusy(true)
    setProblem(undefined)
    try {
      // What was typed may not have been looked at yet.
      if (helps && (await hasNoDir(space.call, mid, dir))) {
        setProblem(t('dir.missing'))
        setBusy(false)
        return
      }
      await space.changeProjects(mid, paths => (paths?.includes(dir) ? undefined : [...(paths ?? []), dir]))
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
        <DirInput
          value={value}
          onChange={setValue}
          helps={helps}
          entries={typed.entries}
          picks={typed.picks}
          badge={typed.badge}
        />
        <DirNote note={typed.note} />
        {noHome ? <p className="m-0 text-[13px] text-warn">{t('workbench.fullPath')}</p> : null}
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
