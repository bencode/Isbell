// The bar over a page on a phone, which stays as the page scrolls, and the way back from one.

import { ChevronLeft } from 'lucide-react'
import type { ReactNode } from 'react'
import { useNavigate } from 'react-router'
import { useI18n } from '../../core/i18n'
import { ReconnectBanner } from '../reconnect-banner'

/** A button that is only an icon, a finger's size. */
export const TAP =
  'inline-grid size-11 flex-none cursor-pointer place-items-center rounded-[10px] border-0 bg-transparent p-0 text-muted active:bg-press'

/** `under`: a row below the bar that stays with it. */
export function PhoneBar({ children, under }: { children: ReactNode; under?: ReactNode }) {
  return (
    <header className="sticky top-0 z-10 border-b border-line bg-bg pt-[env(safe-area-inset-top)]">
      <div className="flex h-[52px] items-center gap-0.5 px-1.5">{children}</div>
      {under}
      <ReconnectBanner />
    </header>
  )
}

/** Back where it came from; a page opened straight, from a notification say, goes home. By the
 * router's place in the history, which stays as the address is replaced where `location.key` does
 * not. */
export function useBack() {
  const navigate = useNavigate()
  return () => {
    if (window.history.state?.idx === 0) void navigate('/', { replace: true })
    else void navigate(-1)
  }
}

/** What a page is, and under it where. */
export function BarTitle({ title, where }: { title: ReactNode; where: ReactNode }) {
  return (
    <div className="min-w-0 flex-1">
      <b className="block truncate text-[14.5px] leading-tight font-semibold">{title}</b>
      <span className="block truncate text-[11.5px] leading-tight text-faint">{where}</span>
    </div>
  )
}

export function BackButton() {
  const t = useI18n()
  const back = useBack()
  return (
    <button type="button" onClick={back} aria-label={t('mobile.back')} className={TAP}>
      <ChevronLeft size={22} />
    </button>
  )
}
