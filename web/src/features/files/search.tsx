// Finding a file by part of its path: typed into the tree's box, asked of the machine once typing
// pauses, and shown in place of the tree.

import { Search } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { errorText, useI18n } from '../../core/i18n'
import type { Project } from '../../model/projects'
import { useSearch } from './use-remote'

const PAUSE_MS = 300

/** The search box; `onQuery` hears the trimmed text once typing pauses, and '' when it is cleared. */
export function SearchBox({ onQuery }: { onQuery: (query: string) => void }) {
  const t = useI18n()
  const [text, setText] = useState('')
  useEffect(() => {
    const timer = setTimeout(() => onQuery(text.trim()), PAUSE_MS)
    return () => clearTimeout(timer)
  }, [text, onQuery])
  return (
    <label className="flex h-[30px] items-center gap-1.5 rounded-md border border-line bg-raised px-2 focus-within:border-accent">
      <Search size={13} className="flex-none text-faint" />
      <input
        type="search"
        value={text}
        onChange={e => setText(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Escape') setText('')
        }}
        // The machine takes up to 200 characters.
        maxLength={200}
        placeholder={t('files.search')}
        aria-label={t('files.search')}
        className="min-w-0 flex-1 border-0 bg-transparent text-[13px] outline-none"
      />
    </label>
  )
}

export function SearchResults({
  where: { mid, project, current, hrefOf },
  query,
}: {
  where: { mid: string; project: Project; current: string; hrefOf: (rel: string) => string }
  query: string
}) {
  const t = useI18n()
  const { data, error } = useSearch(mid, project.path, query)
  if (error) return <p className="m-0 px-1.5 py-1 text-[12.5px] text-danger">{errorText(t, error)}</p>
  if (!data) return <p className="m-0 px-1.5 py-1 text-[12.5px] text-faint">{t('files.searching')}</p>
  if (!data.paths.length)
    return <p className="m-0 px-1.5 py-1 text-[12.5px] text-faint">{t('files.noMatch')}</p>
  return (
    <>
      {data.paths.map(rel => (
        <Link
          key={rel}
          to={hrefOf(rel)}
          aria-current={rel === current ? 'page' : undefined}
          className={`block truncate rounded-md px-1.5 py-1 font-mono text-[12px] text-text no-underline hover:bg-raised-2 ${rel === current ? 'bg-accent-soft' : ''}`}
          title={rel}
        >
          {rel}
        </Link>
      ))}
      {data.truncated ? (
        <p className="m-0 px-1.5 py-1 text-[12px] text-faint">
          {t('files.moreMatches', { n: data.paths.length })}
        </p>
      ) : null}
    </>
  )
}
