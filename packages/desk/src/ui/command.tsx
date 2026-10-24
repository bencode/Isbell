import { useState } from 'react'
import { useT } from '../i18n'
import { Button } from './button'
import { Modal } from './dialog'

/** `value` as one shell word, quoted only when it needs to be. */
export const shellArg = (value: string) =>
  /^[\w@%+=:,./~-]+$/.test(value) ? value : `'${value.replaceAll("'", `'\\''`)}'`

/** A shell command to run elsewhere, with a copy button. */
export function Command({ text }: { text: string }) {
  const t = useT()
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
        {copied ? t('copied') : t('copy')}
      </Button>
    </div>
  )
}

/** Terminals in the browser come later; until then, the command to open one in your own. */
export function CommandModal({
  title,
  command,
  onClose,
}: {
  title: string
  command: string | null
  onClose: () => void
}) {
  const t = useT()
  return (
    <Modal open={command !== null} onOpenChange={open => !open && onClose()} title={title}>
      <p className="m-0 text-muted">{t('terminal.body')}</p>
      {command ? <Command text={command} /> : null}
    </Modal>
  )
}
