// What the tabs show: each stays as it was while another is shown. While the address is on its way to
// a tab, the one shown last stays.

import { Activity, Suspense } from 'react'
import { useI18n } from '../../core/i18n'
import { useTabRoute } from '../../core/tabs'
import { TabPane } from '../../features/tabs/kinds'
import { Loading } from '../common'

export function TabPanes() {
  const t = useI18n()
  const { open, active, recent } = useTabRoute()
  const shown = active ?? recent
  if (!open.length) return <p className="m-auto text-muted">{t('workbench.empty')}</p>
  return (
    <div className="min-h-0 flex-1">
      {open.map(tab => (
        <Activity key={tab.id} mode={tab.id === shown ? 'visible' : 'hidden'}>
          <Suspense fallback={<Loading />}>
            <TabPane id={tab.id} />
          </Suspense>
        </Activity>
      ))}
    </div>
  )
}
