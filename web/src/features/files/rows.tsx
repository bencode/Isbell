// The rows a tree of files is made of, the project's tree and the search's alike.

import {
  ChevronDown,
  ChevronRight,
  File,
  FileBraces,
  FileCode,
  FileCog,
  FileImage,
  FileLock,
  FileTerminal,
  FileText,
  Folder,
  FolderOpen,
  Workflow,
} from 'lucide-react'
import type { CSSProperties, ReactNode } from 'react'
import { Link } from 'react-router'
import { extensionOf, imageType } from '../../model/files/content'

const ROW =
  'flex h-[26px] w-full min-w-0 items-center gap-1.5 rounded-md pr-2 text-left text-[13px] no-underline text-text transition-colors duration-75 hover:bg-hover active:bg-press focus-visible:outline-2 focus-visible:outline-accent'

const LEVEL = 14

/** How far a row at `depth` is set in. */
export const indent = (depth: number) => ({ paddingLeft: 6 + depth * LEVEL })

/** A line down each level a row is set in by, under the chevrons of the folders it is inside. */
const guides = (depth: number): CSSProperties =>
  depth === 0
    ? {}
    : {
        backgroundImage: `repeating-linear-gradient(to right, var(--line) 0 1px, transparent 1px ${LEVEL}px)`,
        backgroundPosition: '12px 0',
        backgroundSize: `${depth * LEVEL}px 100%`,
        backgroundRepeat: 'no-repeat',
      }

const ICONS = new Map(
  (
    [
      [FileCode, 'ts tsx js jsx mjs rs py go css scss html htm'],
      [FileBraces, 'json'],
      [FileText, 'md markdown txt'],
      [FileLock, 'lock'],
      [FileTerminal, 'sh zsh bash'],
      [FileCog, 'toml yml yaml .gitignore .dockerignore'],
      [Workflow, 'mmd mermaid'],
    ] as const
  ).flatMap(([icon, names]) => names.split(' ').map(name => [name, icon] as const)),
)

const iconOf = (name: string) => (imageType(name) ? FileImage : (ICONS.get(extensionOf(name)) ?? File))

/** A name that starts with a dot stays in the list, but steps back. */
const hidden = (name: string) => name.startsWith('.')

export function FolderRow({
  depth,
  name,
  open,
  onToggle,
  label,
  title,
}: {
  depth: number
  name: string
  open: boolean
  onToggle: () => void
  label: ReactNode
  /** Shown on hover, for a name cut short. */
  title?: string
}) {
  const Chevron = open ? ChevronDown : ChevronRight
  const Icon = open ? FolderOpen : Folder
  const back = hidden(name)
  return (
    <button
      type="button"
      className={`${ROW} cursor-pointer border-0 bg-transparent`}
      style={{ ...indent(depth), ...guides(depth) }}
      title={title}
      onClick={onToggle}
    >
      <Chevron size={13} className="flex-none text-faint" />
      <Icon size={14} className={`flex-none text-muted ${back ? 'opacity-65' : ''}`} />
      <span className={`truncate ${back ? 'text-faint' : ''}`}>{label}</span>
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
  onDoubleClick,
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
  onDoubleClick?: () => void
}) {
  const Icon = iconOf(name)
  const back = hidden(name)
  return (
    <Link
      to={to}
      aria-current={on ? 'page' : undefined}
      title={title}
      onDoubleClick={onDoubleClick}
      className={`${ROW} ${on ? 'bg-selected' : ''}`}
      // The chevron's room, so names line up with folders'.
      style={{ ...guides(depth), paddingLeft: indent(depth).paddingLeft + 19 }}
    >
      <Icon size={14} className={`flex-none text-faint ${back ? 'opacity-65' : ''}`} />
      <span className={`min-w-0 flex-1 truncate ${back ? 'text-faint' : ''}`}>{label}</span>
      {extra}
    </Link>
  )
}
