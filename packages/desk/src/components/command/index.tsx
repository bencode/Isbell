import { useState } from 'react'
import { Button } from '../button'

export type CopyLabels = { copy: string; copied: string }

/** A shell command to run elsewhere, with a copy button. */
export function Command({ text, labels }: { text: string; labels: CopyLabels }) {
  const [copied, setCopied] = useState(false)
  const copy = () =>
    navigator.clipboard.writeText(text).then(
      () => setCopied(true),
      err => console.error('could not copy', err),
    )
  return (
    <div className="flex items-center gap-3 rounded-lg border border-line bg-bg py-1.5 pr-1.5 pl-3.5">
      <code className="min-w-0 flex-1 font-mono text-[13px] break-all">{text}</code>
      <Button size="small" className="flex-none" onClick={copy}>
        {copied ? labels.copied : labels.copy}
      </Button>
    </div>
  )
}
