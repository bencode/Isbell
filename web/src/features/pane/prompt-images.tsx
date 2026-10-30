// The images sent with a prompt, read back from the agent's machine where they were uploaded.

import { Paperclip } from 'lucide-react'
import { useMemo, useState } from 'react'
import { imageType } from '../../model/files/content'
import { nameOf } from '../../model/files/paths'
import { useObjectUrl } from '../../utils/object-url'
import { useFile } from '../files/use-remote'

export function PromptImages({ mid, paths }: { mid: string; paths: string[] }) {
  return (
    <div className="flex flex-wrap gap-2">
      {paths.map(path => (
        <UploadedImage key={path} mid={mid} path={path} />
      ))}
    </div>
  )
}

/** A thumbnail growing to its full width on a tap; its name where it cannot be read, such as once
 * the machine's temporary directory is cleared or past the preview's size, or where the browser
 * cannot show it, as with a HEIC photo outside Safari. */
function UploadedImage({ mid, path }: { mid: string; path: string }) {
  const { data, error } = useFile(mid, path)
  const bytes = data?.bytes
  const blob = useMemo(
    () => (bytes ? new Blob([bytes], { type: imageType(path) ?? '' }) : undefined),
    [bytes, path],
  )
  const src = useObjectUrl(blob)
  const [open, setOpen] = useState(false)
  const [broken, setBroken] = useState(false)
  const name = nameOf(path)
  if (error || (data && !bytes) || broken)
    return (
      <span
        title={path}
        className="inline-flex max-w-64 items-center gap-1.5 rounded-md border border-line bg-bg px-2 py-0.5 text-[12px] text-muted"
      >
        <Paperclip size={12} className="flex-none opacity-60" />
        <span className="min-w-0 truncate">{name}</span>
      </span>
    )
  if (!src) return <span className="block h-28 w-28 rounded-md bg-raised-2" />
  return (
    <button
      type="button"
      onClick={() => setOpen(o => !o)}
      aria-expanded={open}
      className={`cursor-zoom-in overflow-hidden rounded-md border border-line bg-bg p-0 focus-visible:outline-2 focus-visible:outline-accent ${open ? 'w-full cursor-zoom-out' : ''}`}
    >
      <img
        src={src}
        alt={name}
        title={path}
        onError={() => setBroken(true)}
        className={open ? 'block h-auto w-full' : 'block h-28 w-auto max-w-56 object-cover'}
      />
    </button>
  )
}
