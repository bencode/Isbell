// A message pinned over a chat on a phone, under its bar, as the book has it now: what it asks or
// says, and its latest reply. Tapped, it opens in full; its cross unpins it. It is answered in the
// chat below, by talking to the agent, which follows the message up.

import { Pin, X } from 'lucide-react'
import { useState } from 'react'
import { useBooks } from '../../../core/books'
import { useI18n } from '../../../core/i18n'
import { asksYou } from '../../../model/messages'

/** The query a session's address pins a message with, by its number. */
export const PIN = 'm'

export function Pinned({ mid, id, onClose }: { mid: string; id: number; onClose: () => void }) {
  const t = useI18n()
  const message = useBooks()[mid]?.messages?.messages.find(m => m.id === id)
  const [open, setOpen] = useState(false)
  if (!message) return null
  const asking = asksYou(message)
  const reply = message.replies.at(-1)
  const clamp = (lines: string) => (open ? '' : lines)
  return (
    <div
      className={`mx-3 mb-2.5 flex max-h-[45dvh] items-start gap-2 overflow-auto rounded-[14px] border py-2 pr-1 pl-3 ${asking ? 'border-ask-line bg-ask' : 'border-line bg-raised'}`}
    >
      <Pin aria-hidden size={14} className={`mt-[3px] flex-none ${asking ? 'text-warn' : 'text-faint'}`} />
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(was => !was)}
        className="min-w-0 flex-1 cursor-pointer border-0 bg-transparent p-0 text-left text-text"
      >
        <span className="flex items-baseline gap-1.5 text-[13px] leading-snug font-semibold">
          <span className={`min-w-0 [overflow-wrap:anywhere] ${clamp('line-clamp-2')}`}>
            {message.title ?? message.text}
          </span>
          {message.task === undefined ? null : (
            <span className="flex-none font-mono text-[10.5px] font-normal text-faint">T{message.task}</span>
          )}
        </span>
        {message.title && message.text ? (
          <span
            className={`mt-0.5 block text-[12.5px] whitespace-pre-line text-muted [overflow-wrap:anywhere] ${clamp('line-clamp-3')}`}
          >
            {message.text}
          </span>
        ) : null}
        {reply ? (
          <span
            className={`mt-1 block text-[12.5px] whitespace-pre-line text-muted [overflow-wrap:anywhere] ${clamp('line-clamp-2')}`}
          >
            ↳ {reply.role ? `${reply.role}: ` : ''}
            {reply.text}
          </span>
        ) : null}
      </button>
      <button
        type="button"
        aria-label={t('mobile.unpin')}
        onClick={onClose}
        className="-my-1.5 grid size-9 flex-none cursor-pointer place-items-center rounded-[10px] border-0 bg-transparent p-0 text-muted active:bg-press"
      >
        <X size={16} />
      </button>
    </div>
  )
}
