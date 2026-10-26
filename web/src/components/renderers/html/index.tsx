// An HTML page, such as a design draft, run in a sandbox. Its scripts run (drafts switch themes,
// say) but without same-origin it is an opaque origin: it cannot reach the page around it, its
// storage, or the space key in it.

export function HtmlRenderer({ html, title }: { html: string; title: string }) {
  return (
    <iframe
      title={title}
      sandbox="allow-scripts"
      referrerPolicy="no-referrer"
      srcDoc={html}
      className="min-h-0 w-full flex-1 border-0 bg-white"
    />
  )
}
