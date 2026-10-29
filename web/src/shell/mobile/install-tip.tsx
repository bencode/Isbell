// How to add Isbell to an iPhone's home screen, shown in Safari until dismissed. Safari has no prompt
// of its own for it, so it takes words.

import { X } from 'lucide-react'
import { useI18n } from '../../core/i18n'
import { dismissInstallTip, useLocal } from '../../core/prefs'

/** Safari on an iPhone, not opened from the home screen: only iOS has `navigator.standalone`. */
const inSafari = 'standalone' in navigator && navigator.standalone === false

export function InstallTip() {
  const t = useI18n()
  const { installTip } = useLocal().layout
  if (!inSafari || !installTip) return null
  return (
    <p className="m-0 flex flex-none items-start gap-2 rounded-lg bg-accent-soft py-2 pr-1 pl-3 text-[13px]">
      <span className="flex-1 py-0.5">{t('install.tip')}</span>
      <button
        type="button"
        onClick={dismissInstallTip}
        aria-label={t('close')}
        className="inline-flex size-8 flex-none cursor-pointer items-center justify-center rounded-md border-0 bg-transparent text-faint active:bg-raised-2 focus-visible:outline-2 focus-visible:outline-accent"
      >
        <X size={16} />
      </button>
    </p>
  )
}
