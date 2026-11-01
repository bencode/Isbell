// New on a phone, as a page of its own that scrolls with the page: Cancel and Start in its bar, as a
// phone's mail has them, where the keyboard never covers them, and the fields down the page.

import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router'
import { useI18n } from '../../core/i18n'
import { useSpaceView } from '../../core/space'
import { NewSessionFields } from '../../features/new-session/fields'
import { useNewSession } from '../../features/new-session/use-new-session'
import { projectsSettled } from '../../model/space'
import { boardHref } from '../../utils/hrefs'
import { Loading, ReconnectBanner } from '../common'

const TEXT =
  'inline-flex h-11 flex-none cursor-pointer items-center rounded-lg border-0 bg-transparent px-2.5 text-[15px] text-accent active:bg-raised-2 disabled:cursor-default disabled:text-faint focus-visible:outline-2 focus-visible:outline-accent'

export function PhoneNewSession() {
  // The form starts from the projects there are: opened afresh, it waits for them.
  return projectsSettled(useSpaceView()) ? <Form /> : <Loading />
}

function Form() {
  const t = useI18n()
  const navigate = useNavigate()
  const { key } = useParams()
  const [search] = useSearchParams()
  // The first page of a visit has nowhere to go back to.
  const first = useLocation().key === 'default'
  const form = useNewSession({
    focusedKey: key,
    newDir: search.has('dir'),
    // What was started opens in place of New, so going back leads where New was opened from.
    onStarted: next => navigate(next.href, { replace: true, state: next.state }),
  })
  const cancel = () => (first ? navigate(boardHref(key), { replace: true }) : navigate(-1))
  return (
    // The screen's height at least, the paper filling what the bar leaves.
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-10 border-b border-line bg-bg pt-[env(safe-area-inset-top)] pr-[env(safe-area-inset-right)] pl-[env(safe-area-inset-left)]">
        <div className="flex h-[52px] items-center gap-1 px-1.5">
          <button type="button" onClick={cancel} disabled={form.busy} className={TEXT}>
            {t('cancel')}
          </button>
          <span className="min-w-0 flex-1 truncate text-center text-base font-bold">{t('ns.title')}</span>
          <button
            type="button"
            onClick={() => void form.start()}
            disabled={!form.ready || form.busy}
            className={`${TEXT} font-semibold`}
          >
            {form.goLabel}
          </button>
        </div>
        <ReconnectBanner />
      </header>
      <main className="paper flex flex-1 flex-col gap-[18px] pt-4 pr-[max(1rem,env(safe-area-inset-right))] pb-[calc(2.5rem+env(safe-area-inset-bottom))] pl-[max(1rem,env(safe-area-inset-left))]">
        <NewSessionFields form={form} stacked />
        <p className={`m-0 text-[13px] ${form.error ? 'text-danger' : 'text-muted'}`}>{form.status}</p>
      </main>
    </div>
  )
}
