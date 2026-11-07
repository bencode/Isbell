// What a tool call is shown by: the one argument that says what it works on, and for an edit the
// lines it added and removed.

const FIELD: Readonly<Record<string, string>> = {
  Bash: 'command',
  Read: 'file_path',
  Edit: 'file_path',
  MultiEdit: 'file_path',
  Write: 'file_path',
  NotebookEdit: 'notebook_path',
  Grep: 'pattern',
  Glob: 'pattern',
  Agent: 'description',
  Task: 'description',
  WebFetch: 'url',
  WebSearch: 'query',
  Skill: 'skill',
}

export const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null

const firstLine = (s: string) => s.trim().split('\n')[0] ?? ''

/** The argument the call works on, its first line; else its first text argument. */
export function targetOf(name: string, input: unknown): string {
  if (!isObject(input)) return ''
  const own = input[FIELD[name] ?? '']
  if (typeof own === 'string') return firstLine(own)
  const any = Object.values(input).find(v => typeof v === 'string')
  return typeof any === 'string' ? firstLine(any) : ''
}

const lines = (v: unknown) => (typeof v === 'string' && v ? v.split('\n').length : 0)

/** Lines added and removed by an edit or a write. */
export function editOf(name: string, input: unknown): { add: number; del: number } | undefined {
  if (!isObject(input)) return undefined
  if (name === 'Write') return { add: lines(input.content), del: 0 }
  if (name !== 'Edit' && name !== 'MultiEdit') return undefined
  // Claude Code's edits, or pi's.
  const edits = Array.isArray(input.edits) ? input.edits.filter(isObject) : [input]
  return edits.reduce<{ add: number; del: number }>(
    (sum, e) => ({
      add: sum.add + lines(e.new_string ?? e.newText),
      del: sum.del + lines(e.old_string ?? e.oldText),
    }),
    { add: 0, del: 0 },
  )
}

/** Lines a unified diff adds and removes. */
export function diffOf(diff: string): { add: number; del: number } {
  const rows = diff.split('\n')
  return {
    add: rows.filter(r => r.startsWith('+') && !r.startsWith('+++')).length,
    del: rows.filter(r => r.startsWith('-') && !r.startsWith('---')).length,
  }
}

/** A model as people say it: claude-opus-5-5 as opus 5.5. */
export const modelName = (id: string) =>
  id.replace(/^claude-([a-z]+)-(\d+)-(\d+)(?:-\d{8})?$/, '$1 $2.$3').replace(/^claude-/, '')
