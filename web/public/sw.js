// Isbell's service worker, on an iPhone opened from the home screen: shows what a machine pushes
// (an agent asking or done) and opens its session on a tap. It handles no fetches, so pages load
// as they would without it.

// Takes the pages already open, so a tap can lead one of them to the session.
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()))

self.addEventListener('push', event => {
  const { title, body, tag, url } = event.data.json()
  event.waitUntil(self.registration.showNotification(title, { body, tag, data: { url } }))
})

self.addEventListener('notificationclick', event => {
  event.notification.close()
  const url = event.notification.data?.url ?? '/'
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(windows => {
      const open = windows[0]
      if (!open) return self.clients.openWindow(url)
      return open
        .focus()
        .then(w => w.navigate(url))
        .catch(err => {
          console.error('could not lead the open page to the session', err)
          return self.clients.openWindow(url)
        })
    }),
  )
})
