import type { ReactNode } from 'react'

export type InfoGroup = {
  title: string
  /** `note` follows the value in the text face, so a `mono` value can carry words after it. */
  rows: { label: string; value: ReactNode; mono?: boolean; note?: string }[]
}

/** The facts about a session or terminal; `command` is how to reach it by hand. */
export function InfoFacts({
  groups,
  command,
}: {
  groups: InfoGroup[]
  command?: { label: string; text: string }
}) {
  return (
    <>
      {groups.map(group => (
        <section key={group.title} className="flex flex-col gap-2">
          <h2 className="m-0 text-[11px] font-semibold tracking-[0.04em] text-faint uppercase">
            {group.title}
          </h2>
          <dl className="m-0 grid grid-cols-[86px_1fr] gap-x-3 gap-y-2">
            {group.rows.map(row => (
              <div key={row.label} className="contents">
                <dt className="text-muted">{row.label}</dt>
                <dd className={`m-0 ${row.mono ? 'font-mono break-all' : 'break-words'}`}>
                  {row.value}
                  {row.note ? <span className="font-sans text-muted"> · {row.note}</span> : null}
                </dd>
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
    </>
  )
}
