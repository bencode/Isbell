// The views of one thing, as links in a segmented row: a pane's chat, terminal and files, or a
// project's overview and files.

import type { ReactNode } from 'react'
import { Link } from 'react-router'

const VIEW =
  'inline-flex h-[30px] items-center gap-1.5 rounded-md px-3 text-[13px] font-medium no-underline focus-visible:outline-2 focus-visible:outline-accent'

type View = { key: string; href: string; icon: ReactNode; label: string }

export function ViewTabs({ label, views, current }: { label: string; views: View[]; current: string }) {
  return (
    <nav
      aria-label={label}
      className="inline-flex flex-none gap-0.5 rounded-lg border border-line bg-bg p-0.5"
    >
      {views.map(v => (
        <Link
          key={v.key}
          to={v.href}
          aria-current={v.key === current ? 'page' : undefined}
          className={`${VIEW} ${v.key === current ? 'index-card bg-raised text-text' : 'text-muted hover:text-text'}`}
        >
          {v.icon}
          {v.label}
        </Link>
      ))}
    </nav>
  )
}
