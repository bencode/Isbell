// The interface's language: a translator for the strings the app's entry hands in (see
// locales/). `{name}` placeholders are filled by t().

import { CallError } from '@isbell/core'
import { createContext, type ReactNode, useContext, useMemo } from 'react'
import type { Key } from '../locales/en'
import { useLocal } from './prefs'

export type { Key }

export type Lang = 'en' | 'zh'
export type Catalog = Record<Key, string>
export type T = ((key: Key, vars?: Record<string, string | number>) => string) & {
  /** Whether a key built at runtime, such as an error code's, has a sentence. */
  has: (key: string) => key is Key
}

const I18nContext = createContext<Record<Lang, Catalog> | null>(null)

/** Puts the interface's strings in reach of useI18n; the app's entry passes them in. */
export function I18nProvider({
  messages,
  children,
}: {
  messages: Record<Lang, Catalog>
  children: ReactNode
}) {
  return <I18nContext.Provider value={messages}>{children}</I18nContext.Provider>
}

const resolveLang = (lang: 'system' | Lang): Lang =>
  lang === 'system' ? (navigator.language.toLowerCase().startsWith('zh') ? 'zh' : 'en') : lang

const translator = (catalog: Catalog): T =>
  Object.assign(
    (key: Key, vars: Record<string, string | number> = {}) =>
      catalog[key].replace(/\{(\w+)\}/g, (m, name: string) => String(vars[name] ?? m)),
    { has: (key: string): key is Key => key in catalog },
  )

/** The translator for the language chosen in settings, or the browser's. */
export function useI18n(): T {
  const messages = useContext(I18nContext)
  if (!messages) throw new Error('useI18n needs an I18nProvider')
  const lang = resolveLang(useLocal().prefs.lang)
  return useMemo(() => translator(messages[lang]), [messages, lang])
}

/** Labels the pure UI components take: close, and copy for commands. */
export const uiLabels = (t: T) => ({ close: t('close'), copy: t('copy'), copied: t('copied') })

/** A call's failure as a sentence; codes without one show the machine's own message. */
export function errorText(t: T, err: unknown): string {
  if (!(err instanceof CallError)) {
    console.error(err)
    return t('error.unknown', { msg: String(err) })
  }
  const key = `error.${err.code}`
  return t.has(key) ? t(key, { msg: err.message }) : t('error.unknown', { msg: err.message })
}
