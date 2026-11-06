import assert from 'node:assert/strict'
import { after, it } from 'node:test'
import { snapshotWorkspace, fingerprintFor } from '../src/core/fingerprint.ts'
import { cleanupAll, makeRepo } from './helpers.ts'

after(cleanupAll)

it('filters scopes before touching files and preserves the original content digest', async () => {
  const repo = makeRepo({ 'src/a.txt': 'abc', 'test/check.txt': 'checks', 'unrelated/large.bin': 'outside' })
  const paths = ['src/a.txt', 'test/check.txt', 'unrelated/large.bin']
  const full = await snapshotWorkspace(repo.root, async () => paths)
  // Reading this invalid, unrelated filename would throw on both supported OSes.
  const scoped = await snapshotWorkspace(repo.root, async () => [...paths, 'unrelated/' + 'x'.repeat(5000)], [['src/**'], ['test/**']])
  assert.deepEqual([...scoped.keys()], ['src/a.txt', 'test/check.txt'])
  assert.deepEqual(fingerprintFor(scoped, ['src/**']), fingerprintFor(full, ['src/**']))
  assert.deepEqual(await snapshotWorkspace(repo.root, async () => paths, [['src/**'], []]), full, 'one unscoped check requires every file')
  repo.write('src/a.txt', 'changed')
  assert.notEqual(fingerprintFor(await snapshotWorkspace(repo.root, async () => paths, [['src/**']]), ['src/**']).digest, fingerprintFor(scoped, ['src/**']).digest)
})
