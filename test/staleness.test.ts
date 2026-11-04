/**
 * Staleness suite (DESIGN.md §9). Every case runs the real flow — confirm,
 * run, decide, report — against a real git repository, because "the current
 * code" is defined by git's view of the working tree.
 */
import assert from 'node:assert/strict'
import { after, describe, it } from 'node:test'
import { confirm, decide, report, runChecks } from '../src/service.ts'
import { CHECKLIST, FILES, passedRepo } from './fixtures.ts'
import { cleanupAll, fakeExec, makeRepo, signal, states, status } from './helpers.ts'

after(cleanupAll)

describe('staleness', () => {
  it('fresh results read as passed', async () => {
    const repo = await passedRepo()
    const r = await report(repo.env)
    assert.deepEqual(states(r), { 'export-tests': 'passed', typecheck: 'passed', 'zh-filename': 'passed' })
    assert.equal(r.summary, '3 项验收中，3 项通过')
  })

  it('uncommitted edit to a tracked file makes watching checks stale and names the file', async () => {
    const repo = await passedRepo()
    repo.write('src/export.ts', 'export const csv = 2\n')
    const r = await report(repo.env)
    assert.equal(status(r, 'export-tests').state, 'stale')
    assert.equal(status(r, 'export-tests').lastOutcome, 'passed')
    assert.deepEqual(status(r, 'export-tests').changes?.modified, ['src/export.ts'])
    assert.equal(status(r, 'typecheck').state, 'stale', 'no watch = whole workspace')
    assert.equal(status(r, 'zh-filename').state, 'stale', 'manual verdicts expire too')
  })

  it('a new untracked, non-ignored file makes results stale', async () => {
    const repo = await passedRepo()
    repo.write('src/new.ts', 'x\n')
    const r = await report(repo.env)
    assert.deepEqual(status(r, 'export-tests').changes?.added, ['src/new.ts'])
  })

  it('untracked ignored files do not affect results, but a tracked file matching .gitignore does', async () => {
    const repo = await passedRepo()
    repo.write('coverage/lcov.info', 'x\n')
    repo.write('debug.log', 'x\n')
    assert.equal((await report(repo.env)).summary, '3 项验收中，3 项通过')

    repo.write('src/keep.log', 'tracked\n')
    repo.git('add', '-f', 'src/keep.log')
    repo.git('commit', '-q', '-m', 'force-add')
    await runChecks(repo.env, fakeExec(), { signal: signal() })
    repo.write('src/keep.log', 'changed\n')
    assert.deepEqual(status(await report(repo.env), 'export-tests').changes?.modified, ['src/keep.log'])
  })

  it("files outside a check's watch do not affect it", async () => {
    const repo = await passedRepo()
    repo.write('README.md', '# changed\n')
    assert.deepEqual(states(await report(repo.env)), { 'export-tests': 'passed', typecheck: 'stale', 'zh-filename': 'passed' })
  })

  it('reverting to the original content restores validity', async () => {
    const repo = await passedRepo()
    repo.write('src/export.ts', 'export const csv = 2\n')
    assert.equal(status(await report(repo.env), 'export-tests').state, 'stale')
    repo.write('src/export.ts', 'export const csv = 1\n')
    assert.equal(status(await report(repo.env), 'export-tests').state, 'passed')
  })

  it('deleting a tracked file makes results stale and reports it as removed', async () => {
    const repo = await passedRepo()
    repo.remove('test/export.test.ts')
    assert.deepEqual(status(await report(repo.env), 'export-tests').changes?.removed, ['test/export.test.ts'])
  })

  it('committing changes nothing — including committing a deletion or a rename', async () => {
    const repo = await passedRepo()
    repo.write('src/export.ts', 'export const csv = 2\n')
    repo.remove('test/export.test.ts')
    repo.move('README.md', 'README.zh.md')
    const dirty = await report(repo.env)
    repo.git('add', '-A')
    repo.git('commit', '-q', '-m', 'edit, delete, rename')
    const committed = await report(repo.env)
    assert.deepEqual(committed.checks, dirty.checks)
  })

  it('editing done-check.yaml without changing a definition never changes anything', async () => {
    const repo = await passedRepo()
    repo.write('done-check.yaml', `# a comment\n${CHECKLIST}`)
    assert.equal((await report(repo.env)).summary, '3 项验收中，3 项通过')
  })

  it('editing one check marks only that check as definition_changed, and it cannot run until re-confirmed', async () => {
    const repo = await passedRepo()
    repo.write('done-check.yaml', CHECKLIST.replace('tsc --noEmit', 'exit 0'))
    assert.deepEqual(states(await report(repo.env)), { 'export-tests': 'passed', typecheck: 'definition_changed', 'zh-filename': 'passed' })
    const run = await runChecks(repo.env, fakeExec(), { ids: ['typecheck'], signal: signal() })
    assert.equal(run.ran.length, 0)
    assert.match(run.skipped[0]?.reason ?? '', /重新确认/)
    await confirm(repo.env)
    assert.equal(status(await report(repo.env), 'typecheck').state, 'not_run', 'the old result no longer counts')
  })

  it('unconfirmed checks and missing results have their own states', async () => {
    const repo = makeRepo(FILES)
    repo.write('done-check.yaml', CHECKLIST)
    const none = await report(repo.env)
    assert.deepEqual(Object.values(states(none)), ['unconfirmed', 'unconfirmed', 'unconfirmed'])
    assert.match(none.summary, /^清单未确认；/)
    const run = await runChecks(repo.env, fakeExec(), { signal: signal() })
    assert.equal(run.ran.length, 0, 'nothing runs before the user confirms')
    await confirm(repo.env)
    assert.deepEqual(Object.values(states(await report(repo.env))), ['not_run', 'not_run', 'awaiting_manual'])
  })

  it('handles non-ASCII paths', async () => {
    const repo = await passedRepo()
    repo.write('src/导出/文件名.ts', 'x\n')
    assert.deepEqual(status(await report(repo.env), 'export-tests').changes?.added, ['src/导出/文件名.ts'])
  })
})

