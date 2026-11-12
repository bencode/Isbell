// New on a phone: which of the machine's start templates and in which project, what was used last
// chosen already, with the button that starts it saying where. It opens the session in its place, so
// back leads home.

import { Check, ChevronLeft } from 'lucide-react'
import { useState } from 'react'
import { useNavigate } from 'react-router'
import { errorText, useI18n } from '../../core/i18n'
import { updateLocal, useLocal } from '../../core/prefs'
import { useProjects, useSpace, useSpaceView } from '../../core/space'
import { useTemplates } from '../../core/start-templates'
import { startIn } from '../../features/session/new-session-menu'
import { machineOf, projectsSettled } from '../../model/space'
import { plain, usable } from '../../model/start-templates'
import { sessionHref } from '../../utils/hrefs'
import { PhoneBar, TAP, useBack } from './bar'

const LABEL = 'm-0 px-4 pt-3.5 pb-1.5 text-[12.5px] font-semibold text-muted'

export function PhoneNewSession() {
  const t = useI18n()
  const navigate = useNavigate()
  const back = useBack()
  const space = useSpace()
  const view = useSpaceView()
  const { lastProject, lastAgent } = useLocal()
  const startable = useProjects().filter(p => p.online && p.configured && p.path)
  const [picked, setPicked] = useState<string>()
  const [chosen, setChosen] = useState<string>()
  const [starting, setStarting] = useState(false)
  const [error, setError] = useState<string>()

  // None picked and none used before, it waits to be told rather than start somewhere by a tap.
  const project = startable.find(p => p.key === (picked ?? lastProject))
  const caps = project && machineOf(view.machines, project.mid)?.state.caps
  // Those of agents herdr knows on the project's machine; what was used last is a template's name,
  // which is the agent's for one that starts it by its name.
  const templates = useTemplates(project?.mid, !!project).templates.filter(
    tm => !caps || caps.agentKinds.includes(tm.agent),
  )
  const can = (name: string) => templates.some(tm => tm.name === name && (!caps || usable(tm, caps)))
  const name = [chosen, lastAgent, ...templates.map(tm => tm.name)].find(n => n && can(n))
  const template = templates.find(tm => tm.name === name)
  const machines = view.machines
    .map(({ state: { machine } }) => ({ machine, projects: startable.filter(p => p.mid === machine.id) }))
    .filter(m => m.projects.length)

  const start = async () => {
    if (!project || !template || starting) return
    setStarting(true)
    setError(undefined)
    try {
      const { paneId, shell } = await startIn(space, project, { template })
      updateLocal(() => ({ lastProject: project.key, lastAgent: template.name }))
      // One whose agent herdr never saw come up is the shell its command ran in, shown as one.
      const href = shell
        ? sessionHref(project.mid, paneId, true)
        : `${sessionHref(project.mid, paneId)}?from=new`
      navigate(href, { replace: true })
    } catch (err) {
      setError(errorText(t, err))
      setStarting(false)
    }
  }

  return (
    <div className="flex min-h-dvh flex-col">
      <PhoneBar>
        <button
          type="button"
          onClick={back}
          disabled={starting}
          aria-label={t('mobile.back')}
          className={TAP}
        >
          <ChevronLeft size={22} />
        </button>
        <b className="min-w-0 flex-1 truncate text-base font-semibold">{t('session.new')}</b>
      </PhoneBar>
      <main className="min-w-0 flex-1 pb-3">
        <h2 className={LABEL}>{t('mobile.agent')}</h2>
        <div className="grid grid-cols-3 gap-2 px-3">
          {templates.map(tm => (
            <button
              key={tm.name}
              type="button"
              disabled={!can(tm.name) || starting}
              onClick={() => setChosen(tm.name)}
              aria-pressed={tm === template}
              className={`h-12 min-w-0 cursor-pointer truncate rounded-[10px] border px-2 text-[14.5px] disabled:cursor-default disabled:opacity-40 ${plain(tm) ? 'font-mono' : ''} ${tm === template ? 'border-accent bg-accent-soft font-semibold text-accent' : 'border-line bg-raised'}`}
            >
              {tm.name}
            </button>
          ))}
        </div>
        <h2 className={`${LABEL} pb-0`}>{t('mobile.project')}</h2>
        {machines.map(({ machine, projects }) => (
          <section key={machine.id}>
            <h3 className="m-0 flex items-center gap-[7px] px-4 pt-3 pb-[5px] text-[12.5px] font-normal text-faint">
              <span className="size-[7px] rounded-full bg-ok" />
              {machine.name}
            </h3>
            <div className="mx-3 overflow-hidden rounded-[11px] border border-line bg-raised">
              {projects.map(p => (
                <button
                  key={p.key}
                  type="button"
                  disabled={starting}
                  onClick={() => setPicked(p.key)}
                  aria-pressed={p === project}
                  className="flex min-h-14 w-full cursor-pointer items-center gap-2.5 border-0 border-t border-solid border-line bg-transparent px-[13px] py-[7px] text-left first:border-t-0"
                >
                  <span className="min-w-0 flex-1">
                    <b className="block truncate text-[15px] leading-[1.3] font-medium">{p.name}</b>
                    <span className="block truncate font-mono text-[11.5px] text-faint">{p.display}</span>
                  </span>
                  {p === project ? <Check size={18} className="flex-none text-accent" /> : null}
                </button>
              ))}
            </div>
          </section>
        ))}
        {projectsSettled(view) && !machines.length ? (
          <p className="m-0 p-4 text-muted">{t('mobile.noProject')}</p>
        ) : null}
      </main>
      <div className="sticky bottom-0 z-10 border-t border-line bg-bg px-3 pt-2 pb-[calc(env(safe-area-inset-bottom)+8px)]">
        {error ? <p className="m-0 pb-2 text-[13px] text-danger">{error}</p> : null}
        <button
          type="button"
          onClick={() => void start()}
          disabled={!project || !template || starting}
          className="h-12 w-full cursor-pointer truncate rounded-[10px] border-0 bg-accent px-3 text-[15px] font-semibold text-accent-ink active:opacity-85 disabled:cursor-default disabled:opacity-50"
        >
          {starting
            ? t('ns.starting')
            : project
              ? t('session.startIn', { path: project.name })
              : t('mobile.pickProject')}
        </button>
      </div>
    </div>
  )
}
