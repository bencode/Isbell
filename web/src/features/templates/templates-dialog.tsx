// Editing a machine's start templates: each a name, the agent herdr is to recognize, and the command
// that starts it. Every change is written at once; one that cannot be leaves the list as it was.

import { ArrowDown, ArrowUp, Pencil, Trash2 } from 'lucide-react'
import { type FormEvent, useState } from 'react'
import { Button } from '../../components/button'
import { Modal } from '../../components/dialog'
import { IconButton } from '../../components/icon-button'
import { Segmented } from '../../components/segmented'
import { errorText, type Key, uiLabels, useI18n } from '../../core/i18n'
import { useTemplates } from '../../core/start-templates'
import { CHAT_AGENTS } from '../../model/agents'
import type { MachineEntry } from '../../model/space'
import { LAUNCH_METHOD, problem, type StartTemplate } from '../../model/start-templates'

const FIELD =
  'h-[34px] rounded-md border border-line bg-bg px-2 text-[13px] text-text outline-none focus:border-accent disabled:opacity-55'
const LABEL = 'flex flex-col gap-1.5 text-xs font-semibold text-faint'
const SMALL = { size: 14, strokeWidth: 1.5, absoluteStrokeWidth: true }
const PROBLEM: Record<NonNullable<ReturnType<typeof problem>>, Key> = {
  name: 'templates.noName',
  command: 'templates.noCommand',
  duplicate: 'templates.duplicate',
}
const BLANK: StartTemplate = { name: '', agent: 'claude', command: '' }

export function TemplatesDialog({ entry, onClose }: { entry: MachineEntry; onClose: () => void }) {
  const t = useI18n()
  const { machine, caps } = entry.state
  const { templates, state, save } = useTemplates(machine.id, true)
  const [draft, setDraft] = useState<StartTemplate>(BLANK)
  /** The row the form edits; none, it adds one. */
  const [editing, setEditing] = useState<number>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()

  const writable = entry.online && caps.methods.includes('isbell.file.write') && state !== 'broken'
  const launches = caps.methods.includes(LAUNCH_METHOD)
  const readonlyNote: Key | undefined =
    state === 'broken'
      ? 'templates.broken'
      : !writable
        ? 'templates.readonly'
        : !launches
          ? 'templates.old'
          : undefined
  const ready = writable && launches && state !== 'reading' && state !== 'failed'

  const write = async (next: StartTemplate[]) => {
    setBusy(true)
    setError(undefined)
    try {
      await save(next)
      return true
    } catch (err) {
      setError(errorText(t, err))
      return false
    } finally {
      setBusy(false)
    }
  }

  const others = templates.filter((_, i) => i !== editing)
  const wrong = draft.name || draft.command ? problem(draft, others) : undefined
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (busy || problem(draft, others)) return
    const done = { ...draft, name: draft.name.trim(), command: draft.command.trim() }
    const next =
      editing === undefined ? [...templates, done] : templates.map((row, i) => (i === editing ? done : row))
    if (await write(next)) {
      setDraft(BLANK)
      setEditing(undefined)
    }
  }
  const move = (from: number, to: number) => {
    const next = [...templates]
    const [row] = next.splice(from, 1)
    if (row) next.splice(to, 0, row)
    void write(next)
  }

  return (
    <Modal
      open
      onOpenChange={open => {
        if (!open) onClose()
      }}
      title={t('templates.title', { machine: machine.name })}
      closeLabel={uiLabels(t).close}
    >
      {readonlyNote ? <p className="m-0 text-[13px] text-muted">{t(readonlyNote)}</p> : null}
      {state === 'broken' ? null : (
        <ul className="m-0 flex list-none flex-col gap-0.5 p-0">
          {templates.map((row, i) => (
            <li
              key={row.name}
              className={`flex items-center gap-3 rounded-md px-2 py-1.5 ${i === editing ? 'bg-raised-2' : ''}`}
            >
              <span className="w-28 flex-none truncate text-[13px]">{row.name}</span>
              <span className="w-14 flex-none font-mono text-xs text-faint">{row.agent}</span>
              <span className="min-w-0 flex-1 truncate font-mono text-xs text-muted" title={row.command}>
                {row.command}
              </span>
              {ready ? (
                <span className="flex flex-none">
                  <IconButton
                    label={t('templates.up')}
                    size="small"
                    disabled={busy || i === 0}
                    onClick={() => move(i, i - 1)}
                  >
                    <ArrowUp {...SMALL} />
                  </IconButton>
                  <IconButton
                    label={t('templates.down')}
                    size="small"
                    disabled={busy || i === templates.length - 1}
                    onClick={() => move(i, i + 1)}
                  >
                    <ArrowDown {...SMALL} />
                  </IconButton>
                  <IconButton
                    label={t('templates.edit')}
                    size="small"
                    disabled={busy}
                    onClick={() => {
                      setEditing(i)
                      setDraft(row)
                    }}
                  >
                    <Pencil {...SMALL} />
                  </IconButton>
                  <IconButton
                    label={t('templates.remove')}
                    size="small"
                    disabled={busy || templates.length === 1}
                    onClick={() => void write(templates.filter((_, j) => j !== i))}
                  >
                    <Trash2 {...SMALL} />
                  </IconButton>
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {ready ? (
        <form onSubmit={submit} className="flex flex-col gap-3 border-t border-line pt-4">
          <div className="flex flex-wrap gap-3">
            <label className={`${LABEL} min-w-40 flex-1`}>
              {t('templates.name')}
              <input
                value={draft.name}
                onChange={e => setDraft({ ...draft, name: e.target.value })}
                placeholder="Claude · GLM"
                className={FIELD}
              />
            </label>
            <div className={LABEL}>
              {t('templates.agent')}
              <Segmented
                label={t('templates.agent')}
                value={draft.agent}
                onChange={agent => setDraft({ ...draft, agent })}
                segments={CHAT_AGENTS.map(agent => ({ value: agent, label: agent }))}
              />
            </div>
          </div>
          <label className={LABEL}>
            {t('templates.command')}
            <input
              value={draft.command}
              onChange={e => setDraft({ ...draft, command: e.target.value })}
              placeholder="cc_glm && claude"
              spellCheck={false}
              className={`${FIELD} font-mono`}
            />
            <span className="font-normal text-muted">{t('templates.commandHint')}</span>
          </label>
          {wrong ? <p className="m-0 text-[13px] text-danger">{t(PROBLEM[wrong])}</p> : null}
          {error ? <p className="m-0 text-[13px] text-danger">{error}</p> : null}
          <div className="flex justify-end gap-2">
            {editing === undefined ? null : (
              <Button
                onClick={() => {
                  setEditing(undefined)
                  setDraft(BLANK)
                }}
              >
                {t('templates.cancel')}
              </Button>
            )}
            <Button
              type="submit"
              variant="primary"
              disabled={busy || !draft.name || !draft.command || !!wrong}
            >
              {t(editing === undefined ? 'templates.add' : 'templates.save')}
            </Button>
          </div>
        </form>
      ) : null}
    </Modal>
  )
}
