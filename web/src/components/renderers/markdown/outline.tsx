// The headings of a rendered document, to jump between; the one being read follows the scroll.

import { useEffect, useState } from 'react'

export type Heading = { el: HTMLElement; text: string; level: number }

/** A heading counts as being read once it is this close to the top. */
const READING_PX = 24

/** The headings in `root` (rehype-slug gave them ids, so links can reach them too). */
export const headingsIn = (root: HTMLElement): Heading[] =>
  [...root.querySelectorAll<HTMLElement>('h1, h2, h3, h4, h5, h6')].map(el => ({
    el,
    text: el.textContent?.trim() || '—',
    level: Number(el.tagName[1]),
  }))

export function Outline({
  headings,
  scroller,
  label,
}: {
  headings: Heading[]
  scroller: HTMLElement | null
  label: string
}) {
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

  const top = Math.min(...headings.map(h => h.level))
  return (
    <nav
      aria-label={label}
      className="sticky top-0 flex w-[220px] flex-none flex-col gap-0.5 self-start py-6 pr-4"
    >
      <span className="px-2 pb-1 text-[11px] font-semibold tracking-[0.04em] text-faint uppercase">
        {label}
      </span>
      {headings.map(h => (
        <button
          key={h.el.id || h.text}
          type="button"
          onClick={() => h.el.scrollIntoView()}
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
}
