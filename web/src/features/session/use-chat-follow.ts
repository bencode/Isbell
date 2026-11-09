// How a chat goes along with what comes in, whatever it scrolls in: it follows while at its end and
// says so while scrolled up, and what was sent shows at once, until the record has it.

import { type RefObject, useCallback, useLayoutEffect, useRef, useState } from 'react'
import type { ChatLog } from '../../core/chat-log'
import type { ChatTurn } from '../../model/chat/types'
import { splitUploads } from '../../model/files/uploads'

/** What was sent and when, and the record's last turn then (null: none yet; undefined: not read
 * yet). */
type Sent = { text: string; at: number; after: string | null | undefined }

/** What was sent that the record does not have yet, in order. Each takes a turn asking after the one
 * last when it was sent, the one asking the same first; without a turn to tell by, only that one. */
function unrecorded(sent: Sent[], turns: ChatTurn[] | undefined): Sent[] {
  const used = new Set<string>()
  return sent.filter(({ text, after }) => {
    const from = after ? (turns ?? []).findIndex(turn => turn.id === after) + 1 : 0
    const asked = (turns ?? []).slice(from).filter(turn => turn.you && !used.has(turn.id))
    const said = splitUploads(text).text
    const it =
      asked.find(turn => turn.you?.text.trim() === said) ?? (after === undefined ? undefined : asked[0])
    if (it) used.add(it.id)
    return !it
  })
}

/** `scroller`: what scrolls, the same element for the hook's life; its owner calls `onScrolled` as it
 * does. `asking`: the agent waits for an answer. */
export function useChatFollow(scroller: RefObject<HTMLElement | null>, log: ChatLog, asking: boolean) {
  const [sent, setSent] = useState<Sent[]>([])
  const pending = unrecorded(sent, log.turns)
  const waits = pending.length
  const pinned = useRef(true)
  const [unseen, setUnseen] = useState(false)
  // A chat left at its end shows what came in meanwhile: the record read further (earlier turns read
  // before it are no news), what was sent, the agent asking. Shown again from behind something else
  // this runs with nothing new, which is not to be announced.
  const known = useRef({ end: log.end, waits, asking })
  useLayoutEffect(() => {
    const el = scroller.current
    const was = known.current
    known.current = { end: log.end, waits, asking }
    if (!el || (!log.end && !waits && !asking)) return
    if (pinned.current) el.scrollTop = el.scrollHeight
    else if (was.end !== log.end || was.waits !== waits || was.asking !== asking) setUnseen(true)
  }, [scroller, log.end, waits, asking])

  const onScrolled = useCallback(() => {
    const el = scroller.current
    if (!el) return
    pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24
    if (pinned.current) setUnseen(false)
  }, [scroller])

  const toEnd = () => {
    const el = scroller.current
    el?.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
  }

  const onSent = (text: string) => {
    // Sent ends at the bottom, to see it go in.
    pinned.current = true
    const after = log.turns ? (log.turns.at(-1)?.id ?? null) : undefined
    setSent([...pending, { text, at: Date.now(), after }])
  }

  return { pending, unseen, onScrolled, toEnd, onSent }
}
