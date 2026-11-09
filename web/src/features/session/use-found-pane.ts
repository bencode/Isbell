import { useEffect, useState } from 'react'
import { useProjects, useSpace, useSpaceView } from '../../core/space'
import { locate } from '../../model/projects'
import { projectsSettled } from '../../model/space'

/** A pane by its address, and whether it may yet be listed. Panes are pulled every so often, and one
 * started a moment ago may not be listed yet: it is gone only once the machine, asked again, does not
 * list it. Not answered, it is asked again once the place showing it shows again. */
export function useFoundPane(mid: string, paneId: string) {
  const space = useSpace()
  const view = useSpaceView()
  const found = locate(useProjects(), mid, paneId)
  const ready = projectsSettled(view)
  const listed = found !== undefined
  const [checked, setChecked] = useState(false)
  useEffect(() => {
    // Listed again, it is checked anew once it goes.
    if (listed) setChecked(false)
    if (!ready || listed) return
    let live = true
    void space.refreshShells(mid).then(listedNow => {
      if (live && listedNow) setChecked(true)
    })
    return () => {
      live = false
    }
  }, [ready, listed, space, mid])
  return { found, waiting: !ready || (!listed && !checked) }
}
