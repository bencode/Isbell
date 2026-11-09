// A project's files on a phone, at the addresses they have everywhere: its tree, or a file read over
// the tree, which stays behind it as it was left.

import { Activity } from 'react'
import { useParams } from 'react-router'
import { useI18n } from '../../../core/i18n'
import { useSpaceView } from '../../../core/space'
import { useRootOf } from '../../../core/worktrees'
import { filesNote } from '../../../features/files/notes'
import { machineOf } from '../../../model/space'
import { BackButton, PhoneBar } from '../bar'
import { FileReader } from './reader'
import { FilesTree } from './tree'

export function PhoneFiles() {
  const t = useI18n()
  const { key = '', '*': rest = '' } = useParams()
  const { machines } = useSpaceView()
  const { project, roots, root, settled } = useRootOf(key)
  const note = filesNote(t, { project, root, settled, machine: project && machineOf(machines, project.mid) })
  if (note || !project || !root)
    return (
      <>
        <PhoneBar>
          <BackButton />
        </PhoneBar>
        <p className="m-0 p-4 text-muted">{note}</p>
      </>
    )
  // An address ending in '/' names a directory.
  const reading = rest.endsWith('/') ? '' : rest
  return (
    <>
      <Activity mode={reading ? 'hidden' : 'visible'}>
        <FilesTree
          key={root.key}
          project={project}
          roots={roots}
          root={root}
          dir={reading ? '' : rest.slice(0, -1)}
        />
      </Activity>
      {reading ? (
        <FileReader key={`${root.key}:${reading}`} project={project} root={root} rel={reading} />
      ) : null}
    </>
  )
}
