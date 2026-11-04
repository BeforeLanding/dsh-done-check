/**
 * Run-level trust rules: unstable runs, cancellation, "running", "unknown",
 * evidence limits and concurrent writers.
 */
import assert from 'node:assert/strict'
import { readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { after, describe, it } from 'node:test'
import { confirm, report, runChecks } from '../src/service.ts'
import { HISTORY_PER_CHECK, LOG_CAP_BYTES, StateStore, emptyState } from '../src/store/state.ts'
import { cleanupAll, fakeExec, makeRepo, outcome, signal, states, status } from './helpers.ts'
import { CHECKLIST, passedRepo } from './fixtures.ts'

after(cleanupAll)

describe('unstable runs', () => {
  it('a run during which the workspace changed stays unusable even after the files are restored', async () => {
    const repo = await passedRepo()
    const exec = fakeExec({}, (cmd) => {
      if (cmd === 'node --test') repo.write('src/export.ts', 'export const csv = 2\n')
    })
    await runChecks(repo.env, exec, { ids: ['export-tests'], signal: signal() })
    let s = status(await report(repo.env), 'export-tests')
    assert.equal(s.state, 'unstable')
    assert.match(s.reason ?? '', /src\/export\.ts.*须重跑/)

    repo.write('src/export.ts', 'export const csv = 1\n')
    s = status(await report(repo.env), 'export-tests')
    assert.equal(s.state, 'unstable', 'restoring the original content must not revive it')

    await runChecks(repo.env, fakeExec(), { ids: ['export-tests'], signal: signal() })
    assert.equal(status(await report(repo.env), 'export-tests').state, 'passed', 'a clean re-run does')
  })

  it('a check whose definition changed while it ran is unstable', async () => {
    const repo = await passedRepo()
    const exec = fakeExec({}, () => repo.write('done-check.yaml', CHECKLIST.replace('tsc --noEmit', 'exit 0')))
    await runChecks(repo.env, exec, { ids: ['typecheck'], signal: signal() })
    repo.write('done-check.yaml', CHECKLIST)
    const s = status(await report(repo.env), 'typecheck')
    assert.equal(s.state, 'unstable')
    assert.match(s.reason ?? '', /定义被修改/)
  })

  it('files generated during a run (e.g. snapshots) make it unstable, naming them', async () => {
    const repo = await passedRepo()
    await runChecks(repo.env, fakeExec({}, () => repo.write('test/__snapshots__/a.snap', 'x\n')), { ids: ['export-tests'], signal: signal() })
    assert.match(status(await report(repo.env), 'export-tests').reason ?? '', /test\/__snapshots__\/a\.snap/)
  })
})

describe('run outcomes', () => {
  it('timeouts and infrastructure failures are errors, not failures', async () => {
    const repo = await passedRepo()
    await runChecks(repo.env, fakeExec({ 'node --test': { exitCode: null, timedOut: true } }), { ids: ['export-tests'], signal: signal() })
    await runChecks(repo.env, async () => { throw new Error('shell not available') }, { ids: ['typecheck'], signal: signal() })
    const r = await report(repo.env)
    assert.equal(status(r, 'export-tests').state, 'error')
    assert.equal(status(r, 'typecheck').state, 'error')
  })

  it('a cancelled run is recorded as an attempt; the last completed result still shows, with a note', async () => {
    const repo = await passedRepo()
    const ac = new AbortController()
    await runChecks(repo.env, fakeExec({ 'node --test': { exitCode: null, aborted: true } }, () => ac.abort()), { ids: ['export-tests'], signal: ac.signal })
    const s = status(await report(repo.env), 'export-tests')
    assert.equal(s.state, 'passed')
    assert.equal(s.lastAttemptCancelled, true)
  })

  it('shows "running" while a check executes and refuses a second concurrent run of it', async () => {
    const repo = await passedRepo()
    let release!: () => void
    const gate = new Promise<void>((r) => { release = r })
    let midRun: Record<string, string> = {}
    let second: Awaited<ReturnType<typeof runChecks>> | undefined
    const first = runChecks(repo.env, async () => {
      midRun = states(await report(repo.env))
      second = await runChecks(repo.env, fakeExec(), { ids: ['export-tests'], signal: signal() })
      await gate
      return outcome()
    }, { ids: ['export-tests'], signal: signal() })
    setTimeout(release, 50)
    await first
    assert.equal(midRun['export-tests'], 'running')
    assert.match(second?.skipped[0]?.reason ?? '', /正在另一处执行/)
    assert.equal(status(await report(repo.env), 'export-tests').state, 'passed')
  })
})

describe('unknown', () => {
  it('a corrupt run record makes that check unknown, never passed', async () => {
    const repo = await passedRepo()
    const dir = join(await repo.env.store.dirFor(repo.root), 'runs')
    const loaded = await repo.env.store.load(repo.root)
    assert.ok(loaded.ok)
    writeFileSync(join(dir, `${loaded.state.latest['export-tests']}.json`), '{ broken')
    const s = status(await report(repo.env), 'export-tests')
    assert.equal(s.state, 'unknown')
    assert.match(s.reason ?? '', /证据无法读取/)
  })

  it('a corrupt state file makes everything unknown and is never overwritten', async () => {
    const repo = await passedRepo()
    writeFileSync(join(await repo.env.store.dirFor(repo.root), 'state.json'), 'not json')
    const r = await report(repo.env)
    assert.deepEqual(Object.values(states(r)), ['unknown', 'unknown', 'unknown'])
    await assert.rejects(confirm(repo.env), /拒绝写入/)
  })

  it('if the workspace cannot be read, checks with results are unknown', async () => {
    const repo = await passedRepo()
    const env = { ...repo.env, listFiles: async () => { throw new Error('git missing') } }
    const r = await report(env)
    assert.equal(status(r, 'export-tests').state, 'unknown')
    assert.match(status(r, 'export-tests').reason ?? '', /git missing/)
  })
})

describe('evidence storage', () => {
  it('caps the full log and marks the truncation', async () => {
    const repo = await passedRepo()
    const big = 'x'.repeat(LOG_CAP_BYTES * 2)
    const run = await runChecks(repo.env, fakeExec({ 'node --test': { stdout: big } }), { ids: ['export-tests'], signal: signal() })
    const rec = run.ran[0]
    assert.ok(rec?.log?.truncated)
    assert.equal(rec?.log?.originalBytes, Buffer.byteLength(big) + Buffer.byteLength('$ node --test\n--- stdout ---\n\n--- stderr ---\n\n'))
    assert.ok(rec.stdoutTail.length < 10 * 1024)
  })

  it(`keeps at most ${HISTORY_PER_CHECK} runs per check and never prunes the latest`, async () => {
    const repo = await passedRepo()
    for (let i = 0; i < HISTORY_PER_CHECK + 3; i++) {
      await runChecks(repo.env, fakeExec(), { ids: ['export-tests'], signal: signal() })
    }
    const loaded = await repo.env.store.load(repo.root)
    assert.ok(loaded.ok)
    const runs = readdirSync(join(await repo.env.store.dirFor(repo.root), 'runs'))
    const forCheck = loaded.state.history['export-tests'] ?? []
    assert.equal(forCheck.length, HISTORY_PER_CHECK)
    for (const id of forCheck) assert.ok(runs.includes(`${id}.json`))
    assert.ok(forCheck.includes(loaded.state.latest['export-tests'] ?? ''))
    assert.equal(status(await report(repo.env), 'export-tests').state, 'passed')
  })

  it('serializes writers across store instances (separate processes share only the lock)', async () => {
    const repo = makeRepo({ 'a.txt': 'a\n' })
    const stores = [new StateStore(repo.home), new StateStore(repo.home)]
    await Promise.all(Array.from({ length: 40 }, (_, i) =>
      stores[i % 2]!.update(repo.root, (s) => ({
        state: { ...s, latest: { ...s.latest, [`c${i}`]: String(i) } },
        value: undefined,
      }))))
    const loaded = await stores[0]!.load(repo.root)
    assert.ok(loaded.ok)
    assert.equal(Object.keys(loaded.state.latest).length, 40, 'no update was lost')
    assert.deepEqual({ ...loaded.state, latest: {} }, { ...emptyState(repo.root), latest: {} })
  })
})

describe('failure excerpt (v0.2)', () => {
  it('is stored on a failed run as display data only; the outcome and the log are unchanged', async () => {
    const repo = await passedRepo()
    repo.write('src/export.ts', 'export const csv = 2\n')
    await runChecks(repo.env, fakeExec({ 'node --test': { exitCode: 1, stderr: '\u001b[31mtoCsv mismatch\u001b[39m\n' } }), { ids: ['export-tests'], signal: signal() })
    const loaded = await repo.env.store.load(repo.root)
    assert.ok(loaded.ok)
    const rec = await repo.env.store.readRun(repo.root, loaded.state.latest['export-tests']!)
    assert.ok(!('corrupt' in rec) && rec.kind === 'auto')
    assert.deepEqual(rec.failureExcerpt, ['toCsv mismatch'])
    assert.equal(rec.outcome, 'failed')
    assert.match(rec.stderrTail, /toCsv mismatch/, 'the raw output is still kept in full')
  })

  it('is absent on a passing run, and old records without it still read back', async () => {
    const repo = await passedRepo()
    const loaded = await repo.env.store.load(repo.root)
    assert.ok(loaded.ok)
    const rec = await repo.env.store.readRun(repo.root, loaded.state.latest['export-tests']!)
    assert.ok(!('corrupt' in rec) && rec.kind === 'auto' && rec.failureExcerpt === undefined)
  })
})
