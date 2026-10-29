// Files sent along with a reply: each goes to the agent's machine as soon as it is added, and the
// reply carries where it landed there.

import { Paperclip, X } from 'lucide-react'
import { useRef, useState } from 'react'
import { errorText, useI18n } from '../../core/i18n'
import { useSpace } from '../../core/space'
import { UPLOAD_MAX, upload } from '../../model/files/remote'

export type Attachment = {
  id: number
  name: string
  size: number
  sent: number
  path?: string
  error?: string
}

/** Files added for machine `mid`; `enabled` once its gateway takes them. */
export function useAttachments(mid: string, enabled: boolean) {
  const t = useI18n()
  const space = useSpace()
  const [items, setItems] = useState<Attachment[]>([])
  const [problem, setProblem] = useState<string>()
  const ids = useRef(0)
  const patch = (id: number, change: Partial<Attachment>) =>
    setItems(all => all.map(a => (a.id === id ? { ...a, ...change } : a)))

  const send = async (id: number, file: File) => {
    try {
      const bytes = new Uint8Array(await file.arrayBuffer())
      const path = await upload(space.openStream, mid, file.name, bytes, sent => patch(id, { sent }))
      patch(id, { path })
    } catch (err) {
      patch(id, { error: errorText(t, err) })
    }
  }

  const add = (files: File[]) => {
    if (!files.length) return
    if (!enabled) return setProblem(t('upload.unsupported'))
    setProblem(undefined)
    const added = files.map(file => {
      ids.current += 1
      const tooLarge = file.size > UPLOAD_MAX ? { error: t('upload.tooLarge') } : {}
      return { file, item: { id: ids.current, name: file.name, size: file.size, sent: 0, ...tooLarge } }
    })
    setItems(all => [...all, ...added.map(a => a.item)])
    for (const { file, item } of added) if (!item.error) void send(item.id, file)
  }

  return {
    items,
    add,
    /** Leaves the file on the machine, for its temporary directory to clear. */
    remove: (id: number) => setItems(all => all.filter(a => a.id !== id)),
    clear: () => {
      setItems([])
      setProblem(undefined)
    },
    paths: items.flatMap(a => (a.path ? [a.path] : [])),
    uploading: items.some(a => !a.path && !a.error),
    problem,
  }
}

export function Attachments({ items, onRemove }: { items: Attachment[]; onRemove: (id: number) => void }) {
  const t = useI18n()
  if (!items.length) return null
  return (
    <ul className="m-0 flex list-none flex-wrap gap-1.5 p-0">
      {items.map(a => (
        <li
          key={a.id}
          title={a.error ?? a.path ?? a.name}
          className={`flex max-w-64 items-center gap-1.5 rounded-md border bg-bg py-0.5 pr-0.5 pl-2 text-[12px] ${a.error ? 'border-danger text-danger' : 'border-line text-text'}`}
        >
          <Paperclip size={12} className="flex-none opacity-60" />
          <span className="min-w-0 truncate">{a.name}</span>
          {a.error ? (
            <span className="min-w-0 truncate text-[11px]">{a.error}</span>
          ) : a.path ? null : (
            <span className="flex-none font-mono text-[11px] text-faint">
              {Math.floor((a.sent * 100) / Math.max(a.size, 1))}%
            </span>
          )}
          <button
            type="button"
            onClick={() => onRemove(a.id)}
            aria-label={t('upload.remove')}
            title={t('upload.remove')}
            className="inline-flex size-5 flex-none cursor-pointer items-center justify-center rounded border-0 bg-transparent text-faint hover:text-text"
          >
            <X size={12} />
          </button>
        </li>
      ))}
    </ul>
  )
}
