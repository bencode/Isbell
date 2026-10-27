// A new directory to start in, typed with help from the machine: its subdirectories as suggestions,
// Tab completing like a shell's, and the usual places a click away.

import { Autocomplete } from '@base-ui/react/autocomplete'
import { useEffect, useRef, useState } from 'react'
import { Button } from '../../components/button'
import { useI18n } from '../../core/i18n'
import { useProjects, useSpace } from '../../core/space'
import {
  commonPrefix,
  completions,
  describeDir,
  frequentParents,
  splitTyped,
} from '../../model/files/complete'
import { type Entry, type Listing, list } from '../../model/files/remote'
import { expandHome, judgeDir, projectsAt } from '../../model/projects'
import { CallError } from '../../model/streams'

/** At most this many suggestions show. */
const SHOWN = 50

type DirListing = { dir: string; listing?: Listing; missing?: boolean }

type Note = { text: string; tone: 'danger' | 'warn' | 'muted' }

/** A new directory typed for machine `mid`: what the machine says of it, the directory to start in
 * once it is a full path that is there, and the line to show under it. */
export function useNewDir(mid: string, typed: string, helps: boolean) {
  const t = useI18n()
  const projects = useProjects()
  const facts = useTypedDir(mid, typed, helps)
  const judged = judgeDir(projects, mid, typed)
  const note: Note | undefined =
    judged.kind === 'bad'
      ? { text: t('dir.bad'), tone: 'danger' }
      : judged.kind === 'none'
        ? undefined
        : facts.missing
          ? { text: t('dir.missing'), tone: 'warn' }
          : facts.here
            ? {
                text: [
                  ...(facts.here.git ? [t('dir.git')] : []),
                  t('dir.entries', { n: facts.here.total }),
                ].join(' · '),
                tone: 'muted',
              }
            : undefined
  return { ...facts, note, dir: judged.kind === 'dir' && !facts.missing ? judged.dir : undefined }
}

/** What machine `mid` says of the directory being typed: the entries to suggest from, whether it
 * is not there, what it holds once typed in full (ending in '/'), and where to start from. `helps`
 * is whether the machine can list directories at all. */
function useTypedDir(mid: string, typed: string, helps: boolean) {
  const t = useI18n()
  const projects = useProjects()
  const { dir, part } = splitTyped(typed)
  const abs = expandHome(projects, mid, dir)
  const listed = useDirListing(mid, helps && abs.startsWith('/') ? abs : undefined)
  const listing = listed?.listing
  // A listing cut short may just not show it.
  const absent = part !== '' && listing !== undefined && !listing.truncated
  const shown = projects.filter(p => p.mid === mid && p.path).map(p => p.display)
  return {
    entries: listing?.entries ?? [],
    missing: listed?.missing || (absent && listing.entries.every(e => e.kind !== 'dir' || e.name !== part)),
    here: !part && listing ? describeDir(listing) : undefined,
    // Home, when it is known, then where this machine's projects mostly sit.
    picks: [...(expandHome(projects, mid, '~') === '~' ? [] : ['~']), ...frequentParents(shown, 4)],
    badge: (path: string) => {
      const at = projectsAt(projects, mid, expandHome(projects, mid, path.replace(/\/$/, '')))
      return at.is ? t('dir.isProject') : at.holds ? t('dir.holds', { n: at.holds }) : undefined
    },
  }
}

/** The listing of the absolute directory `dir` on machine `mid`, once it comes; none while `dir`
 * is undefined. A directory that is not there is `missing`. */
function useDirListing(mid: string, dir: string | undefined): DirListing | undefined {
  const { call } = useSpace()
  const [got, setGot] = useState<DirListing & { mid: string }>()
  useEffect(() => {
    if (!dir) return
    let live = true
    list(call, mid, dir).then(
      listing => live && setGot({ mid, dir, listing }),
      (err: unknown) => {
        if (!live) return
        const missing = err instanceof CallError && ['not_found', 'not_a_directory'].includes(err.code)
        if (!missing) console.warn('could not list a directory to suggest from', dir, err)
        setGot({ mid, dir, missing })
      },
    )
    return () => {
      live = false
    }
  }, [call, mid, dir])
  // A listing for another machine or directory is not this one's.
  return got?.mid === mid && got.dir === dir ? got : undefined
}

