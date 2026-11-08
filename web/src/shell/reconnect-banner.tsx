import { Button } from '../components/button'
import { useI18n } from '../core/i18n'
import { useSpace, useSpaceView } from '../core/space'

/** The strip shown while the relay reconnects, with a way to try at once. */
export function ReconnectBanner() {
  const t = useI18n()
  const space = useSpace()
  const { status } = useSpaceView()
  if (status !== 'reconnecting') return null
  return (
    <div className="flex h-9 flex-none items-center gap-3 border-b border-ask-line bg-ask px-5 text-[13px]">
      <span className="flex-1">{t('banner.reconnecting')}</span>
      <Button size="small" onClick={space.reconnectNow}>
        {t('banner.now')}
      </Button>
    </div>
  )
}
