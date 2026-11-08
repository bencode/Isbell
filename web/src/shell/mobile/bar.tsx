// The bar over a page on a phone, which stays as the page scrolls, and the way back from one.

import type { ReactNode } from 'react'
import { useLocation, useNavigate } from 'react-router'
import { ReconnectBanner } from '../reconnect-banner'

/** A button that is only an icon, a finger's size. */
export const TAP =
  'inline-grid size-11 flex-none cursor-pointer place-items-center rounded-[10px] border-0 bg-transparent p-0 text-muted active:bg-press'

export function PhoneBar({ children }: { children: ReactNode }) {
  return (
    <header className="sticky top-0 z-10 border-b border-line bg-bg pt-[env(safe-area-inset-top)]">
      <div className="flex h-[52px] items-center gap-0.5 px-1.5">{children}</div>
      <ReconnectBanner />
    </header>
  )
}

/** Back where it came from; a page opened straight, from a notification say, goes home. */
export function useBack() {
  const { key } = useLocation()
  const navigate = useNavigate()
  return () => {
    if (key === 'default') void navigate('/', { replace: true })
    else void navigate(-1)
  }
}
