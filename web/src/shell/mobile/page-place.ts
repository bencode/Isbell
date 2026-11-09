// Where a page that scrolls was left, for coming back to it.

import { useLayoutEffect } from 'react'
import { useNavigationType } from 'react-router'

const left = new Map<string, number>()

/** Back at the spot `page` was left, opened anew at the top. What it lists must be in memory already,
 * for there to be something to scroll to at once. */
export function usePlaceKept(page: string) {
  const how = useNavigationType()
  useLayoutEffect(() => {
    window.scrollTo(0, how === 'POP' ? (left.get(page) ?? 0) : 0)
    const remember = () => {
      left.set(page, window.scrollY)
    }
    window.addEventListener('scroll', remember, { passive: true })
    return () => window.removeEventListener('scroll', remember)
  }, [how, page])
}
