// The preview origin's worker: every request a page makes under /p/<token>/ is answered with the
// file at that path under its project's root, as the bridge that opened it reads it from the app.
// The bytes go back as they are; only the headers are added.

// What a page may reach: its own files, and https resources such as libraries, fonts and images
// from a CDN. fetch and its kin reach only its own files.
const POLICY = [
  "default-src 'self' https: data: blob:",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' https: blob:",
  "style-src 'self' 'unsafe-inline' https:",
  "connect-src 'self'",
  "form-action 'none'",
  "object-src 'none'",
  "base-uri 'self'",
].join('; ')

self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()))

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url)
  const [, prefix, token, ...rest] = url.pathname.split('/')
  if (url.origin !== location.origin || prefix !== 'p' || !token) return
  e.respondWith(answer(token, rest.map(decodeURIComponent).join('/')))
})

async function answer(token, rel) {
  const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
  const bridge = windows.find(w => {
    const at = new URL(w.url)
    return at.pathname === '/host.html' && at.searchParams.get('t') === token
  })
  if (!bridge) return new Response('This preview has closed.', { status: 503 })
  const { port1, port2 } = new MessageChannel()
  const file = new Promise(resolve => {
    port1.onmessage = e => resolve(e.data)
  })
  bridge.postMessage({ rel }, [port2])
  const { status, type, bytes } = await file
  const headers = { 'content-security-policy': POLICY, ...(type ? { 'content-type': type } : {}) }
  return new Response(bytes ?? null, { status, headers })
}
