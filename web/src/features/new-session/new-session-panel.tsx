// New: in a project or in a directory that is not one yet, an agent to chat with, given a real task,
// or a terminal, with an agent in it or a plain shell. Starting there is what makes the directory a
// project. Replying to a running session happens on its page.

import { useNavigate } from 'react-router'
import { Button } from '../../components/button'
import { SidePanel } from '../../components/panel'
import { useI18n } from '../../core/i18n'
import { NewSessionFields } from './fields'
import { useNewSession } from './use-new-session'

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  focusedKey: string | undefined
  /** Open on a new directory rather than on the projects there are. */
  newDir: boolean
}

export function NewSession({ open, ...props }: Props) {
  // Mounted only while open, so each opening starts from the focused project.
  return open ? <Form {...props} /> : null
}

function Form({ onOpenChange, focusedKey, newDir }: Omit<Props, 'open'>) {
  const t = useI18n()
  const navigate = useNavigate()
  const form = useNewSession({
    focusedKey,
    newDir,
    onStarted: (next, chat) => {
      onOpenChange(false)
      // A chat joins the board, which stays where it is; a terminal opens to work in, and a task that
      // did not reach the agent shows on its page.
      if (!chat || next.state?.promptError) navigate(next.href, { state: next.state })
    },
  })
  // What was asked for is already starting on the machine; the panel stays until it is.
  const close = (open: boolean) => {
    if (!form.busy) onOpenChange(open)
  }
  return (
    <SidePanel
      open
      onOpenChange={close}
      title={t('ns.title')}
      closeLabel={t('close')}
      footer={
        <>
          <span
            className={`min-w-0 flex-1 truncate text-[13px] ${form.error ? 'text-danger' : 'text-muted'}`}
          >
            {form.status}
          </span>
          <Button variant="quiet" onClick={() => close(false)} disabled={form.busy}>
            {t('cancel')}
          </Button>
          <Button variant="primary" onClick={form.start} disabled={!form.ready || form.busy}>
            {form.goLabel}
            {form.chat ? <span className="font-mono text-[11px] opacity-70">↵</span> : null}
          </Button>
        </>
      }
    >
      <NewSessionFields form={form} />
    </SidePanel>
  )
}
