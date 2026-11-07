import { useI18n } from '../core/i18n'

/** What stands in while something loads. */
export function Loading() {
  const t = useI18n()
  return <p className="m-6 text-muted">{t('board.loading')}</p>
}
