// A phone's Tasks tab, from each machine's goals book: the tasks being done on any of them, the most
// pressing first, then those to do and those done today, each with the role that follows it; then
// each machine's goals not ended, with how far they are. Each opens what it is. The page scrolls.

import { useGoalShelves } from '../../../core/books'
import { useI18n } from '../../../core/i18n'
import { nowTasks, openTree, todoTasks } from '../../../model/goals'
import { useNow } from '../../../utils/time'
import { PhoneBar } from '../bar'
import { MoreMenu } from '../more-menu'
import { usePlaceKept } from '../page-place'
import { TabBar, TabTitle, UNDER_TABS } from '../tab-bar'
import { GoalList, type Item, Section, TaskList } from './parts'

const startOfDay = (ms: number) => new Date(ms).setHours(0, 0, 0, 0)

export function PhoneTasks() {
  usePlaceKept('tasks')
  const t = useI18n()
  const now = useNow()
  const shelves = useGoalShelves()
  // With goals on one machine only, as most have, its name says nothing.
  const named = shelves.length > 1
  const items = shelves.flatMap(shelf => shelf.book.tasks.map(task => ({ shelf, task })))
  const current = nowTasks(items, startOfDay(now))
  const under = ({ shelf, task }: Item) =>
    [shelf.book.goals.find(g => g.id === task.goal)?.title, named ? shelf.name : undefined]
      .filter(Boolean)
      .join(' · ')
  const lists = [
    { key: 'doing', title: t('goals.doing'), items: current.filter(i => i.task.state === 'doing') },
    { key: 'todo', title: t('goals.todo'), items: todoTasks(items) },
    { key: 'done', title: t('mobile.doneToday'), items: current.filter(i => i.task.state === 'done') },
  ]
  return (
    <div className="flex min-h-dvh flex-col">
      <PhoneBar>
        <TabTitle>{t('workbench.tasks')}</TabTitle>
        <MoreMenu />
      </PhoneBar>
      <main className={`flex-1 ${UNDER_TABS}`}>
        {shelves.length ? (
          <>
            {lists.map(({ key, title, items: listed }) =>
              listed.length ? (
                <Section key={key} title={title} count={listed.length}>
                  <TaskList items={listed} under={under} />
                </Section>
              ) : null,
            )}
            {shelves.map(shelf => {
              const goals = openTree(shelf.book).map(node => node.goal)
              return goals.length ? (
                <Section
                  key={shelf.mid}
                  title={named ? `${t('mobile.goals')} · ${shelf.name}` : t('mobile.goals')}
                >
                  <GoalList shelf={shelf} goals={goals} />
                </Section>
              ) : null
            })}
          </>
        ) : (
          <p className="m-0 px-4 py-6 text-center text-muted">{t('tasks.none')}</p>
        )}
      </main>
      <TabBar />
    </div>
  )
}
