// Tells the user when a session starts asking or finishes: a system notification while Isbell is
// open (in any tab), and the count of what needs them in the tab title.

import { type AgentStatus, needs, type Project, paneKey } from '@isbell/core'
import { useEffect, useRef } from 'react'
import { useNavigate } from 'react-router'
import { useT } from './i18n'
import { useLocal } from './prefs'
import { sessionHref } from './routes'

const NOTIFY_ON: AgentStatus[] = ['blocked', 'done']

export function useNotifications(projects: Project[], loaded: boolean) {
  const t = useT()
  const navigate = useNavigate()
  const { prefs } = useLocal()
  // Last status seen per session; null until the first state is in, so it never notifies at load.
  const last = useRef<Map<string, AgentStatus> | null>(null)

  useEffect(() => {
    const count = needs(projects).length
    document.title = count ? `(${count}) Isbell` : 'Isbell'
  }, [projects])

  useEffect(() => {
    if (!loaded) return
    const sessions = projects.flatMap(p => p.sessions)
    const previous = last.current
    last.current = new Map(sessions.map(s => [paneKey(s.mid, s.paneId), s.status]))
    if (!previous || !prefs.notify || !('Notification' in window) || Notification.permission !== 'granted')
      return
    for (const s of sessions) {
      const before = previous.get(paneKey(s.mid, s.paneId))
      if (before === s.status || !NOTIFY_ON.includes(s.status)) continue
      const n = new Notification(
        t(s.status === 'blocked' ? 'notify.blocked' : 'notify.done', { name: s.name }),
        {
          body: s.title ?? '',
          tag: paneKey(s.mid, s.paneId),
        },
      )
      n.onclick = () => {
        window.focus()
        navigate(sessionHref(s.mid, s.paneId))
        n.close()
      }
    }
  }, [projects, loaded, prefs.notify, t, navigate])
}
