// Pushes to this iPhone: its subscription goes to each machine that can push, which then tells it
// of its agents coming to ask or done, with Isbell closed (gateway/push). Sent again on each open
// and as machines come online, so a machine joining later gets it too; a machine keeps one per
// phone. Turned off, the subscription ends here and each machine forgets it on its next push.

import { useEffect, useMemo, useRef } from 'react'
import type { Caller } from '../model/herdr'
import type { MachineEntry } from '../model/space'
import { type T, useI18n } from './i18n'
import { useLocal } from './prefs'
import { useSpace, useSpaceView } from './space'

const KEY = 'isbell.push.key'
const SUBSCRIBE = 'isbell.push.subscribe'
const TIMEOUT_MS = 20_000

/** The titles a push takes in this phone's language, `{name}` standing for the agent's. */
type Texts = { blocked: string; done: string }

/** Whether this browser can take pushes: only Isbell opened from an iPhone's home screen can;
 * Safari itself is told to add it there. Only iOS has `navigator.standalone`. */
export function pushSupport(): 'yes' | 'install' | 'no' {
  if (!('standalone' in navigator)) return 'no'
  if (navigator.standalone === false) return 'install'
  return 'serviceWorker' in navigator && 'PushManager' in window ? 'yes' : 'no'
}

/** The machines online that can push. */
export const pushMachines = (machines: MachineEntry[]) =>
  machines.filter(m => m.online && m.state.caps.methods.includes(SUBSCRIBE)).map(m => m.state.machine.id)

export const pushTexts = (t: T): Texts => ({
  blocked: t('notify.blocked', { name: '{name}' }),
  done: t('notify.done', { name: '{name}' }),
})

export function registerWorker() {
  if (pushSupport() !== 'yes') return
  navigator.serviceWorker.register('/sw.js').catch((err: unknown) => {
    console.error('could not register the service worker', err)
  })
}

/** Asks for permission, which must be on a tap, then subscribes and tells `mids`; false if refused. */
export async function turnOnPush(call: Caller, mids: string[], texts: Texts): Promise<boolean> {
  if ((await Notification.requestPermission()) !== 'granted') return false
  await sendPush(call, mids, texts)
  return true
}

export async function turnOffPush() {
  const registration = await navigator.serviceWorker.ready
  await (await registration.pushManager.getSubscription())?.unsubscribe()
}

/** Tells `mids` of this phone's subscription, subscribing first where it has none or one under
 * another space's key. */
async function sendPush(call: Caller, mids: string[], texts: Texts) {
  const [first] = mids
  if (!first) return
  const { key } = (await call(first, KEY, {}, TIMEOUT_MS)) as { key: string }
  const server = fromBase64Url(key)
  const registration = await navigator.serviceWorker.ready
  const held = await registration.pushManager.getSubscription()
  const current = held && sameBytes(held.options.applicationServerKey, server) ? held : null
  if (held && !current) await held.unsubscribe()
  const subscription =
    current ??
    (await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: server }))
  const { endpoint, keys } = subscription.toJSON()
  const results = await Promise.allSettled(
    mids.map(mid => call(mid, SUBSCRIBE, { endpoint, keys, texts }, TIMEOUT_MS)),
  )
  const failed = results.flatMap(r => (r.status === 'rejected' ? [r.reason as unknown] : []))
  for (const err of failed) console.error('a machine did not take the push subscription', err)
  if (failed.length === mids.length) throw failed[0]
}

/** Keeps the machines told while pushes are on: each machine that can push once per open, and all
 * again when the language changes the titles. */
export function usePushSync() {
  const t = useI18n()
  const { call } = useSpace()
  const { machines } = useSpaceView()
  const on = useLocal().prefs.push
  const texts = useMemo(() => pushTexts(t), [t])
  // The machines told, under the titles they were told.
  const told = useRef({ texts, mids: new Set<string>() })
  useEffect(() => {
    if (!on || pushSupport() !== 'yes' || Notification.permission !== 'granted') return
    if (told.current.texts !== texts) told.current = { texts, mids: new Set() }
    const { mids } = told.current
    const fresh = pushMachines(machines).filter(mid => !mids.has(mid))
    if (!fresh.length) return
    for (const mid of fresh) mids.add(mid)
    sendPush(call, fresh, texts).catch((err: unknown) => {
      console.error('could not keep the machines told of pushes', err)
      for (const mid of fresh) mids.delete(mid)
    })
  }, [on, machines, call, texts])
}

function fromBase64Url(text: string): Uint8Array<ArrayBuffer> {
  const binary = atob(text.replaceAll('-', '+').replaceAll('_', '/'))
  return Uint8Array.from(binary, c => c.charCodeAt(0))
}

const sameBytes = (a: ArrayBuffer | null, b: Uint8Array) =>
  !!a && a.byteLength === b.byteLength && new Uint8Array(a).every((x, i) => x === b[i])
