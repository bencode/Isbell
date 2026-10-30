// How Claude Code (2.1) draws its screen: "❯ " before what was asked, "⏺ " before each reply item
// and tool call, lines such as "Thought for 26s, read 1 file" summing up the tools it ran,
// "✻ Cooked for 39s" closing a turn, and the input box between two rules at the bottom, where a
// permission question takes its place while it waits.

import type { Block, Footer, Grammar } from './types'

// "Thought for 26s", "read 1 file", "ran 1 shell command": the parts of a summary line.
const PART = String.raw`(?:(?:Thought|Thinking) for \d[\dhms ]*|[A-Za-z]+ \d+ [a-z][a-z ]*)`
const SUMMED = `${PART}(?:, ${PART})*…?`
// On a line of its own; while the tools still run, the same words head an item instead.
const SUMMARY = new RegExp(`^ {2}${SUMMED}$`)
const SUMMED_HEAD = new RegExp(`^${SUMMED}$`)
const TOOL = /^([A-Z][A-Za-z]*)\((.*)\)$/
const RULE = /^─{20,}$/
const OUTPUT = /^\s*⎿\s+/
// Under the box: "⏵⏵ auto mode on (shift+tab to cycle) · ← 1 agent", "accept edits on", and hints.
const MODE = /^\s+\S+ ([a-z][a-z ]*?)(?: mode)? on(?= \(| ·|$)/
const HINT = /\bfor (shortcuts|agents)\b/

export const claude: Grammar = {
  banner: /^╭─+ Claude Code/,
  prompt: /^❯ (.*)$/,
  item: /^⏺ (.*)$/,
  summary: SUMMARY,
  output: OUTPUT,
  end: /^[✢✳✶✻✽*·] [A-Z][a-z]+ for (?<took>\d[\dhms ]*)$/,
  // The spinner while it works ("· Germinating… (34s · ↓ 1.7k tokens)", at first just
  // "· Sprouting…"), and tips under it.
  noise: [/^[✢✳✶✻✽*·] \S.*…(?: \(.*)?$/, /^\s+⎿\s+Tip: /],
  modes: ['manual', 'accept edits', 'plan', 'auto'],
  action: (head, rest): Block | undefined => {
    // Output hangs off "⎿  "; the lines after it line up five columns in.
    const output = rest.map(l => l.replace(OUTPUT, '').replace(/^ {1,5}/, ''))
    if (SUMMED_HEAD.test(head)) {
      const [verb = '', ...parts] = head.replace(/…$/, '').split(', ')
      return { kind: 'action', verb, target: parts.join(', '), output }
    }
    const m = TOOL.exec(head)
    return m ? { kind: 'action', verb: m[1] ?? '', target: m[2] ?? '', output } : undefined
  },
  bottom: lines => {
    const box = lastIndex(
      lines,
      (l, i) => /^❯/.test(l) && RULE.test(lines[i - 1] ?? '') && RULE.test(lines[i + 1] ?? ''),
    )
    if (box >= 0) {
      // Notices set flush right just above the box ("✘ Auto-update failed") belong to it.
      let at = box - 1
      while (at > 0 && /^ {20,}\S/.test(lines[at - 1] ?? '')) at -= 1
      const footer = footerOf(lines.slice(box + 2).filter(l => l.trim()))
      return { at, ...(footer ? { footer } : {}) }
    }
    const top = lastIndex(lines, l => RULE.test(l))
    const hint = lastIndex(lines, l => /^\s*Esc to cancel/.test(l))
    return top >= 0 && hint > top ? { at: top, ask: { from: top + 1, to: hint } } : undefined
  },
}

/** The mode line, and the first other line that is not a hint: the user's own status line. */
function footerOf(below: string[]): Footer | undefined {
  const mode = below.map(l => MODE.exec(l)?.[1]).find(Boolean)
  const line = below.find(l => !MODE.test(l) && !HINT.test(l))?.trim()
  return mode || line ? { ...(mode ? { mode } : {}), ...(line ? { line } : {}) } : undefined
}

function lastIndex(lines: string[], test: (l: string, i: number) => boolean): number {
  for (let i = lines.length - 1; i >= 0; i -= 1) if (test(lines[i] ?? '', i)) return i
  return -1
}
