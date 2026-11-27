// The right column's Agents, for the shares given to this user: each a group of its own under theirs,
// its agents by their owner's machine, as the owner ticks them, opened in the peek as theirs are. A
// share no machine serves now has ended, or its machines are offline: it greys, to be removed.

import { MoreHorizontal, Share2 } from 'lucide-react'
import { DropdownMenu } from '../../components/menu'
import { useI18n } from '../../core/i18n'
import { leaveShare } from '../../core/prefs'
import { type SharedSpace, useSharedSpaces } from '../../core/shared-spaces'
import { ProvideSpace, useProjects, useSpaceView } from '../../core/space'
import { lanes, paneKey } from '../../model/projects'
import { LANES, type Lane } from '../../model/roles'
import { AgentRow } from './agent-row'
import { MachineHeading } from './machine-heading'
import { usePeek } from './peek'

/** `shows`: whether the column's filter shows agents in the lane. */
export function SharedWithMe({ shows, now }: { shows: (lane: Lane) => boolean; now: number }) {
  return useSharedSpaces().map(shared => (
    <ProvideSpace key={shared.key} space={shared.space}>
      <SharedGroup shared={shared} shows={shows} now={now} />
    </ProvideSpace>
  ))
}

function SharedGroup({
  shared,
  shows,
  now,
}: {
  shared: SharedSpace
  shows: (lane: Lane) => boolean
  now: number
}) {
  const t = useI18n()
  const view = useSpaceView()
  const live = lanes(useProjects())
  const { peek, open } = usePeek()
  const online = view.machines.filter(m => m.online)
  const byLane: Record<Lane, typeof live.asking> = {
    asking: live.asking,
    running: live.running,
    finished: [...live.finished].reverse(),
    standing: live.standing,
  }
  const all = LANES.flatMap(lane => byLane[lane])
  const shown = LANES.flatMap(lane => (shows(lane) ? byLane[lane] : []))
  // A filter that shows none of them leaves the group out.
  if (all.length && !shown.length) return null
  const ended = view.loaded && !online.length

  const body = !view.loaded ? (
    <p className="m-0 px-2 text-[12.5px] text-faint">{t('sharedWithMe.connecting')}</p>
  ) : ended ? (
    <p className="m-0 px-2 text-[12.5px] text-faint">{t('sharedWithMe.ended')}</p>
  ) : !all.length ? (
    <p className="m-0 px-2 text-[12.5px] text-faint">{t('sharedWithMe.none')}</p>
  ) : (
    online.map(m => {
      const mid = m.state.machine.id
      const list = shown.filter(p => p.session.mid === mid)
      if (!list.length) return null
      return (
        <section key={mid} className="flex flex-col gap-1.5">
          <MachineHeading
            name={m.state.machine.name}
            count={list.length}
            asking={list.filter(p => p.session.status === 'blocked').length}
            open
          />
          {list.map(placed => {
            const { paneId } = placed.session
            return (
              <AgentRow
                key={paneKey(mid, paneId)}
                placed={placed}
                now={now}
                peeking={peek?.space === shared.sid && peek.mid === mid && peek.paneId === paneId}
                onOpen={terminal => open(placed, terminal, shared.sid)}
              />
            )
          })}
        </section>
      )
    })
  )

  return (
    <section className={`flex flex-none flex-col gap-1.5 ${ended ? 'opacity-65' : ''}`}>
      <h3 className="group m-0 flex h-6 items-center gap-1.5 px-1 text-[11.5px] font-semibold text-accent">
        <Share2 size={12} />
        {t('sharedWithMe.title')}
        {all.length ? <span className="font-mono font-medium text-faint">{shown.length}</span> : null}
        <DropdownMenu
          trigger={
            <button
              type="button"
              aria-label={t('sharedWithMe.more')}
              className="ml-auto inline-grid size-5 cursor-pointer place-items-center rounded-md border-0 bg-transparent p-0 text-faint opacity-0 group-hover:opacity-100 hover:bg-hover hover:text-text focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-accent data-[popup-open]:opacity-100"
            >
              <MoreHorizontal size={14} />
            </button>
          }
          items={[{ label: t('sharedWithMe.remove'), danger: true, onClick: () => leaveShare(shared.key) }]}
        />
      </h3>
      {body}
    </section>
  )
}
