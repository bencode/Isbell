// A phone's inbox: what agents told the user on the machines online, the latest active first. Those
// waiting on the user, a question or a warning, come first, a card each, and are counted on the tab;
// then the rest. A message is answered in the chat it opens, never here. The page scrolls.

import { type Posted, useMessageFeed } from '../../../core/books'
import { useI18n } from '../../../core/i18n'
import { asksYou } from '../../../model/messages'
import { useNow } from '../../../utils/time'
import { PhoneBar } from '../bar'
import { MoreMenu } from '../more-menu'
import { usePlaceKept } from '../page-place'
import { TabBar, TabTitle, UNDER_TABS } from '../tab-bar'
import { CARD, Section } from '../tasks/parts'
import { MessageRow } from './message-row'

export function PhoneInbox() {
  usePlaceKept('inbox')
  const t = useI18n()
  const now = useNow()
  const posted = useMessageFeed()
  const named = new Set(posted.map(p => p.mid)).size > 1
  const asking = posted.filter(p => asksYou(p.message))
  const rest = posted.filter(p => !asksYou(p.message))
  const keyOf = ({ mid, message }: Posted) => `${mid}:${message.id}`
  return (
    <div className="flex min-h-dvh flex-col">
      <PhoneBar>
        <TabTitle>{t('mobile.inbox')}</TabTitle>
        <MoreMenu />
      </PhoneBar>
      <main className={`flex-1 ${UNDER_TABS}`}>
        {asking.length ? (
          <Section title={<span className="text-warn">{t('mobile.forYou')}</span>} count={asking.length}>
            {asking.map(p => (
              <div
                key={keyOf(p)}
                className={`overflow-hidden rounded-2xl border ${p.message.kind === 'ask' ? 'border-ask-line bg-ask' : 'border-line bg-raised'}`}
              >
                <MessageRow posted={p} named={named} now={now} />
              </div>
            ))}
          </Section>
        ) : null}
        {rest.length ? (
          <Section title={t('mobile.recent')}>
            <div className={CARD}>
              {rest.map(p => (
                <MessageRow key={keyOf(p)} posted={p} named={named} now={now} />
              ))}
            </div>
          </Section>
        ) : null}
        {posted.length ? null : <p className="m-0 px-4 py-6 text-center text-muted">{t('messages.none')}</p>}
      </main>
      <TabBar />
    </div>
  )
}
