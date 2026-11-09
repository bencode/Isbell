// A page left open across a release asks for chunks the release removed. Loading the release is the
// way out, and for an app kept on a phone's home screen it is the usual case.

const RELOADED_AT = 'isbell.reloaded-for-chunk'
/** A chunk that is still missing right after a reload is not a release: the error takes its course. */
const QUIET_MS = 30_000

export function reloadWhenChunksAreGone() {
  window.addEventListener('vite:preloadError', event => {
    const last = Number(sessionStorage.getItem(RELOADED_AT) ?? 0)
    if (!navigator.onLine || Date.now() - last < QUIET_MS) return
    sessionStorage.setItem(RELOADED_AT, String(Date.now()))
    event.preventDefault()
    window.location.reload()
  })
}
