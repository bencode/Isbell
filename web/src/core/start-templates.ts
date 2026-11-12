// A machine's start templates, read each time something that shows them opens: the new-session
// menu, the phone's new-session page. Until read, and where the file cannot be, the machine starts
// each agent by its own name.

import { useEffect, useState } from 'react'
import {
  DEFAULT_TEMPLATES,
  readTemplates,
  type StartTemplate,
  type Templates,
} from '../model/start-templates'
import { useSpace } from './space'

/** Machine `mid`'s templates while `on`. */
export function useTemplates(mid: string | undefined, on: boolean): StartTemplate[] {
  const space = useSpace()
  const [read, setRead] = useState<{ mid: string; templates: Templates }>()
  useEffect(() => {
    if (!on || !mid) return
    let live = true
    readTemplates(space.openStream, mid).then(
      templates => live && setRead({ mid, templates }),
      (err: unknown) => console.warn('cannot read the start templates', mid, err),
    )
    return () => {
      live = false
    }
  }, [space, mid, on])

  const found = read && read.mid === mid ? read.templates : undefined
  return found && found.state !== 'broken' ? found.templates : DEFAULT_TEMPLATES
}