type Props = {
  value: string
  onChange: (value: string) => void
  /** Whether the machine can list directories to suggest from. */
  helps: boolean
  /** The entries of the directory being typed in, once listed. */
  entries: Entry[]
  /** Directories to start from, as typed. */
  picks: string[]
  /** What to say beside a suggestion (a full path as typed): whether it is or holds projects. */
  badge: (path: string) => string | undefined
}

export function DirInput({ value, onChange, helps, entries, picks, badge }: Props) {
  const t = useI18n()
  const input = useRef<HTMLInputElement>(null)
  const [highlighted, setHighlighted] = useState<string>()
  const { dir, part } = splitTyped(value)
  const names = completions(entries, part).slice(0, SHOWN)
  const paths = names.map(name => `${dir}${name}/`)

  // Into the highlighted one, the only one, or as far as all of them agree.
  const complete = () => {
    const into = highlighted ?? (paths.length === 1 ? paths[0] : undefined)
    if (into) return into
    const prefix = commonPrefix(names.filter(name => name.toLowerCase().startsWith(part.toLowerCase())))
    return prefix.length > part.length ? dir + prefix : undefined
  }

  return (
    <div className="flex flex-col gap-2">
      <Autocomplete.Root
        inline
        open
        items={paths}
        filter={null}
        value={value}
        onValueChange={(next, details) => {
          // Only typing changes it here; Esc is the panel's.
          if (details.reason === 'input-change') onChange(next)
        }}
        onItemHighlighted={item => setHighlighted(item)}
      >
        <Autocomplete.Input
          ref={input}
          autoFocus
          aria-label={t('dir.label')}
          placeholder="~/work/new-tool"
          autoComplete="off"
          spellCheck={false}
          onKeyDown={e => {
            if (e.key !== 'Tab' || e.shiftKey) return
            const next = complete()
            if (!next) return
            e.preventDefault()
            onChange(next)
          }}
          className="h-[38px] rounded-lg border border-line bg-bg px-3 font-mono text-[13px] text-text outline-none focus:outline-2 focus:outline-accent"
        />
        {paths.length ? (
          <Autocomplete.List
            aria-label={t('dir.suggestions')}
            className="max-h-[188px] overflow-y-auto rounded-lg border border-line bg-raised p-1"
          >
            {(path: string) => (
              <Autocomplete.Item
                key={path}
                value={path}
                // Inline, with no popup, Base UI fills nothing in on a press; Enter on a
                // highlighted item comes here as a click too.
                onClick={() => {
                  onChange(path)
                  input.current?.focus()
                }}
                className="flex h-[30px] cursor-pointer items-center gap-2 rounded-md px-2.5 font-mono text-[12.5px] text-text data-highlighted:bg-accent-soft"
              >
                <span className="min-w-0 flex-1 truncate">{path.slice(dir.length)}</span>
                {badge(path) ? (
                  <span className="flex-none font-sans text-[11.5px] text-faint">{badge(path)}</span>
                ) : null}
              </Autocomplete.Item>
            )}
          </Autocomplete.List>
        ) : null}
      </Autocomplete.Root>
      {helps && picks.length ? (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-[12px] text-faint">{t('dir.often')}</span>
          {picks.map(pick => (
            <Button
              key={pick}
              size="small"
              variant="quiet"
              className="font-mono text-[12px]"
              onClick={() => {
                onChange(`${pick}/`)
                input.current?.focus()
              }}
            >
              {pick}
            </Button>
          ))}
        </div>
      ) : null}
      {helps ? <span className="text-[12px] text-faint">{t('dir.hint')}</span> : null}
    </div>
  )
}
