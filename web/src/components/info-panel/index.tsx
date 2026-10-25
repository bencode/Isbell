import { PanelRightClose, PanelRightOpen } from 'lucide-react'
import type { ReactNode } from 'react'
import { Button } from '../button'

export type InfoGroup = { title: string; rows: { label: string; value: ReactNode; mono?: boolean }[] }

/** The facts beside a session or terminal; `command` is how to reach it by hand. */
export function InfoPanel({
  groups,
  command,
}: {
  groups: InfoGroup[]
  command?: { label: string; text: string }
}) {
  return (
    <aside className="flex w-[280px] flex-none flex-col gap-5 overflow-auto border-l border-line p-5 text-[13px]">
      {groups.map(group => (
        <section key={group.title} className="flex flex-col gap-2">
          <h2 className="m-0 text-[11px] font-semibold tracking-[0.04em] text-faint uppercase">
            {group.title}
          </h2>
          <dl className="m-0 grid grid-cols-[86px_1fr] gap-x-3 gap-y-2">
            {group.rows.map(row => (
              <div key={row.label} className="contents">
                <dt className="text-muted">{row.label}</dt>
                <dd className={`m-0 ${row.mono ? 'font-mono break-all' : 'break-words'}`}>{row.value}</dd>
              </div>
            ))}
          </dl>
        </section>
      ))}
      {command ? (
        <section className="flex flex-col gap-2">
          <p className="m-0 text-muted">{command.label}</p>
          <code className="rounded-md border border-line bg-raised px-3 py-2.5 font-mono text-[12.5px] break-all">
            {command.text}
          </code>
        </section>
      ) : null}
    </aside>
  )
}

/** The header button that shows or hides the info panel. */
export function InfoToggle({
  open,
  onToggle,
  label,
}: {
  open: boolean
  onToggle: () => void
  label: string
}) {
  return (
    <Button
      variant="quiet"
      size="icon"
      onClick={onToggle}
      aria-pressed={open}
      aria-label={label}
      title={label}
    >
      {open ? <PanelRightClose size={17} /> : <PanelRightOpen size={17} />}
    </Button>
  )
}