describe('checklist structure', () => {
  it('deleting a failing check is flagged instead of silently improving the summary', async () => {
    const repo = makeRepo(FILES)
    repo.write('done-check.yaml', CHECKLIST)
    await confirm(repo.env)
    await runChecks(repo.env, fakeExec({ 'tsc --noEmit': { exitCode: 2 } }), { signal: signal() })
    await decide(repo.env, 'zh-filename', 'passed', '')
    assert.equal((await report(repo.env)).summary, '3 项验收中，2 项通过、1 项失败')

    repo.write('done-check.yaml', CHECKLIST.replace(/ {2}- id: typecheck\n.*\n.*\n/, ''))
    const r = await report(repo.env)
    assert.equal(r.structure, 'changed')
    assert.deepEqual(r.removed, [{ checkId: 'typecheck', lastOutcome: 'failed' }])
    assert.equal(r.summary, '清单结构已变，待确认（删除 typecheck（上次失败））；2 项验收中，2 项通过')
    assert.deepEqual(states(r), { 'export-tests': 'passed', 'zh-filename': 'passed' }, 'unchanged checks keep their evidence')

    await confirm(repo.env)
    assert.equal((await report(repo.env)).structure, 'confirmed')
  })

  it('adding a check or rewording the task also needs confirmation', async () => {
    const repo = await passedRepo()
    repo.write('done-check.yaml', `${CHECKLIST.replace('新增 CSV 导出功能', '新增 CSV 与 Excel 导出')}  - id: lint\n    name: lint 通过\n    run: pnpm lint\n`)
    const r = await report(repo.env)
    assert.equal(r.structure, 'changed')
    assert.deepEqual(r.added, ['lint'])
    assert.equal(r.taskChanged, true)
    assert.match(r.summary, /新增 lint；任务描述已改/)
  })
})

describe('watch coverage', () => {
  it('refuses to confirm a watch that matches no file', async () => {
    const repo = makeRepo(FILES)
    repo.write('done-check.yaml', CHECKLIST.replace('["src/**", "test/**"]', '["srcc/**"]'))
    await assert.rejects(confirm(repo.env), /export-tests: watch 没有匹配任何文件：srcc\/\*\*/)
  })

  it('a watch whose files were all deleted later is ordinary staleness, and re-running is refused', async () => {
    const repo = await passedRepo()
    repo.remove('src/export.ts')
    const r = await report(repo.env)
    assert.equal(status(r, 'zh-filename').state, 'stale')
    assert.deepEqual(status(r, 'zh-filename').changes?.removed, ['src/export.ts'])
    await assert.rejects(decide(repo.env, 'zh-filename', 'passed', ''), /没有匹配任何文件/)
  })
})
