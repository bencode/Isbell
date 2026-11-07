// Why a project's files cannot be read, in the words the views say it in.

import type { T } from '../../core/i18n'
import type { FilesRoot } from '../../model/files/worktrees'
import type { Project } from '../../model/projects'
import type { MachineEntry } from '../../model/space'

type Where = {
  project: Project | undefined
  root: FilesRoot | undefined
  /** Whether the projects and worktrees have settled: until then, one not found may yet appear. */
  settled: boolean
  machine: MachineEntry | undefined
}

/** Why the files under `root` cannot be read, if they cannot. */
export const filesNote = (t: T, { project, root, settled, machine }: Where): string | undefined =>
  !project
    ? t(settled ? 'project.gone' : 'board.loading')
    : !project.online
      ? t('files.offline')
      : machine && !machine.state.caps.methods.includes('isbell.file.list')
        ? t('files.old')
        : !project.path
          ? t('files.noRoot')
          : !root
            ? t(settled ? 'files.branchGone' : 'board.loading')
            : undefined
