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
import { filesHref, projectHref } from '../../utils/hrefs'
import { useNow } from '../../utils/time'
import { EndPane } from '../pane/end-pane-dialog'
import type { PaneLayout } from '../pane/pane-layout'
import { useLink } from '../pane/use-link'
import { FilesSplit } from './files-split'

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
  const navigate = useNavigate()
  const [ending, setEnding] = useState(false)
  const { project, name, pane } = found
  const agent = 'session' in pane
  // Stable, so a document's links are not rendered again for it.
  const hrefOf = useCallback((to: string) => filesHref(mid, paneId, to), [mid, paneId])

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
        <FilesSplit
          mid={mid}
          project={project}
          cwd={relative(project.path, agent ? (pane.session.cwd ?? '') : pane.shell.cwd) ?? ''}
          rel={rel}
          hrefOf={hrefOf}
        />
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
