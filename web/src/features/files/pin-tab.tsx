// Keeps the file read in the project's files in a tab of its own, pinned, while the files stay
// shown; once it is, the way to its tab.

import { Pin } from 'lucide-react'
import { Link } from 'react-router'
import { Button, buttonClass } from '../../components/button'
import { useI18n } from '../../core/i18n'
import { usePinned, useTabActions } from '../../core/tabs'

/** `id`: the file's tab. */
export function PinTab({ id }: { id: string }) {
  const t = useI18n()
  const { href, keep } = useTabActions()
  const pinned = usePinned(id)
  if (pinned)
    return (
      <Link to={href(id)} title={t('files.showTab')} className={buttonClass('quiet', '', 'small')}>
        <Pin size={14} className="text-accent" />
        {t('files.pinned')}
      </Link>
    )
  return (
    <Button
      size="icon"
      variant="quiet"
      onClick={() => keep(id)}
      aria-label={t('files.pin')}
      title={t('files.pin')}
    >
      <Pin size={14} />
    </Button>
  )
}
