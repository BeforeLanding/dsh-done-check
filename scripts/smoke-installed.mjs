// Run only against the installed tarball and installed DSH runtime dependencies.
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const installation = resolve(process.argv[2])
process.env.DSH_HOME = join(installation, 'isolated-dsh-home')
const require = createRequire(join(installation, 'package.json'))
const load = (name) => import(pathToFileURL(require.resolve(name)).href)
const { Context } = await load('@deepseek-ai/cordis')
const { default: Tools, defineTool } = await load('@deepseek-ai/dsh-tools')
const { default: Commands } = await load('@deepseek-ai/dsh-commands')
const { default: SystemPrompt } = await load('@deepseek-ai/dsh-system-prompt')
const plugin = await load('dsh-done-check/plugin')
const api = await load('dsh-done-check')
assert.equal(typeof api.runChecks, 'function')
const project = join(installation, 'project')
mkdirSync(project)
execFileSync('git', ['init', '-q'], { cwd: project })
const yaml = `version: 1
task: Packed plugin smoke test
checks:
  - {id: pass, name: Successful process, run: 'node -e "console.log(''PACKED_OK'')"'}
  - {id: fail, name: Failing process, run: 'node -e "process.exit(2)"'}
  - {id: denied, name: Denied command, run: 'node -e "process.exit(13)"'}
  - {id: manual, name: Manual acceptance fixture, manual: true, how: 'Test fixture only; no human acceptance is claimed.'}
`
writeFileSync(join(project, 'done-check.yaml'), yaml)
const ctx = new Context()
ctx.plugin(SystemPrompt)
ctx.plugin(Tools)
ctx.plugin(Commands)
let calls = 0
ctx.plugin({ name: 'smoke-process-executor', inject: ['tools'], apply(c) {
  c.tools.register(defineTool({ name: process.platform === 'win32' ? 'pwsh' : 'bash', description: 'Smoke test process executor',
    parameters: { command: { type: 'string', required: true }, description: { type: 'string', required: true }, timeoutMs: { type: 'number' }, workdir: { type: 'string' } },
    output: { schema: { type: 'json' }, render: () => [{ type: 'text', text: 'Process result' }] },
    async execute(args) {
      calls++
      const result = spawnSync(args.command, { shell: true, cwd: args.workdir, encoding: 'utf8', timeout: args.timeoutMs })
      return { kind: 'foreground', exitCode: result.status, signal: result.signal, timedOut: false, aborted: false,
        stdout: { text: result.stdout ?? '', truncated: false }, stderr: { text: result.stderr ?? '', truncated: false } }
    } }))
  c.on('tools/pre-execute', async (exec, next) => String(exec.arguments?.command).includes('exit(13)') ? { kind: 'deny', reason: 'smoke permission denial' } : next())
} })
ctx.plugin(plugin, { language: 'en' })
const agent = { session: { header: { cwd: project } } }
let command
for (let i = 0; i < 100; i++) {
  command = ctx.commands?.find(agent, 'done-check')
  if (command) break
  await new Promise((r) => setTimeout(r, 20))
}
assert.ok(command, 'Installed plugin must register with the actual DSH runtimes')
let seq = 0
const invoke = (input) => command.handler({ commandId: `command-${++seq}`, agent, rawInput: input, attachments: [], signal: new AbortController().signal })
const tool = () => ctx.tools.execute({ callId: `tool-${++seq}`, name: 'done_check_run', arguments: {}, agent, signal: new AbortController().signal })
assert.match((await invoke('')).text, /review and confirm/)
assert.equal(calls, 0)
await invoke('confirm')
const result = await tool()
assert.equal(result.isError, false, JSON.stringify(result))
assert.deepEqual(result.value.ran.map((r) => r.outcome), ['passed', 'failed'])
assert.equal(calls, 2, 'permission denial must not reach the executor')
assert.equal(result.value.skipped[0].id, 'denied')
assert.match((await invoke('details 1')).text, /PACKED_OK/)
writeFileSync(join(project, 'done-check.yaml'), yaml.replace('Packed plugin smoke test', 'Changed task'))
assert.equal((await tool()).value.ran.length, 0)
assert.equal(calls, 2, 'changed checklist must block tool execution')
console.log('PASS: installed tarball exports, real DSH registries, process execution, permission denial, evidence, confirmation guard')
