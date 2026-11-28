// Picking one of the roles agents run now, on a phone: a list of them, leads first, each by its face
// and name, a lead marked so, and on which machine where there are more than one. The team a new
// agent joins and the role a task is handed to are both picked here, and what it is told shown.

import { Check } from 'lucide-react'
import { RoleAvatar } from '../../components/role-avatar'
import { useRoleOf, useRunningRoles } from '../../core/books'
import { useI18n } from '../../core/i18n'
import type { Placed } from '../../model/projects'
import { roleKey } from '../../model/roles'

/** A role an agent runs, by `roleKey`; `members`, the running roles it leads. */
export type RoleChoice = { key: string; name: string; placed: Placed; members: number }

/** The roles agents run now, on every machine: leads first, then by name. */
export function useRunningChoices(): RoleChoice[] {
  const roleFor = useRoleOf()
  const running = [...useRunningRoles()].flatMap(([key, placed]) => {
    const role = roleFor(placed)
    return role ? [{ key, placed, role }] : []
  })
  const leads = running.flatMap(({ placed, role }) =>
    role.lead ? [roleKey(placed.session.mid, role.lead)] : [],
  )
  return running
    .map(({ key, placed, role }) => ({
      key,
      name: role.name,
      placed,
      members: leads.filter(k => k === key).length,
    }))
    .sort((a, b) => Number(b.members > 0) - Number(a.members > 0) || a.name.localeCompare(b.name))
}

type Props = {
  choices: RoleChoice[]
  /** The key of the one picked; none for the row `none` names. */
  value: string | undefined
  onChange: (key: string | undefined) => void
  /** A first row picking none, as "Don't join". */
  none?: string
  /** Whether to say which machine each is on. */
  named: boolean
  /** Whether one asking the user is left out of the picking: what it is sent lands on its question. */
  notAsking?: boolean
  disabled?: boolean
}

const ROW =
  'flex min-h-14 w-full cursor-pointer items-center gap-2.5 border-0 border-t border-solid border-line bg-transparent px-[13px] py-[7px] text-left text-text first:border-t-0 disabled:cursor-default'

export function RolePicker({
  choices,
  value,
  onChange,
  none,
  named,
  notAsking = false,
  disabled = false,
}: Props) {
  const t = useI18n()
  const tick = <Check size={18} className="flex-none text-accent" />
  return (
    <div className="mx-3 overflow-hidden rounded-[11px] border border-line bg-raised">
      {none === undefined ? null : (
        <button
          type="button"
          disabled={disabled}
          onClick={() => onChange(undefined)}
          aria-pressed={value === undefined}
          className={ROW}
        >
          <span className="min-w-0 flex-1 text-[15px] text-muted">{none}</span>
          {value === undefined ? tick : null}
        </button>
      )}
      {choices.map(choice => {
        const asking = choice.placed.session.status === 'blocked'
        return (
          <button
            key={choice.key}
            type="button"
            disabled={disabled || (notAsking && asking)}
            onClick={() => onChange(choice.key)}
            aria-pressed={choice.key === value}
            className={`${ROW} disabled:opacity-50`}
          >
            <RoleAvatar name={choice.name} status={choice.placed.session.status} />
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="flex min-w-0 items-center gap-1.5">
                <b className="truncate text-[15px] font-medium">{choice.name}</b>
                {choice.members ? (
                  <span className="flex-none rounded-[5px] bg-accent-soft px-[5px] text-[10px] leading-4 font-semibold tracking-wide text-accent uppercase">
                    {t('mobile.lead')}
                  </span>
                ) : null}
              </span>
              <span className="truncate text-[11.5px] text-faint">
                {[
                  notAsking && asking ? t('status.blocked') : undefined,
                  choice.placed.project.name,
                  named ? choice.placed.project.machine : undefined,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </span>
            </span>
            {choice.key === value ? tick : null}
          </button>
        )
      })}
    </div>
  )
}

/** What a role will be told, word for word, under what `label` says of it. */
export function Said({ label, text }: { label: string; text: string }) {
  return (
    <div className="mx-3 mt-3 rounded-[11px] bg-raised-2 px-3 py-2.5">
      <p className="m-0 pb-1 text-[12px] text-faint">{label}</p>
      <p className="m-0 font-mono text-[12.5px] whitespace-pre-wrap text-muted [overflow-wrap:anywhere]">
        {text}
      </p>
    </div>
  )
}
