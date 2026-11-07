import type { ReactNode } from 'react'

export type InfoGroup = {
  title: string
  rows: { label: string; value: ReactNode; mono?: boolean }[]
}

/** Facts in groups, each a titled list of label and value. */
export function InfoFacts({ groups }: { groups: InfoGroup[] }) {
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
                <dd className={`m-0 ${row.mono ? 'font-mono break-all' : 'break-words'}`}>{row.value}</dd>
              </div>
            ))}
          </dl>
        </section>
      ))}
    </>
  )
}
