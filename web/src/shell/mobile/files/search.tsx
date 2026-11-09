// Finding on a phone: a box a finger can use, and the files found, each name over where it is.

import { Search, X } from 'lucide-react'
import { Link } from 'react-router'
import { errorText, useI18n } from '../../../core/i18n'
import { useSearch } from '../../../core/remote-files'
import { Hits } from '../../../features/files/search'
import { dirOf, nameOf } from '../../../model/files/paths'
import type { FilesRoot } from '../../../model/files/worktrees'
import { projectFilesHref } from '../../../utils/hrefs'

const NOTE = 'm-0 px-2 py-2 text-[13px]'

export function SearchField({
  value,
  onChange,
  placeholder,
}: {
  value: string
  onChange: (value: string) => void
  placeholder: string
}) {
  const t = useI18n()
  return (
    <label className="flex h-11 min-w-0 flex-1 items-center gap-[7px] rounded-[10px] border border-line-strong bg-raised pl-2.5 focus-within:border-accent">
      <Search size={16} className="flex-none text-faint" />
      <input
        type="search"
        value={value}
        onChange={e => onChange(e.target.value)}
        // The machine takes up to 200 characters.
        maxLength={200}
        placeholder={placeholder}
        aria-label={placeholder}
        // At 16px iOS does not zoom the page in on it.
        className="min-w-0 flex-1 border-0 bg-transparent text-base outline-none [&::-webkit-search-cancel-button]:hidden"
      />
      {value ? (
        <button
          type="button"
          onClick={() => onChange('')}
          aria-label={t('sessions.clear')}
          className="grid size-11 flex-none cursor-pointer place-items-center border-0 bg-transparent p-0 text-faint"
        >
          <X size={16} />
        </button>
      ) : null}
    </label>
  )
}

export function SearchResults({ mid, root, query }: { mid: string; root: FilesRoot; query: string }) {
  const t = useI18n()
  const { data, error } = useSearch(mid, root.path, query)
  if (error) return <p className={`${NOTE} text-danger`}>{errorText(t, error)}</p>
  if (!data) return <p className={`${NOTE} text-faint`}>{t('files.searching')}</p>
  if (!data.paths.length) return <p className={`${NOTE} text-faint`}>{t('files.noMatch')}</p>
  return (
    <>
      <div className="mt-1 overflow-hidden rounded-[11px] border border-line bg-raised">
        {data.paths.map(rel => (
          <Link
            key={rel}
            to={projectFilesHref(root.key, rel)}
            className="block min-h-14 border-t border-line px-[13px] py-[7px] text-text no-underline first:border-t-0 active:bg-press"
          >
            <b className="block truncate text-[15px] leading-[1.3] font-medium">
              <Hits text={nameOf(rel)} query={query} />
            </b>
            <span className="block truncate font-mono text-[11.5px] text-faint">
              <Hits text={dirOf(rel)} query={query} />
            </span>
          </Link>
        ))}
      </div>
      {data.truncated ? (
        <p className={`${NOTE} text-faint`}>{t('files.moreMatches', { n: data.paths.length })}</p>
      ) : null}
    </>
  )
}
