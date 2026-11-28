// Isbell's service worker, on an iPhone opened from the home screen: shows what a machine pushes
// (an agent asking or done, or a message asking or warning) and opens where it leads on a tap. It
// handles no fetches, so pages load as they would without it.

// Takes the pages already open, so a tap can lead one of them where the push leads.
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()))

self.addEventListener('push', event => {
  const { title, body, tag, url } = event.data.json()
  event.waitUntil(self.registration.showNotification(title, { body, tag, data: { url } }))
})

self.addEventListener('notificationclick', event => {
  event.notification.close()
  const to = event.notification.data?.url
  // Says where it came from: one still waiting for an answer opens where it is answered.
  const url = to ? `${to}${to.includes('?') ? '&' : '?'}from=push` : '/'
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(windows => {
      const open = windows[0]
      if (!open) return self.clients.openWindow(url)
      return open
        .focus()
        .then(w => w.navigate(url))
        .catch(err => {
          console.error('could not lead the open page where the push leads', err)
          return self.clients.openWindow(url)
        })
    }),
  )
})
