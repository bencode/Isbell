// The rows a tree of files is made of, the project's tree and the search's alike.

import { ChevronDown, ChevronRight, File, FileCode, FileText, Folder } from 'lucide-react'
import type { ReactNode } from 'react'
import { Link } from 'react-router'
import { kindOf } from '../../model/files/content'

const ROW =
  'flex h-[26px] w-full min-w-0 items-center gap-1.5 rounded-md pr-2 text-left text-[13px] no-underline text-text hover:bg-raised-2'

/** How far a row at `depth` is set in. */
export const indent = (depth: number) => ({ paddingLeft: 6 + depth * 14 })

const ICONS = { markdown: FileText, html: FileCode, text: File }

export function FolderRow({
  depth,
  open,
  onToggle,
  label,
  extra,
  title,
}: {
  depth: number
  open: boolean
  onToggle: () => void
  label: ReactNode
  extra?: ReactNode
  /** Shown on hover, for a name cut short. */
  title?: string
}) {
  const Chevron = open ? ChevronDown : ChevronRight
  return (
    <button
      type="button"
      className={`${ROW} cursor-pointer border-0 bg-transparent`}
      style={indent(depth)}
      title={title}
      onClick={onToggle}
    >
      <Chevron size={13} className="flex-none text-faint" />
      <Folder size={14} className="flex-none text-muted" />
      <span className="truncate">{label}</span>
      {extra}
    </button>
  )
}

export function FileRow({
  depth,
  name,
  to,
  on,
  label,
  extra,
  title,
}: {
  depth: number
  name: string
  to: string
  /** The file being read. */
  on: boolean
  label: ReactNode
  extra?: ReactNode
  /** Shown on hover, for a name cut short. */
  title?: string
}) {
  const Icon = ICONS[kindOf(name)]
  return (
    <Link
      to={to}
      aria-current={on ? 'page' : undefined}
      title={title}
      className={`${ROW} ${on ? 'bg-accent-soft' : ''}`}
      // The chevron's room, so names line up with folders'.
      style={{ paddingLeft: indent(depth).paddingLeft + 19 }}
    >
      <Icon size={14} className="flex-none text-faint" />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {extra}
    </Link>
  )
}
