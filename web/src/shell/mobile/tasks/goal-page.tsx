// A goal on a phone, by its machine and number, to read: what counts as done, when, how far it is; the
// goals under it, then its tasks, those not ended first. Each opens what it is.

import { useParams } from 'react-router'
import { useGoalShelves } from '../../../core/books'
import { useI18n } from '../../../core/i18n'
import { ended, periodLabel, progressOf } from '../../../model/goals'
import { BackButton, BarTitle, PhoneBar } from '../bar'
import { Absent, Fact, Facts, GoalList, Meter, Section, TaskList } from './parts'

export function PhoneGoal() {
  const t = useI18n()
  const { mid = '', id = '' } = useParams()
  const shelves = useGoalShelves()
  const shelf = shelves.find(s => s.mid === mid)
  const goal = shelf?.book.goals.find(g => String(g.id) === id)
  if (!shelf) return <Absent note={t('board.loading')} />
  if (!goal) return <Absent note={t('mobile.goalGone')} />

  const above = shelf.book.goals.find(g => g.id === goal.parent)
  const under = shelf.book.goals.filter(g => g.parent === goal.id)
  const tasks = shelf.book.tasks.filter(task => task.goal === goal.id)
  const items = [...tasks.filter(x => !ended(x.state)), ...tasks.filter(x => ended(x.state))].map(task => ({
    shelf,
    task,
  }))
  const progress = progressOf(shelf.book).get(goal.id) ?? { done: 0, total: 0 }
  return (
    <div className="flex min-h-dvh flex-col">
      <PhoneBar>
        <BackButton />
        <BarTitle
          title={`G${goal.id}`}
          where={[above?.title, shelves.length > 1 ? shelf.name : undefined].filter(Boolean).join(' · ')}
        />
      </PhoneBar>
      <main className="flex-1 pb-[calc(env(safe-area-inset-bottom)+24px)]">
        <h1 className="m-0 px-4 pt-4 text-[19px] leading-snug font-bold [overflow-wrap:anywhere]">
          {goal.title}
        </h1>
        <div className="px-3 pt-3">
          <Facts>
            <Fact label={t('goals.progress')}>
              <span className="inline-flex items-center gap-2">
                <Meter progress={progress} />
              </span>
            </Fact>
            <Fact label={t('goals.state')}>
              {goal.state === 'open' ? undefined : t(`goals.${goal.state}`)}
            </Fact>
            <Fact label={t('tasks.outcome')}>{goal.outcome}</Fact>
            <Fact label={t('goals.period')}>{goal.period && periodLabel(t.locale, goal.period)}</Fact>
            <Fact label={t('goals.due')}>{goal.due && periodLabel(t.locale, goal.due)}</Fact>
            <Fact label={t('tasks.text')}>{goal.text}</Fact>
            <Fact label={t('tasks.link')}>{goal.link}</Fact>
          </Facts>
        </div>
        {under.length ? (
          <Section title={t('mobile.under')} count={under.length}>
            <GoalList shelf={shelf} goals={under} />
          </Section>
        ) : null}
        {items.length ? (
          <Section title={t('mobile.tasks')} count={items.length}>
            <TaskList items={items} />
          </Section>
        ) : null}
      </main>
    </div>
  )
}
