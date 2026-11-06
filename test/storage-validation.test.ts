import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { after, it } from 'node:test'
import { confirm, report } from '../src/service.ts'
import { cleanupAll, status } from './helpers.ts'
import { passedRepo } from './fixtures.ts'

after(cleanupAll)

it('rejects incomplete or inconsistent evidence instead of showing passed', async () => {
  const repo = await passedRepo()
  const dir = await repo.env.store.dirFor(repo.root)
  const loaded = await repo.env.store.load(repo.root)
  assert.ok(loaded.ok)
  const path = join(dir, 'runs', `${loaded.state.latest['export-tests']}.json`)
  const original = JSON.parse(readFileSync(path, 'utf8'))
  for (const field of ['command', 'exitCode', 'finishedAt', 'durationMs', 'stdoutTail', 'log', 'unstable']) {
    const record = structuredClone(original)
    delete record[field]
    writeFileSync(path, JSON.stringify(record))
    assert.equal(status(await report(repo.env), 'export-tests').state, 'unknown', field)
  }
  for (const change of [{ exitCode: 1 }, { timedOut: true }, { checkId: 'another-check' }, { fingerprint: { digest: original.fingerprint.digest, files: {} } }, { kind: 'manual', note: '' }]) {
    writeFileSync(path, JSON.stringify({ ...original, ...change }))
    assert.equal(status(await report(repo.env), 'export-tests').state, 'unknown', JSON.stringify(change))
  }
  writeFileSync(path, JSON.stringify(original))
  assert.equal(status(await report(repo.env), 'export-tests').state, 'passed')
})

it('treats valid JSON with invalid state fields as unreadable and refuses to overwrite it', async () => {
  const repo = await passedRepo()
  const path = join(await repo.env.store.dirFor(repo.root), 'state.json')
  const original = JSON.parse(readFileSync(path, 'utf8'))
  for (const change of [{ latest: null }, { history: [] }, { active: null }, { confirmation: {} }, { cancelled: { check: '../escape' } }]) {
    const text = JSON.stringify({ ...original, ...change })
    writeFileSync(path, text)
    assert.ok((await report(repo.env)).checks.every((c) => c.state === 'unknown'))
    await assert.rejects(confirm(repo.env), /拒绝写入/)
    assert.equal(readFileSync(path, 'utf8'), text)
  }
})
