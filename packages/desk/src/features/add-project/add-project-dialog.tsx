// Add a project: open a shell in a directory. The project is then whatever the machine shows;
// nothing is stored anywhere else.

import { judgeAdd, openShell, projectKey } from '@isbell/core'
import { useState } from 'react'
import { useNavigate } from 'react-router'
import { Button } from '../../components/button'
import { Modal } from '../../components/dialog'
import { Segmented } from '../../components/segmented'
import { errorText, useI18n } from '../../core/i18n'
import { useProjects, useSpace, useSpaceView } from '../../core/space'
import { projectHref } from '../../utils/hrefs'

type Props = { open: boolean; onOpenChange: (open: boolean) => void }

export function AddProject({ open, onOpenChange }: Props) {
  const t = useI18n()
  return (
    <Modal open={open} onOpenChange={onOpenChange} title={t('add.title')} closeLabel={t('close')}>
      {open ? <Form onDone={() => onOpenChange(false)} /> : null}
    </Modal>
  )
}

function Form({ onDone }: { onDone: () => void }) {
  const t = useI18n()
  const space = useSpace()
  const view = useSpaceView()
  const projects = useProjects()
  const navigate = useNavigate()
  const machines = view.machines
    .filter(m => m.online && m.state.herdr.status === 'ready')
    .map(m => m.state.machine)
  const [mid, setMid] = useState(machines[0]?.id ?? '')
  const [dir, setDir] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const machine = machines.find(m => m.id === mid)
  const judged = judgeAdd(projects, mid, dir)

  const verdict =
    judged.kind === 'bad'
      ? t('add.bad')
      : judged.kind === 'open'
        ? t(judged.inside ? 'add.inside' : 'add.same', {
            name: judged.project.name,
            machine: judged.project.machine,
            path: judged.project.display,
          })
        : judged.kind === 'add'
          ? t('add.opens', { dir: dir.trim(), machine: machine?.name ?? '' })
          : ''

  const submit = async () => {
    if (judged.kind === 'open') {
      onDone()
      navigate(projectHref(judged.project.key))
      return
    }
    if (judged.kind !== 'add' || busy) return
    setBusy(true)
    setError(undefined)
    try {
      const paneId = await openShell(space.openThenEnd, mid, judged.dir)
      await space.refreshShells(mid)
      onDone()
      const shell = space.getSnapshot().shells.find(s => s.mid === mid && s.paneId === paneId)
      navigate(shell ? projectHref(projectKey(mid, shell.cwd)) : '/')
    } catch (err) {
      setError(errorText(t, err))
      setBusy(false)
    }
  }

  if (!machine) return <p className="m-0 text-muted">{t('add.noMachine')}</p>
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={e => {
        e.preventDefault()
        void submit()
      }}
    >
      <p className="m-0 text-muted">{t('add.body')}</p>
      {machines.length > 1 ? (
        <div className="flex flex-col gap-1.5">
          <span className="text-[13px] font-semibold">{t('add.machine')}</span>
          <Segmented
            label={t('add.machine')}
            value={mid}
            onChange={setMid}
            segments={machines.map(m => ({ value: m.id, label: m.name }))}
          />
        </div>
      ) : null}
      <label className="flex flex-col gap-1.5">
        <span className="text-[13px] font-semibold">{t('add.dir')}</span>
        <input
          // biome-ignore lint/a11y/noAutofocus: the dialog opens to type a directory.
          autoFocus
          value={dir}
          onChange={e => setDir(e.target.value)}
          placeholder="~/work/new-tool"
          autoComplete="off"
          spellCheck={false}
          className="h-[38px] rounded-lg border border-line bg-bg px-3 font-mono text-[13px] text-text outline-none focus:outline-2 focus:outline-accent"
        />
      </label>
      <p
        className={`m-0 min-h-5 text-[13px] ${error || judged.kind === 'bad' ? 'text-danger' : 'text-muted'}`}
      >
        {error ?? verdict}
      </p>
      <div className="flex justify-end gap-2">
        <Button variant="quiet" onClick={onDone}>
          {t('cancel')}
        </Button>
        <Button
          type="submit"
          variant="primary"
          disabled={judged.kind === 'none' || judged.kind === 'bad' || busy}
        >
          {busy
            ? t('add.adding')
            : judged.kind === 'open'
              ? t('add.open', { name: judged.project.name })
              : t('add.go')}
        </Button>
      </div>
    </form>
  )
}
