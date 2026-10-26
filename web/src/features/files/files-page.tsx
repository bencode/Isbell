// A pane's files: its project as a tree on the left, and one file read on the right. The file is
// the rest of the address, relative to the project's root, so the browser's history moves between
// files.

import { useCallback, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { InfoFacts } from '../../components/info-panel'
import { useI18n } from '../../core/i18n'
import { attachCommand, connectionFacts, paneFacts } from '../../core/pane-facts'
import { RELAY_URL, useProjects, useSpaceView } from '../../core/space'
import { relative } from '../../model/files/paths'
import { type Found, locate, type Pane, type Project } from '../../model/projects'
import { machineOf } from '../../model/space'
import { filesHref, projectHref } from '../../utils/hrefs'
import { useNow } from '../../utils/time'
import { EndPane } from '../pane/end-pane-dialog'
import type { PaneLayout } from '../pane/pane-layout'
import { useLink } from '../pane/use-link'
import { Preview } from './preview'
import { Tree } from './tree'

export function FilesPage({ layout }: { layout: PaneLayout }) {
  const t = useI18n()
  const params = useParams()
  const mid = params.mid ?? ''
  const paneId = params.pane ?? ''
  const view = useSpaceView()
  const found = locate(useProjects(), mid, paneId)

  if (!view.loaded) return <p className="m-6 text-muted">{t('board.loading')}</p>
  if (!found)
    return (
      <div className="m-6 flex flex-col items-start gap-3">
        <p className="m-0 text-muted">{t('files.gone')}</p>
        <Link to="/">{t('project.back')}</Link>
      </div>
    )
  return (
    <Browse
      key={`${mid}/${paneId}`}
      layout={layout}
      mid={mid}
      paneId={paneId}
      found={found}
      rel={params['*'] ?? ''}
    />
  )
}

function Browse({
  layout: Layout,
  mid,
  paneId,
  found,
  rel,
}: {
  layout: PaneLayout
  mid: string
  paneId: string
  found: Found
  rel: string
}) {
  const t = useI18n()
  const navigate = useNavigate()
  const [ending, setEnding] = useState(false)
  const machine = machineOf(useSpaceView().machines, mid)
  const { project, name, pane } = found
  const agent = 'session' in pane
  // Stable, so a document's links are not rendered again for it.
  const hrefOf = useCallback((to: string) => filesHref(mid, paneId, to), [mid, paneId])

  const note = !project.online
    ? t('files.offline')
    : !machine?.state.caps.methods.includes('isbell.file.list')
      ? t('files.old')
      : !project.path
        ? t('files.noRoot')
        : undefined
  return (
    <>
      <Layout
        found={found}
        mid={mid}
        paneId={paneId}
        view="files"
        onEnd={() => setEnding(true)}
        facts={<FilesFacts mid={mid} project={project} pane={pane} />}
      >
        {note ? (
          <p className="m-6 text-muted">{note}</p>
        ) : (
          <div className="flex min-h-0 flex-1">
            <Tree
              mid={mid}
              project={project}
              cwd={relative(project.path, agent ? (pane.session.cwd ?? '') : pane.shell.cwd) ?? ''}
              current={rel}
              hrefOf={hrefOf}
            />
            {/* Keyed, so each file starts with its own view mode and scroll. */}
            <Preview key={rel} mid={mid} project={project} rel={rel} hrefOf={hrefOf} />
          </div>
        )}
      </Layout>
      <EndPane
        open={ending}
        onOpenChange={setEnding}
        mid={mid}
        paneId={paneId}
        name={name}
        machine={project.machine}
        path={project.display}
        agent={agent}
        onEnded={() => navigate(projectHref(project.key))}
      />
    </>
  )
}

/** The pane's facts, with the path the files come by: the calls' path. */
function FilesFacts({ mid, project, pane }: { mid: string; project: Project; pane: Pane }) {
  const t = useI18n()
  const now = useNow()
  const relay = { url: RELAY_URL, status: useSpaceView().status }
  const { via, ...link } = useLink(mid, 'calls')
  return (
    <InfoFacts
      groups={[
        ...paneFacts(t, now, project, pane),
        ...(via ? [connectionFacts(t, { via, relay, ...link })] : []),
      ]}
      command={{ label: t('facts.attach'), text: attachCommand(project, pane) }}
    />
  )
}
