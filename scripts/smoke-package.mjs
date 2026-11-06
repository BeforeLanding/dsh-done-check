import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const version = process.argv[2] ?? '0.1.5-rc.3'
assert.match(version, /^0\.[12]\.\d+(?:-rc\.\d+)?$/)
// npm run supplies its own CLI path. No shell command strings are assembled.
const npm = process.env.npm_execpath
assert.ok(npm && existsSync(npm) && /npm-cli\.js$/.test(npm), 'Run this check with npm run smoke:package')
const temp = mkdtempSync(join(tmpdir(), 'done-check-package-'))
const install = join(temp, 'installation')
mkdirSync(install)
try {
  const packed = JSON.parse(execFileSync(process.execPath, [npm, 'pack', '--ignore-scripts', '--json', '--pack-destination', temp], { cwd: root, encoding: 'utf8' }))[0]
  assert.ok(packed.files.some((f) => f.path === 'lib/plugin/index.js'))
  assert.ok(!packed.files.some((f) => f.path.startsWith('docs/video/') || f.path.startsWith('test/')))
  writeFileSync(join(install, 'package.json'), JSON.stringify({ name: 'done-check-install-smoke', version: '1.0.0', private: true, type: 'module' }))
  const peers = ['dsh-tools', 'dsh-commands', 'dsh-home-paths', 'dsh-system-prompt'].map((p) => `@deepseek-ai/${p}@${version}`)
  const cordis = version.startsWith('0.2.') ? '4.0.5' : '4.0.2'
  execFileSync(process.execPath, [npm, 'install', '--ignore-scripts', '--no-audit', '--no-fund', '--package-lock=false', join(temp, packed.filename), `@deepseek-ai/cordis@${cordis}`, ...peers], { cwd: install, stdio: 'inherit' })
  execFileSync(process.execPath, [join(root, 'scripts/smoke-installed.mjs'), install], { cwd: install, stdio: 'inherit' })
  console.log(`PASS: npm tarball installed against DSH runtimes ${version}`)
} finally {
  // Only remove this freshly created, verified temporary workspace.
  assert.equal(dirname(resolve(temp)), resolve(tmpdir()))
  assert.ok(temp.includes('done-check-package-'))
  rmSync(temp, { recursive: true, force: true })
}
