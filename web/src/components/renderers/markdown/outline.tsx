// The headings of a rendered document, to jump between; the one being read follows the scroll.
// Beside the document where there is room, or over it, closing on Esc or after a jump, where not.

import { useEffect, useRef, useState } from 'react'

export type Heading = { el: HTMLElement; text: string; level: number }

export type OutlineLayout = 'beside' | 'over'

/** A heading counts as being read once it is this close to the top. */
const READING_PX = 24

/** The headings in `root` (rehype-slug gave them ids, so links can reach them too). */
export const headingsIn = (root: HTMLElement): Heading[] =>
  [...root.querySelectorAll<HTMLElement>('h1, h2, h3, h4, h5, h6')].map(el => ({
    el,
    text: el.textContent?.trim() || '—',
    level: Number(el.tagName[1]),
  }))

type Props = {
  headings: Heading[]
  scroller: HTMLElement | null
  layout: OutlineLayout
  labels: { outline: string; close: string }
  onClose: () => void
}

export function Outline({ headings, scroller, layout, labels, onClose }: Props) {
  const nav = useRef<HTMLElement>(null)
  const [active, setActive] = useState<Heading>()
  useEffect(() => {
    if (!scroller) return
    const follow = () => {
      const top = scroller.getBoundingClientRect().top + READING_PX
      setActive(headings.filter(h => h.el.getBoundingClientRect().top <= top).at(-1) ?? headings[0])
    }
    follow()
    scroller.addEventListener('scroll', follow, { passive: true })
    return () => scroller.removeEventListener('scroll', follow)
  }, [scroller, headings])

  // Over the document, it takes focus as it opens, and Esc closes it wherever focus is.
  useEffect(() => {
    if (layout === 'over') nav.current?.querySelector<HTMLElement>('[aria-current], button')?.focus()
  }, [layout])
  useEffect(() => {
    if (layout !== 'over') return
    const close = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      e.stopPropagation()
      onClose()
    }
    document.addEventListener('keydown', close, true)
    return () => document.removeEventListener('keydown', close, true)
  }, [layout, onClose])

  const top = Math.min(...headings.map(h => h.level))
  const list = (
    <nav
      ref={nav}
      aria-label={labels.outline}
      className={`flex w-[240px] flex-none flex-col gap-0.5 overflow-y-auto py-6 pr-3 pl-2 ${layout === 'over' ? 'absolute inset-y-0 right-0 z-10 border-l border-line bg-raised index-card-lifted' : ''}`}
    >
      <span className="px-2 pb-1 text-[11px] font-semibold tracking-[0.04em] text-faint uppercase">
        {labels.outline}
      </span>
      {headings.map(h => (
        <button
          key={h.el.id || h.text}
          type="button"
          onClick={() => {
            h.el.scrollIntoView({
              behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
            })
            if (layout === 'over') onClose()
          }}
          aria-current={h === active ? 'location' : undefined}
          className={`cursor-pointer truncate rounded-md border-0 bg-transparent py-0.5 pr-2 text-left text-[12.5px] hover:bg-raised-2 ${h === active ? 'text-accent' : 'text-muted'}`}
          style={{ paddingLeft: 8 + (h.level - top) * 12 }}
          title={h.text}
        >
          {h.text}
        </button>
      ))}
    </nav>
  )
  if (layout === 'beside') return list
  return (
    <>
      <button
        type="button"
        aria-label={labels.close}
        onClick={onClose}
        className="absolute inset-0 z-10 cursor-default border-0 bg-scrim/40"
      />
      {list}
    </>
  )
}
