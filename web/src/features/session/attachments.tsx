// Files for an agent: each goes to its machine as soon as it is added, pasted, dropped or picked,
// and the agent is told where it landed there.

import { Paperclip, X } from 'lucide-react'
import { type ClipboardEvent, type DragEvent, useRef, useState } from 'react'
import { errorText, useI18n } from '../../core/i18n'
import { useSpace, useSpaceView } from '../../core/space'
import { UPLOAD_MAX, upload } from '../../model/files/remote'
import { machineOf } from '../../model/space'

type Attachment = {
  id: number
  name: string
  size: number
  sent: number
  path?: string
  error?: string
}

/** Files added for machine `mid`, named `machine`. With `landed`, each is handed over as soon as it
 * is on the machine and leaves the list; without it, `paths` holds them until they are sent. */
export function useAttachments(mid: string, machine: string, landed?: (path: string) => void) {
  const t = useI18n()
  const space = useSpace()
  const methods = machineOf(useSpaceView().machines, mid)?.state.caps.methods
  const taken = !!methods?.includes('isbell.file.upload')
  const [items, setItems] = useState<Attachment[]>([])
  const [problem, setProblem] = useState<string>()
  const ids = useRef(0)
  // Taken off the list while on its way: it still lands, but is not handed over.
  const removed = useRef(new Set<number>())
  const patch = (id: number, change: Partial<Attachment>) =>
    setItems(all => all.map(a => (a.id === id ? { ...a, ...change } : a)))

  const send = async (id: number, file: File) => {
    try {
      const bytes = new Uint8Array(await file.arrayBuffer())
      const path = await upload(space.openStream, mid, file.name, bytes, sent => patch(id, { sent }))
      if (!landed) return patch(id, { path })
      if (!removed.current.has(id)) landed(path)
      setItems(all => all.filter(a => a.id !== id))
    } catch (err) {
      patch(id, { error: errorText(t, err) })
    }
  }

  const add = (files: File[]) => {
    if (!files.length) return
    if (!taken) return setProblem(t('upload.unsupported', { machine }))
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
    /** Whether the machine's gateway takes files. */
    taken,
    items,
    add,
    /** For a paste: files in it are added, and nothing else hears of it; text is left alone. */
    paste: (e: ClipboardEvent) => {
      const pasted = [...e.clipboardData.files]
      if (!pasted.length) return
      e.preventDefault()
      e.stopPropagation()
      add(pasted)
    },
    drop: {
      onDragOver: (e: DragEvent) => {
        if (e.dataTransfer.types.includes('Files')) e.preventDefault()
      },
      onDrop: (e: DragEvent) => {
        if (!e.dataTransfer.files.length) return
        e.preventDefault()
        add([...e.dataTransfer.files])
      },
    },
    /** Leaves the file on the machine, for its temporary directory to clear. */
    remove: (id: number) => {
      removed.current.add(id)
      setItems(all => all.filter(a => a.id !== id))
    },
    clear: () => {
      setItems([])
      setProblem(undefined)
    },
    paths: items.flatMap(a => (a.path ? [a.path] : [])),
    uploading: items.some(a => !a.path && !a.error),
    problem,
  }
}

export function PickFiles({
  onPick,
  className = 'inline-flex size-6 flex-none cursor-pointer items-center justify-center rounded-md border-0 bg-transparent text-muted hover:bg-raised-2 hover:text-text',
}: {
  onPick: (files: File[]) => void
  className?: string
}) {
  const t = useI18n()
  const picker = useRef<HTMLInputElement>(null)
  return (
    <>
      <input
        ref={picker}
        type="file"
        multiple
        hidden
        onChange={e => {
          onPick([...(e.target.files ?? [])])
          e.target.value = ''
        }}
      />
      <button
        type="button"
        onClick={() => picker.current?.click()}
        aria-label={t('upload.attach')}
        title={t('upload.attach')}
        className={className}
      >
        <Paperclip size={15} />
      </button>
    </>
  )
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
