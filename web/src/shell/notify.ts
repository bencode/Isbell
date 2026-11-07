// Tells the user when a session starts asking or finishes: a system notification while Isbell is
// open (in any tab), and the count of what needs them in the tab title.

import { useEffect, useRef } from 'react'
import { useNavigate } from 'react-router'
import { useI18n } from '../core/i18n'
import { useLocal } from '../core/prefs'
import { needs, type Project, paneKey } from '../model/projects'
import type { AgentStatus } from '../model/state'
import { projectHref } from '../utils/hrefs'

const NOTIFY_ON: AgentStatus[] = ['blocked', 'done']

export function useNotifications(projects: Project[], loaded: boolean) {
  const t = useI18n()
  const navigate = useNavigate()
  const { prefs, projectAt } = useLocal()
  // Last status seen per session; null until the first state is in, so it never notifies at load.
  const last = useRef<Map<string, AgentStatus> | null>(null)

  useEffect(() => {
    const count = needs(projects).length
    document.title = count ? `(${count}) Isbell` : 'Isbell'
  }, [projects])

  useEffect(() => {
    if (!loaded) return
    const sessions = projects.flatMap(p => p.sessions.map(s => ({ ...s, project: p.key })))
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
        // Where its project was left, until a session opens in a tab of its own.
        navigate(projectAt[s.project] ?? projectHref(s.project))
        n.close()
      }
    }
  }, [projects, loaded, prefs.notify, projectAt, t, navigate])
}
