/**
 * The plugin booted on the real DSH 0.1.5 ToolRuntime, CommandRuntime and
 * SystemPrompt. Only the shell tool is a stand-in (a `pwsh`-named tool that
 * runs the command with the platform shell), so the registry, the nested
 * dispatch and the pre-execute permission pipeline are all the real thing.
 */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, describe, it } from 'node:test'
import { Context, Service } from '@deepseek-ai/cordis'
import CommandRuntime from '@deepseek-ai/dsh-commands'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { defineTool } from '@deepseek-ai/dsh-tools'
import { cleanupAll, makeRepo } from './helpers.ts'

process.env.DSH_HOME = mkdtempSync(join(tmpdir(), 'done-check-dshhome-'))
const plugin = await import('../src/plugin/index.ts')

const CHECKLIST = `
version: 1
task: 新增 CSV 导出功能
checks:
  - id: tests
    name: 测试通过
    run: node -e "process.exit(0)"
  - id: lint
    name: lint 通过
    run: 'node -e "console.error(''lint: 2 problems''); process.exit(1)"'
  - id: forbidden
    name: 被权限策略拒绝的命令
    run: node -e "require('fs').writeFileSync('pwned.txt', 'x')"
  - id: zh
    name: 中文文件名下载正常
    manual: true
`

let ctx: any
const shellCalls: { command: string; workdir: string; hasParent: boolean }[] = []

before(async () => {
  ctx = new Context()
  ctx.plugin(SystemPrompt)
  ctx.plugin(ToolRuntime)
  ctx.plugin(CommandRuntime)
  ctx.plugin({
    name: 'fake-pwsh',
    inject: ['tools'],
    apply(c: any) {
      c.tools.register(defineTool({
        name: 'pwsh',
        description: 'stand-in shell tool',
        parameters: {
          command: { type: 'string', required: true },
          description: { type: 'string', required: true },
          timeoutMs: { type: 'number' },
          workdir: { type: 'string' },
        },
        output: { schema: { type: 'json' }, render: () => [{ type: 'text', text: 'ran' }] },
        async execute(args: any, exec: any) {
          shellCalls.push({ command: args.command, workdir: args.workdir, hasParent: exec.parent !== undefined })
          const r = spawnSync(args.command, { shell: true, cwd: args.workdir, encoding: 'utf8' })
          return { kind: 'foreground', exitCode: r.status, signal: r.signal, timedOut: false, aborted: false, timeoutMs: args.timeoutMs ?? 0, stdout: { text: r.stdout, truncated: false }, stderr: { text: r.stderr, truncated: false } }
        },
      }))
      // A permission policy, as a deployment would install one: deny writes to pwned.txt.
      c.on('tools/pre-execute', async (exec: any, next: () => Promise<unknown>) =>
        exec.name === 'pwsh' && String(exec.arguments?.command).includes('pwned') ? { kind: 'deny', reason: 'policy: no writes' } : next())
    },
  })
  ctx.plugin(plugin)
  await new Promise((r) => setTimeout(r, 200))
})

after(cleanupAll)

const agentFor = (cwd: string) => ({ session: { header: { cwd } } })
let seq = 0
async function callTool(name: string, args: unknown, agent: unknown) {
  return ctx.tools.execute({ callId: `t${++seq}`, name, arguments: args, agent, signal: new AbortController().signal })
}
async function command(agent: unknown, input: string) {
  const def = ctx.commands.find(agent, 'done-check')
  assert.ok(def, 'done-check command is registered')
  return def.handler({ commandId: `c${++seq}`, agent, rawInput: input, attachments: [], signal: new AbortController().signal })
}

