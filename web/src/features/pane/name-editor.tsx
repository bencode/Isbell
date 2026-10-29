// An agent's name on the bar over it, renamed in place: a click turns it into a field, ↵ gives the
// agent that name in herdr (an empty one takes its name away), Esc or a click elsewhere leaves it.

import { useEffect, useState } from 'react'
import { errorText, useI18n } from '../../core/i18n'
import { useProjects, useSpace } from '../../core/space'
import { nameProblem, shownName } from '../../model/agent-name'
import { renameAgent } from '../../model/herdr'
import type { Session } from '../../model/projects'

export function NameEditor({ session }: { session: Session }) {
  const t = useI18n()
  const space = useSpace()
  const { mid, paneId } = session
  const taken = useProjects()
    .filter(p => p.mid === mid)
    .flatMap(p => p.sessions)
    .flatMap(s => (s.paneId !== paneId && s.herdrName ? [s.herdrName] : []))
  // The field's text while renaming (null: not renaming).
  const [draft, setDraft] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  // The name just given (null: taken away), shown until the machine's state says it.
  const [given, setGiven] = useState<string | null>()
  const current = session.herdrName ?? null
  useEffect(() => {
    if (given === current) setGiven(undefined)
  }, [given, current])

  const leave = () => {
    setDraft(null)
    setError(undefined)
  }
  const problem = draft === null ? null : nameProblem(draft, taken)
  const save = async () => {
    if (draft === null || problem || busy) return
    const name = draft || null
    if (name === current) return leave()
    setBusy(true)
    setError(undefined)
    try {
      await renameAgent(space.call, mid, paneId, name)
      setGiven(name)
      leave()
    } catch (err) {
      setError(errorText(t, err))
    } finally {
      setBusy(false)
    }
  }

  if (draft === null) {
    const name = given === undefined ? session.name : (given ?? shownName(undefined, session.kind, paneId))
    return (
      <button
        type="button"
        onClick={() => setDraft(current ?? '')}
        title={t('name.rename')}
        className="-ml-1 min-w-0 cursor-text truncate rounded-md border-0 bg-transparent px-1 py-0.5 text-left font-semibold text-text hover:bg-raised-2 focus-visible:outline-2 focus-visible:outline-accent"
      >
        {name}
      </button>
    )
  }
  const note = error ?? (problem ? t(`name.${problem}`) : undefined)
  return (
    <span className="relative -ml-1 min-w-0">
      <input
        // biome-ignore lint/a11y/noAutofocus: it opens on a click meant to type the name
        autoFocus
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onFocus={e => e.target.select()}
        onBlur={() => {
          if (!busy) leave()
        }}
        onKeyDown={e => {
          if (e.nativeEvent.isComposing || e.keyCode === 229) return
          if (e.key === 'Enter') void save()
          if (e.key === 'Escape') leave()
        }}
        placeholder={shownName(undefined, session.kind, paneId)}
        aria-label={t('name.rename')}
        aria-invalid={Boolean(note)}
        readOnly={busy}
        spellCheck={false}
        autoCapitalize="off"
        className={`h-7 w-56 rounded-md border bg-bg px-1.5 font-mono text-[13px] text-text outline-none ${note ? 'border-danger' : 'border-accent'}`}
      />
      {note ? (
        <span className="absolute top-full left-0 z-10 mt-1 w-max max-w-80 rounded-md border border-line bg-raised-2 px-2 py-1 text-xs text-danger index-card-lifted">
          {note}
        </span>
      ) : null}
    </span>
  )
}
