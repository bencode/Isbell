// A text file as source, read-only: line numbers, folding, search, and colours by its name, the
// grammar fetched the first time a language is shown. Only what is on screen is drawn, so a large
// file stays smooth.

import { LanguageDescription, syntaxHighlighting } from '@codemirror/language'
import { openSearchPanel, search } from '@codemirror/search'
import { Compartment, EditorState, type Extension } from '@codemirror/state'
import { classHighlighter } from '@lezer/highlight'
import { basicSetup, EditorView } from 'codemirror'
import { type Ref, useEffect, useImperativeHandle, useLayoutEffect, useRef } from 'react'
import styles from './code.module.scss'

export type CodeRendererHandle = { openSearch(): void }

type Props = {
  text: string
  name: string
  wrap: boolean
  /** The label of the text, and the search panel's words by CodeMirror's English ones. */
  labels: { source: string; phrases: Record<string, string> }
  /** Where the text starts scrolled, and where it has been scrolled to. */
  scroll: { top: number; onScroll: (top: number) => void }
  ref?: Ref<CodeRendererHandle>
}

/** The grammar for `name`, or none when no grammar claims it. */
const grammarFor = async (name: string): Promise<Extension> => {
  const { languages } = await import('@codemirror/language-data')
  return (await LanguageDescription.matchFilename(languages, name)?.load()) ?? []
}

const wrapping = (wrap: boolean): Extension => (wrap ? EditorView.lineWrapping : [])

export function CodeRenderer({ text, name, wrap, labels, scroll, ref }: Props) {
  const host = useRef<HTMLDivElement>(null)
  const view = useRef<EditorView>(null)
  const parts = useRef({ wrap: new Compartment(), grammar: new Compartment() })
  // Read when the view is made; later changes go through the effects below.
  const first = useRef({ wrap, labels, scroll })

  useImperativeHandle(ref, () => ({
    openSearch: () => {
      if (view.current) openSearchPanel(view.current)
    },
  }))

  // A renderer is mounted for one read of one file, so the view is made once, with the text there
  // at once to scroll back to; the colours come in when the grammar arrives.
  useLayoutEffect(() => {
    const parent = host.current
    if (!parent) return
    const { wrap, labels, scroll } = first.current
    const made = new EditorView({
      parent,
      state: EditorState.create({
        doc: text,
        extensions: [
          basicSetup,
          // Under the header, where the button that opens it is.
          search({ top: true }),
          syntaxHighlighting(classHighlighter),
          EditorState.readOnly.of(true),
          EditorState.phrases.of(labels.phrases),
          EditorView.contentAttributes.of({ 'aria-label': labels.source }),
          parts.current.wrap.of(wrapping(wrap)),
          parts.current.grammar.of([]),
        ],
      }),
    })
    view.current = made
    made.scrollDOM.scrollTop = scroll.top
    const onScroll = () => scroll.onScroll(made.scrollDOM.scrollTop)
    made.scrollDOM.addEventListener('scroll', onScroll, { passive: true })
    let live = true
    grammarFor(name).then(
      grammar => {
        if (live) made.dispatch({ effects: parts.current.grammar.reconfigure(grammar) })
      },
      (err: unknown) => console.warn('could not load the grammar; the text stays plain', name, err),
    )
    return () => {
      live = false
      made.scrollDOM.removeEventListener('scroll', onScroll)
      made.destroy()
      view.current = null
    }
  }, [text, name])

  useEffect(() => {
    view.current?.dispatch({ effects: parts.current.wrap.reconfigure(wrapping(wrap)) })
  }, [wrap])

  return <div ref={host} className={styles.code} />
}
