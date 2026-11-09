// Tells the user when a session starts asking or finishes a long run, unless it is in front of them:
// a system notification while Isbell is open (in any tab), and the count of what needs them in the
// tab title. A phone has its pushes for that, which reach it with Isbell open too.

import { useEffect, useRef } from 'react'
import { useNavigate } from 'react-router'
import { useI18n } from '../core/i18n'
import { useLocal } from '../core/prefs'
import { type Seen, showsSession, worthTelling } from '../model/notices'
import { needs, type Project, paneKey } from '../model/projects'
import { PHONE } from '../utils/phone'
import { sessionTabHref } from './workbench/tab-kinds'

export function useNotifications(projects: Project[], loaded: boolean) {
  const t = useI18n()
  const navigate = useNavigate()
  const { prefs } = useLocal()
  // How each session last stood; null until the first state is in, so it never notifies at load.
  const last = useRef<Map<string, Seen> | null>(null)

  useEffect(() => {
    const count = needs(projects).length
    document.title = count ? `(${count}) Isbell` : 'Isbell'
  }, [projects])

  useEffect(() => {
    if (!loaded) return
    const sessions = projects.flatMap(p => p.sessions.map(s => ({ ...s, project: p.key })))
    const previous = last.current
    last.current = new Map(sessions.map(s => [paneKey(s.mid, s.paneId), s]))
    if (
      PHONE ||
      !previous ||
      !prefs.notify ||
      !('Notification' in window) ||
      Notification.permission !== 'granted'
    )
      return
    for (const s of sessions) {
      if (!worthTelling(previous.get(paneKey(s.mid, s.paneId)), s)) continue
      if (document.hasFocus() && showsSession(window.location.search, s.mid, s.paneId)) continue
      const n = new Notification(
        t(s.status === 'blocked' ? 'notify.blocked' : 'notify.done', { name: s.name }),
        {
          body: s.title ?? '',
          tag: paneKey(s.mid, s.paneId),
        },
      )
      n.onclick = () => {
        window.focus()
        navigate(sessionTabHref(s.project, s.mid, s.paneId))
        n.close()
      }
    }
  }, [projects, loaded, prefs.notify, t, navigate])
}
