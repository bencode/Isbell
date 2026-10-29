import { describe, expect, it } from 'vitest'
import { nameProblem, shortPane, shownName } from './agent-name'

describe('agent names', () => {
  it('shortens a pane id, and leaves one it does not know as it is', () => {
    expect(shortPane('w1A:p1')).toBe('1A')
    expect(shortPane('w1A:p2')).toBe('1A:2')
    expect(shortPane('pane-7')).toBe('pane-7')
  })

  it('calls an agent by its name, else by its kind and pane', () => {
    expect(shownName('fix-login', 'codex', 'w1A:p1')).toBe('fix-login')
    expect(shownName(undefined, 'codex', 'w1A:p1')).toBe('codex · 1A')
    expect(shownName(undefined, undefined, 'w1A:p1')).toBe('agent · 1A')
  })

  it("takes only names herdr takes, not another agent's, and an empty one to clear", () => {
    expect(nameProblem('fix-login_2', [])).toBeNull()
    expect(nameProblem('', ['x'])).toBeNull()
    for (const bad of ['Fix', '修登录', '2fix', 'fix login', 'a'.repeat(33)])
      expect(nameProblem(bad, [])).toBe('format')
    expect(nameProblem('a'.repeat(32), [])).toBeNull()
    expect(nameProblem('fix', ['fix'])).toBe('taken')
  })
})
