import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { copyFileSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { StateStore, confirm, runChecks, report, decide } from '../lib/index.js'

const root = mkdtempSync(join(tmpdir(), 'done-check-example-'))
const project = join(root, 'project')
const { mkdirSync } = await import('node:fs')
mkdirSync(project)
const example = fileURLToPath(new URL('../examples/csv-export/', import.meta.url))
try {
  for (const file of readdirSync(example)) copyFileSync(join(example, file), join(project, file))
  execFileSync('git', ['init', '-q'], { cwd: project })
  const env = { root: project, store: new StateStore(join(root, 'evidence')) }
  const exec = async (req) => {
    const result = spawnSync(req.command, { shell: true, cwd: req.cwd, encoding: 'utf8', timeout: req.timeoutMs })
    if (result.error) throw result.error
    return { exitCode: result.status, signal: result.signal, timedOut: false, aborted: false, infraError: null, stdout: result.stdout, stderr: result.stderr, shell: 'example-process' }
  }
  const signal = new AbortController().signal
  await confirm(env)
  assert.deepEqual((await runChecks(env, exec, { signal })).ran.map((r) => r.outcome), ['passed', 'failed'])
  execFileSync(process.execPath, ['demo.mjs', 'fix'], { cwd: project })
  assert.deepEqual((await runChecks(env, exec, { signal })).ran.map((r) => r.outcome), ['passed', 'passed'])
  // Simulated manual verdict is only a state-transition fixture, not spreadsheet QA.
  await decide(env, 'spreadsheet-review', 'passed', 'Automated state-transition fixture')
  execFileSync(process.execPath, ['demo.mjs', 'stale'], { cwd: project })
  assert.deepEqual((await report(env)).checks.map((c) => c.state), ['stale', 'stale', 'stale'])
  console.log('PASS: CSV example fails, fixes, passes and expires using the built service and real processes')
} finally {
  assert.equal(dirname(resolve(root)), resolve(tmpdir()))
  assert.ok(root.includes('done-check-example-'))
  rmSync(root, { recursive: true, force: true })
}
