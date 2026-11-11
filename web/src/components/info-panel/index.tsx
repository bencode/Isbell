import { Check, Copy } from 'lucide-react'
import { type ReactNode, useState } from 'react'
import type { CopyLabels } from '../command'
import { IconButton, SMALL_ICON } from '../icon-button'

export type InfoGroup = {
  title: string
  /** `note` follows the value in the text face, so a `mono` value can carry words after it. */
  rows: { label: string; value: ReactNode; mono?: boolean; note?: string }[]
}

type HandCommand = { label: string; text: string; note?: string; copy: CopyLabels }

/** Facts in groups, each a titled list of label and value; `command`, how to reach it by hand. */
export function InfoFacts({ groups, command }: { groups: InfoGroup[]; command?: HandCommand }) {
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
      {command ? <CommandSection command={command} /> : null}
    </>
  )
}

function CommandSection({ command }: { command: HandCommand }) {
  const [copied, setCopied] = useState(false)
  const copy = () =>
    navigator.clipboard.writeText(command.text).then(
      () => setCopied(true),
      (err: unknown) => console.error('could not copy', err),
    )
  return (
    <section className="flex flex-col gap-2">
      <p className="m-0 text-muted">{command.label}</p>
      <div className="flex items-start gap-1 rounded-md border border-line bg-raised py-1 pr-1 pl-3">
        <code className="min-w-0 flex-1 py-1.5 font-mono text-[12.5px] wrap-anywhere">
          {keepFlagsWhole(command.text)}
        </code>
        <IconButton
          label={copied ? command.copy.copied : command.copy.copy}
          side="left"
          onClick={copy}
          onBlur={() => setCopied(false)}
        >
          {copied ? <Check {...SMALL_ICON} /> : <Copy {...SMALL_ICON} />}
        </IconButton>
      </div>
      {command.note ? (
        <p className="m-0 text-[12.5px] text-muted">{keepFlagsWhole(command.note, 'font-mono')}</p>
      ) : null}
    </section>
  )
}

/** A browser breaks a line after a hyphen, which would split `--control --takeover`; a run of
 * options stays on one line. */
const keepFlagsWhole = (text: string, extra = '') =>
  text.split(/(--[\w-]+(?: --[\w-]+)*)/).map((part, i) =>
    i % 2 ? (
      <span key={part} className={`whitespace-nowrap ${extra}`}>
        {part}
      </span>
    ) : (
      part
    ),
  )
