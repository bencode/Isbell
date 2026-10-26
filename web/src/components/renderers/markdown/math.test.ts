import { expect, test } from 'vitest'
import { normalizeMath } from './math'

test('LaTeX delimiters and one-line $$ become what remark-math reads, code untouched', () => {
  expect(normalizeMath('Area \\(\\pi r^2\\).')).toBe('Area $\\pi r^2$.')
  expect(normalizeMath('So \\[a^2 + b^2\\] holds')).toBe('So \n\n$$\na^2 + b^2\n$$\n\n holds')
  expect(normalizeMath('Inline $$x$$ here')).toBe('Inline \n\n$$\nx\n$$\n\n here')
  const code = 'Match `\\(\\d+\\)` and\n```\n$$x$$ \\[y\\]\n```'
  expect(normalizeMath(code)).toBe(code)
})
