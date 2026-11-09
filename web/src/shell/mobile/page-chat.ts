// A chat that scrolls with the page on a phone: it goes back to its place as it shows again, opens at
// its end, and stays where it is as earlier turns come in above.

import { useEffect, useLayoutEffect, useRef } from 'react'
import type { ChatLog } from '../../core/chat-log'
import { useChatFollow } from '../../features/session/use-chat-follow'

const PAGE = { current: document.documentElement }

export function usePageChat(log: ChatLog, asking: boolean) {
  // Put back as the chat shows again from behind the terminal, before it goes to the end if left there.
  const place = useRef(0)
  useLayoutEffect(() => {
    PAGE.current.scrollTop = place.current
  }, [])
  const follow = useChatFollow(PAGE, log, asking)
  const { onScrolled } = follow
  useEffect(() => {
    const scrolled = () => {
      place.current = PAGE.current.scrollTop
      onScrolled()
    }
    window.addEventListener('scroll', scrolled, { passive: true })
    return () => window.removeEventListener('scroll', scrolled)
  }, [onScrolled])

  // Safari does not hold the page still when turns come in above what is read, so the distance from
  // the end is held here.
  const fromEnd = useRef<number>(undefined)
  const earlier = () => {
    fromEnd.current = PAGE.current.scrollHeight - PAGE.current.scrollTop
    log.earlier()
  }
  useLayoutEffect(() => {
    if (fromEnd.current === undefined || log.paging) return
    PAGE.current.scrollTop = PAGE.current.scrollHeight - fromEnd.current
    fromEnd.current = undefined
  }, [log.paging])

  return { follow, earlier }
}
