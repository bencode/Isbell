// That the agent asks, in its chat: what it waits on, as its hook said, and the way to its terminal,
// where its own menu takes the answer.

import { useEffect, useState } from 'react'
import { useI18n } from '../../core/i18n'
import { useSpace } from '../../core/space'
import type { ToolUse } from '../../model/agent-note'
import { agentNote } from '../../model/herdr'
import { TerminalLink } from './context'

/** Shown while the agent waits for an answer; reads what it waits on once, as it begins to. */
export function AskingBanner({ mid, paneId, name }: { mid: string; paneId: string; name: string }) {
  const t = useI18n()
  const { call } = useSpace()
  const [waits, setWaits] = useState<ToolUse>()
  useEffect(() => {
    let live = true
    agentNote(call, mid, paneId).then(
      note => {
        if (live) setWaits(note.asking)
      },
      (err: unknown) => console.error(`could not read what ${paneId} waits on`, err),
    )
    return () => {
      live = false
    }
  }, [call, mid, paneId])
  return (
    <section className="flex flex-col gap-2.5 rounded-lg border border-ask-line bg-ask p-4">
      <h2 className="m-0 flex items-center gap-2 text-sm font-semibold">
        <span className="size-[7px] rounded-full bg-warn" />
        {t('ask.title', { name })}
      </h2>
      {waits ? (
        <pre className="m-0 max-h-48 overflow-auto rounded border border-line bg-raised px-3 py-2 font-mono text-[12.5px] leading-normal whitespace-pre-wrap">
          {waits.target ? `${waits.tool} ${waits.target}` : waits.tool}
        </pre>
      ) : null}
      <span className="text-[13px]">
        <TerminalLink>{t('ask.inTerminal')}</TerminalLink>
      </span>
    </section>
  )
}
