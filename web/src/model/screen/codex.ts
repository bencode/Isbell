// How Codex (0.164) draws its screen: "› " before what was asked, "• " before each reply item,
// "Worked for 7s • 19:30" closing a turn, and the input box with the status line at the bottom,
// where an approval takes their place while it waits.

import type { Block, Grammar } from './types'

const VERBS =
  /^(Ran|Running|Explored|Exploring|Edited|Editing|Added|Deleted|Updated|Read|Searched|Exited|Waited|Called|Calling)\b\s*(.*)$/
// In Plan mode the status line ends in this, after a "·" or straight after a cut-off path, with
// "(⇧tab to cycle)" when there is room.
const PLAN = /\s+(?:·\s+)?Plan mode(?: \(.*\))?$/

export const codex: Grammar = {
  banner: /^\s*>_ OpenAI Codex/,
  prompt: /^› (.*)$/,
  item: /^[•✗■] (.*)$/,
  end: /^ {2}Worked for (?<took>.+?) • (?<at>\d{1,2}:\d{2})$/,
  stop: /^■ /,
  pinned: true,
  noise: [
    /^• Working \(.*esc to interrupt\)$/,
    /^\s+\+ Show details$/,
    /^\s+\+ \d+ lines \(.*to expand\)$/,
    /^\s+└ Tip: /,
  ],
  modes: ['Default', 'Plan'],
  // ⇧Tab leaves Plan mode, but from Default it often does nothing.
  enter: { Plan: '/plan' },
  action: (head, rest): Block | undefined => {
    const m = VERBS.exec(head)
    if (!m) return undefined
    // Output hangs off "└ "; the lines after it line up four columns in.
    const output = rest.map(l => l.replace(/^\s*[└├] /, '').replace(/^ {1,4}/, ''))
    return { kind: 'action', verb: m[1] ?? '', target: m[2] ?? '', output }
  },
  bottom: lines => {
    const box = lastIndex(lines, l => /^› /.test(l) && !/^› \d+\. /.test(l))
    const hint = lastIndex(lines, l => /^\s+Press enter to confirm/.test(l))
    if (hint > box) {
      const from = lastIndex(lines.slice(0, hint), l => /^\s+(Would you like|Do you want|Allow)\b/.test(l))
      return from < 0 ? undefined : { at: from, ask: { from, to: hint } }
    }
    if (box < 0) return undefined
    const below = lines.slice(box + 1).filter(Boolean)
    // Below the input box is the status line; anything else means this is not the input box.
    if (!below.every(l => l.startsWith('  '))) return undefined
    const found = below.find(l => !/for (agents|shortcuts)/.test(l))?.trim()
    const plan = !!found && PLAN.test(found)
    const status = found?.replace(PLAN, '').split(' · ')
    const footer =
      status && status.length > 1
        ? { model: status[0] ?? '', ...task(status[2]), mode: plan ? 'Plan' : 'Default' }
        : undefined
    return { at: box, ...(footer ? { footer } : {}) }
  },
}

const task = (t: string | undefined) => (t ? { task: t } : {})

function lastIndex(lines: string[], test: (l: string) => boolean): number {
  for (let i = lines.length - 1; i >= 0; i -= 1) if (test(lines[i] ?? '')) return i
  return -1
}
