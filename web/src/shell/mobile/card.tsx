// An agent on the phone's Agents tab: a card by its role's name, or what it is called, with what it
// does and where; a team's card has those reporting to its lead on a line down from it. The whole card
// opens the agent, a member's row that member; one that asks can go straight to its terminal. One
// standing by is a line.

import { SquareTerminal } from 'lucide-react'
import { Link } from 'react-router'
import { RoleAvatar } from '../../components/role-avatar'
import { useI18n } from '../../core/i18n'
import { useCardNote } from '../../features/session/use-agent-note'
import { toolLine } from '../../model/agent-note'
import { type Placed, placedTitle, placedWhere } from '../../model/projects'
import { sessionHref } from '../../utils/hrefs'
import { since } from '../../utils/time'

/** An agent with the name of the role it took, if it took one. */
export type Named = { placed: Placed; role?: string }

const nameOf = ({ placed, role }: Named) => role ?? placedTitle(placed)

/** What it is about now: the tool it runs, that it waits, what it asked, or the task it was given. */
function useDoing({ placed, role }: Named) {
  const t = useI18n()
  const { session } = placed
  const { tool, asked } = useCardNote(session)
  if (tool) return { text: toolLine(tool), mono: true }
  if (session.status === 'blocked') return { text: asked ?? t('active.waits') }
  if (asked) return { text: asked }
  return role ? { text: placedTitle(placed) } : undefined
}

export function AgentCard({ agent, now, members = [] }: { agent: Named; now: number; members?: Named[] }) {
  const t = useI18n()
  const { session } = agent.placed
  const doing = useDoing(agent)
  const blocked = session.status === 'blocked'
  return (
    <article
      className={`relative flex flex-col rounded-2xl border active:border-line-strong ${blocked ? 'border-ask-line bg-ask' : 'border-line bg-raised'}`}
    >
      <div className="flex min-w-0 items-start gap-2.5 px-3 pt-2.5 pb-2.5">
        <span className="pt-0.5">
          <RoleAvatar name={nameOf(agent)} status={session.status} />
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-px">
          <div className="flex min-w-0 items-center gap-1.5">
            <Link
              to={sessionHref(session.mid, session.paneId)}
              className="min-w-0 truncate text-[15px] leading-snug font-semibold text-text no-underline after:absolute after:inset-0 after:content-['']"
            >
              {nameOf(agent)}
            </Link>
            {members.length ? (
              <span className="flex-none rounded-[5px] bg-accent-soft px-[5px] text-[10px] leading-4 font-semibold tracking-wide text-accent uppercase">
                {t('mobile.lead')}
              </span>
            ) : null}
            <span className="ml-auto flex-none pl-1 font-mono text-[11px] text-faint">
              {since(session.statusSince, now)}
            </span>
          </div>
          {doing ? (
            <p
              className={`m-0 line-clamp-2 [overflow-wrap:anywhere] ${doing.mono ? 'font-mono text-xs' : 'text-[13px]'} ${blocked ? 'font-medium text-warn' : 'text-muted'}`}
            >
              {doing.text}
            </p>
          ) : null}
          <span className="truncate text-[11.5px] text-faint">{placedWhere(agent.placed)}</span>
        </div>
      </div>
      {blocked ? (
        <Link
          to={sessionHref(session.mid, session.paneId, true)}
          className="relative z-[1] mx-3 mb-3 flex h-11 items-center justify-center gap-[7px] rounded-[10px] border border-ask-line bg-raised text-[14.5px] font-semibold text-text no-underline active:bg-hover"
        >
          <SquareTerminal size={16} />
          {t('active.answer')}
        </Link>
      ) : null}
      {members.length ? (
        <div className="relative z-[1] flex flex-col border-t border-line py-1 pl-[26px]">
          <div className="flex flex-col border-l border-line-strong">
            {members.map(m => (
              <MemberRow key={`${m.placed.session.mid}/${m.placed.session.paneId}`} member={m} />
            ))}
          </div>
        </div>
      ) : null}
    </article>
  )
}

function MemberRow({ member }: { member: Named }) {
  const { session } = member.placed
  const doing = useDoing(member)
  return (
    <Link
      to={sessionHref(session.mid, session.paneId)}
      className="flex h-10 min-w-0 items-center gap-2 pr-3 pl-2.5 text-text no-underline active:bg-press"
    >
      <RoleAvatar name={nameOf(member)} status={session.status} size="sm" />
      <span className="flex-none text-[13.5px] font-semibold">{nameOf(member)}</span>
      <span
        className={`min-w-0 flex-1 truncate text-[12.5px] ${session.status === 'blocked' ? 'text-warn' : 'text-faint'}`}
      >
        {doing?.text}
      </span>
    </Link>
  )
}

export function StandingRow({ agent, now }: { agent: Named; now: number }) {
  const { session } = agent.placed
  return (
    <Link
      to={sessionHref(session.mid, session.paneId)}
      className="flex h-11 items-center gap-2.5 rounded-lg px-2 text-sm text-muted no-underline active:bg-hover"
    >
      <RoleAvatar name={nameOf(agent)} status={session.status} size="sm" />
      <span className="min-w-0 flex-1 truncate">{nameOf(agent)}</span>
      <span className="flex-none font-mono text-[11px] text-faint">{since(session.statusSince, now)}</span>
    </Link>
  )
}
