import assert from 'node:assert/strict'
import { after, it } from 'node:test'
import { confirm, decide, runChecks } from '../src/service.ts'
import { CHECKLIST, passedRepo } from './fixtures.ts'
import { cleanupAll, outcome, signal } from './helpers.ts'

after(cleanupAll)

it('blocks automatic and manual operations after removal, addition, task or any definition change', async () => {
  const repo = await passedRepo()
  const variants = [
    CHECKLIST.replace(/ {2}- id: typecheck\n.*\n.*\n/, ''),
    CHECKLIST + '  - id: extra\n    name: Another check\n    manual: true\n',
    CHECKLIST.replace('新增 CSV 导出功能', 'A different task'),
    CHECKLIST.replace('tsc --noEmit', 'exit 0'),
  ]
  for (const yaml of variants) {
    repo.write('done-check.yaml', yaml)
    let calls = 0
    const result = await runChecks(repo.env, async () => { calls++; return outcome() }, { ids: ['export-tests'], signal: signal() })
    assert.equal(calls, 0)
    assert.equal(result.skipped[0]?.kind, 'blocked')
    await assert.rejects(decide(repo.env, 'zh-filename', 'passed', ''), /重新确认/)
  }
  // Formatting changes do not invalidate normalized definitions.
  repo.write('done-check.yaml', '# comment\n' + CHECKLIST)
  assert.equal((await runChecks(repo.env, async () => outcome(), { signal: signal() })).ran.length, 2)
  repo.write('done-check.yaml', variants[0]!)
  await confirm(repo.env)
  assert.equal((await runChecks(repo.env, async () => outcome(), { signal: signal() })).ran.length, 1)
})
