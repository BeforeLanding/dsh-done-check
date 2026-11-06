import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { after, it } from 'node:test'
import { initializeChecklist } from '../src/core/init.ts'
import { parseChecklist } from '../src/core/checklist.ts'
import { cleanupAll, makeRepo } from './helpers.ts'

after(cleanupAll)

it('creates an honest draft from real package scripts without executing or overwriting anything', async () => {
  const repo = makeRepo({ 'package.json': JSON.stringify({ packageManager: 'pnpm@11.7.0', scripts: { test: 'node -e "process.exit(1)"', lint: 'lint-command' } }) })
  assert.equal(await initializeChecklist(repo.root, 'en'), true)
  const path = join(repo.root, 'done-check.yaml')
  const text = readFileSync(path, 'utf8')
  const parsed = parseChecklist(text)
  assert.ok(parsed.ok)
  assert.deepEqual(parsed.checklist.checks.map((c) => c.run), ['pnpm run test', 'pnpm run lint', null])
  assert.match(parsed.checklist.checks[2]!.how!, /Replace this instruction/)
  assert.equal(await initializeChecklist(repo.root, 'zh'), false)
  assert.equal(readFileSync(path, 'utf8'), text)
  assert.equal(existsSync(join(repo.home, 'state.json')), false)
})

it('creates only a manual review if no genuine test command is available', async () => {
  const repo = makeRepo({ 'package.json': JSON.stringify({ scripts: { test: 'echo "Error: no test specified" && exit 1' } }) })
  await initializeChecklist(repo.root, 'zh')
  const parsed = parseChecklist(readFileSync(join(repo.root, 'done-check.yaml'), 'utf8'))
  assert.ok(parsed.ok)
  assert.equal(parsed.checklist.checks.length, 1)
  assert.equal(parsed.checklist.checks[0]!.manual, true)
})

it('works without package.json and leaves existing files alone even if package.json is invalid', async () => {
  const repo = makeRepo({ 'README.md': 'A non-Node project' })
  assert.equal(await initializeChecklist(repo.root, 'en'), true)
  const path = join(repo.root, 'done-check.yaml')
  const text = readFileSync(path, 'utf8')
  repo.write('package.json', 'not json')
  assert.equal(await initializeChecklist(repo.root, 'en'), false)
  assert.equal(readFileSync(path, 'utf8'), text)
})