describe('plugin on the real DSH runtimes', () => {
  it('registers three agent tools and the /done-check command', () => {
    for (const t of ['done_check_draft', 'done_check_status', 'done_check_run']) assert.ok(ctx.tools.get(t), t)
  })

  it('walks the full flow: draft → user confirm → run via shell tool → evidence → edit → stale → re-run', async () => {
    const repo = makeRepo({ 'src/export.ts': 'export const csv = 1\n' })
    const agent = agentFor(repo.root)

    const draft = await callTool('done_check_draft', { yaml: CHECKLIST }, agent)
    assert.equal(draft.isError, false, JSON.stringify(draft.error ?? draft.content))
    assert.equal(draft.value.ok, true, JSON.stringify(draft.value.errors))
    repo.write('done-check.yaml', draft.value.normalized)

    const early = await callTool('done_check_run', {}, agent)
    assert.equal(early.value.ran.length, 0, 'nothing runs before the user confirms')
    assert.equal(shellCalls.length, 0)

    const confirmed = await command(agent, ' confirm')
    assert.equal(confirmed.kind, 'success')

    const run = await callTool('done_check_run', {}, agent)
    assert.equal(run.isError, false)
    assert.deepEqual(run.value.ran.map((r: any) => [r.id, r.outcome]), [['tests', 'passed'], ['lint', 'failed']])
    assert.equal(run.value.skipped[0].id, 'forbidden')
    assert.match(run.value.skipped[0].reason, /未执行：pwsh 工具拒绝或未能执行：.*policy: no writes/)
    assert.ok(shellCalls.every((c) => c.hasParent), 'agent-path commands are nested dispatches under the done_check_run call')
    assert.ok(shellCalls.every((c) => !c.command.includes('pwned')), 'the denied command never reached the shell tool')
    assert.equal(run.value.summary, '4 项验收中，1 项通过、1 项失败、1 项未执行、1 项待人工确认')

    const show = await command(agent, ' show lint')
    assert.match(show.text, /lint: 2 problems/)
    assert.match(show.text, /退出码 1/)

    const verdict = await command(agent, ' pass zh 手动下载了 报表.csv')
    assert.equal(verdict.kind, 'success')

    repo.write('src/export.ts', 'export const csv = 2\n')
    const stale = await callTool('done_check_status', {}, agent)
    assert.deepEqual(stale.value.checks.map((c: any) => c.state), ['stale', 'stale', 'not_run', 'stale'])
    assert.match(stale.value.markdown, /\| `tests` \| 测试通过 \| 自动 \| 已过期 \| 上次通过；修改 src\/export\.ts \|/)

    const userRun = await command(agent, ' run tests')
    assert.equal(userRun.kind, 'success')
    assert.ok(!shellCalls.at(-1)?.hasParent, 'user-path commands are root dispatches through the same pipeline')
    const after = await callTool('done_check_status', {}, agent)
    assert.equal(after.value.checks[0].state, 'passed')
  })

  it('the agent has no tool to confirm or to record a manual verdict', () => {
    const names = ctx.tools.schemas().map((s: any) => s.name).filter((n: string) => n.startsWith('done_check'))
    assert.deepEqual(names.sort(), ['done_check_draft', 'done_check_run', 'done_check_status'])
  })

  it('reports invalid drafts and empty watch matches without writing anything', async () => {
    const repo = makeRepo({ 'src/a.ts': 'a\n' })
    const bad = await callTool('done_check_draft', { yaml: 'version: 1\ntask: t\nchecks:\n  - {id: a, name: A, run: "true", watch: ["srcc/**"]}\n' }, agentFor(repo.root))
    assert.equal(bad.value.ok, false)
    assert.match(bad.value.errors[0], /watch 没有匹配任何文件/)
  })

  it('follows the workingDirectory service when the host provides one (DSH 0.2+)', async () => {
    const created = makeRepo({ 'a.txt': 'a\n' })
    const moved = makeRepo({ 'b.txt': 'b\n' })
    moved.write('done-check.yaml', 'version: 1\ntask: 移动后的项目\nchecks:\n  - {id: m, name: M, manual: true}\n')
    class WorkingDirectory extends (Service as any) {
      constructor(c: any) { super(c, 'workingDirectory') }
      get() { return moved.root }
    }
    const fiber = ctx.plugin(WorkingDirectory)
    await new Promise((r) => setTimeout(r, 100))
    try {
      const res = await command(agentFor(created.root), '')
      assert.equal(res.kind, 'success', res.text)
      assert.match(res.text, /移动后的项目/)
    } finally {
      fiber.dispose()
      await new Promise((r) => setTimeout(r, 50))
    }
    const back = await command(agentFor(created.root), '')
    assert.match(back.text, /没有 done-check\.yaml/, 'without the service it falls back to the session header cwd')
  })

  it('refuses outside a git repository with a clear message', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'done-check-nogit-'))
    const res = await command(agentFor(dir), '')
    assert.equal(res.kind, 'error')
    assert.match(res.text, /不在 git 仓库中/)
  })
})
