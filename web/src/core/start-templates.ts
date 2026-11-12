// A machine's start templates, read each time something that shows them opens: the new-session
// menu, the phone's new-session page, the editor. Until read, and where the file cannot be, the
// machine starts each agent by its own name.

import { useCallback, useEffect, useState } from 'react'
import {
  DEFAULT_TEMPLATES,
  readTemplates,
  type StartTemplate,
  type Templates,
  writeTemplates,
} from '../model/start-templates'
import { CallError } from '../model/streams'
import { useSpace } from './space'

export type TemplatesState = 'reading' | Templates['state'] | 'failed'

/** Machine `mid`'s templates while `on`; `save` writes them and shows them as written. */
export function useTemplates(mid: string | undefined, on: boolean) {
  const space = useSpace()
  const [read, setRead] = useState<{ mid: string; templates: Templates | 'failed' }>()
  useEffect(() => {
    if (!on || !mid) return
    let live = true
    readTemplates(space.openStream, mid).then(
      templates => live && setRead({ mid, templates }),
      (err: unknown) => {
        console.warn('cannot read the start templates', mid, err)
        if (live) setRead({ mid, templates: 'failed' })
      },
    )
    return () => {
      live = false
    }
  }, [space, mid, on])

  const found = read && read.mid === mid ? read.templates : undefined
  const state: TemplatesState = found === undefined ? 'reading' : found === 'failed' ? 'failed' : found.state
  const templates =
    found && found !== 'failed' && found.state !== 'broken' ? found.templates : DEFAULT_TEMPLATES

  const save = useCallback(
    async (next: StartTemplate[]) => {
      if (!mid) return
      if (state === 'broken') throw new CallError('templates_broken', 'templates.json cannot be read')
      await writeTemplates(space.openStream, mid, next)
      setRead({ mid, templates: { state: 'listed', templates: next } })
    },
    [space, mid, state],
  )

  return { templates, state, save }
}
