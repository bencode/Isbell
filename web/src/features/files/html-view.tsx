// An HTML file, such as a design draft, run in a sandbox. Its scripts run (drafts switch themes,
// say) but without same-origin it is an opaque origin: it cannot reach this page, its storage, or
// the space key in it.

import { useI18n } from '../../core/i18n'

export function HtmlView({ html }: { html: string }) {
  const t = useI18n()
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <p className="m-0 border-b border-line px-5 py-1.5 text-[12px] text-faint">{t('files.sandboxed')}</p>
      <iframe
        title={t('files.preview')}
        sandbox="allow-scripts"
        referrerPolicy="no-referrer"
        srcDoc={html}
        className="min-h-0 w-full flex-1 border-0 bg-white"
      />
    </div>
  )
}
