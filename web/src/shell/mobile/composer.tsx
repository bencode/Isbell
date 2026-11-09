// A reply on a phone: a field a finger can reach, and one button that sends or, with nothing written
// while the agent works, stops it. Return is a new line here; the button sends.

import { ArrowUp, Square } from 'lucide-react'
import { useI18n } from '../../core/i18n'
import { Attachments, PickFiles } from '../../features/session/attachments'
import { useComposer } from '../../features/session/composer'
import { TAP } from './bar'

export function PhoneComposer({
  mid,
  paneId,
  machine,
  stoppable,
  onSent,
}: {
  mid: string
  paneId: string
  machine: string
  stoppable: boolean
  onSent: (text: string) => void
}) {
  const t = useI18n()
  const { text, setText, send, stop, stopping, ready, drafting, error, files } = useComposer({
    mid,
    paneId,
    onSent,
    machine,
  })
  const stops = stoppable && !drafting
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-col gap-1 rounded-[14px] border border-line-strong bg-raised p-[3px] focus-within:border-accent">
        {files.items.length ? (
          <div className="px-2 pt-1.5">
            <Attachments items={files.items} onRemove={files.remove} />
          </div>
        ) : null}
        <div className="flex items-end gap-0.5">
          {files.taken ? <PickFiles onPick={files.add} className={TAP} /> : <span className="w-2.5" />}
          <textarea
            rows={1}
            value={text}
            onChange={e => setText(e.target.value)}
            onPaste={files.paste}
            aria-label={t('composer.placeholder')}
            placeholder={t('composer.placeholder')}
            className="field-sizing-content max-h-36 min-h-11 min-w-0 flex-1 resize-none border-0 bg-transparent px-1 py-2.5 leading-6 text-text outline-none placeholder:text-faint"
          />
          <button
            type="button"
            onClick={stops ? stop : () => void send()}
            disabled={stops ? stopping : !ready}
            aria-label={t(stops ? 'chat.stop' : 'composer.send')}
            className={`grid size-11 flex-none cursor-pointer place-items-center rounded-[11px] border-0 disabled:cursor-default disabled:opacity-40 ${stops || !ready ? 'bg-raised-2 text-text' : 'bg-accent text-accent-ink'}`}
          >
            {stops ? <Square size={15} fill="currentColor" /> : <ArrowUp size={20} />}
          </button>
        </div>
      </div>
      {error ? <p className="m-0 px-1 text-[13px] text-danger">{error}</p> : null}
      {files.problem ? <p className="m-0 px-1 text-[13px] text-danger">{files.problem}</p> : null}
    </div>
  )
}
