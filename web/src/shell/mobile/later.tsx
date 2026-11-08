// Stands in for the pages the next iterations bring.

import { ChevronLeft } from 'lucide-react'
import { useI18n } from '../../core/i18n'
import { PhoneBar, TAP, useBack } from './bar'

export function Later() {
  const t = useI18n()
  const back = useBack()
  return (
    <>
      <PhoneBar>
        <button type="button" onClick={back} aria-label={t('mobile.back')} className={TAP}>
          <ChevronLeft size={22} />
        </button>
      </PhoneBar>
      <p className="m-0 p-4 text-muted">{t('mobile.later')}</p>
    </>
  )
}
