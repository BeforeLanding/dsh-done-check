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
import { after, before, beforeEach, describe, it } from 'node:test'
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
beforeEach(() => { shellCalls.length = 0 })

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
  it('does not let another session preview on behalf of the confirming user', async () => {
    const repo = makeRepo({ 'src/a.ts': 'a\n' })
    repo.write('done-check.yaml', CHECKLIST)
    const first = agentFor(repo.root)
    const second = agentFor(repo.root)
    await command(first, '')
    repo.write('done-check.yaml', CHECKLIST.replace('新增 CSV 导出功能', 'Changed task'))
    await command(second, '')
    assert.match((await command(first, 'confirm')).text, /你还没看过这份清单/)
    assert.equal((await callTool('done_check_run', {}, first)).value.ran.length, 0)
    assert.equal(shellCalls.length, 0)
  })
  it('initializes a draft and localizes preview, status and evidence without altering raw output', async () => {
    const repo = makeRepo({ 'package.json': JSON.stringify({ scripts: { test: 'node -e "console.error(\'ORIGINAL_REPORT\');process.exit(1)"' } }) })
    const agent = agentFor(repo.root)
    await command(agent, 'lang en')
    const init = await command(agent, 'init')
    assert.match(init.text, /Draft created/)
    assert.match(init.text, /Nothing runs during preview/)
    assert.match((await command(agent, 'init')).text, /not overwritten/)
    const early = await callTool('done_check_run', {}, agent)
    assert.equal(early.value.ran.length, 0)
    assert.match(early.value.verdict, /review and confirm/)
    await command(agent, 'confirm')
    assert.match((await command(agent, '')).text, /ORIGINAL_REPORT/)
    assert.match((await command(agent, 'details 1')).text, /Exit code: 1/)
    assert.match((await callTool('done_check_status', {}, agent)).value.verdict, /failed/)
    assert.match((await command(agent, 'help')).text, /force-run/)
    assert.match((await command(agentFor(repo.root), 'help')).text, /常用/, 'language selection is session-scoped')
  })
  it('the agent tool obeys the same whole-checklist confirmation guard as user commands', async () => {
    const repo = makeRepo({ 'src/a.ts': 'a\n' })
    repo.write('done-check.yaml', CHECKLIST)
    const agent = agentFor(repo.root)
    await command(agent, '')
    await command(agent, 'confirm')
    repo.write('done-check.yaml', CHECKLIST.replace(/  - id: lint\n.*\n.*\n/, ''))
    const before = shellCalls.length
    const tool = await callTool('done_check_run', { ids: ['tests'] }, agent)
    assert.equal(tool.value.ran.length, 0)
    assert.match(tool.value.skipped[0].reason, /重新确认/)
    await command(agent, 'run tests')
    assert.equal(shellCalls.length, before)
  })
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

    const blind = await command(agent, ' 确认')
    assert.match(blind.text, /你还没看过这份清单/, 'confirming without a preview only shows the preview')
    assert.equal(shellCalls.length, 0)
    const preview = await command(agent, '')
    assert.match(preview.text.split('\n')[0]!, /等你确认（4 项）/)
    assert.match(preview.text, /\$ node -e "process.exit\(0\)"/, 'the preview shows the commands that will run')
    assert.equal(shellCalls.length, 0, 'a preview runs nothing')
    const confirmed = await command(agent, ' 确认')
    assert.equal(confirmed.kind, 'success')
    assert.match(confirmed.text, /已确认/)

    const run = await callTool('done_check_run', {}, agent)
    assert.equal(run.isError, false)
    assert.deepEqual(run.value.ran.map((r: any) => [r.id, r.outcome]), [['tests', 'passed'], ['lint', 'failed']])
    assert.equal(run.value.skipped[0].id, 'forbidden')
    assert.match(run.value.skipped[0].reason, /未执行：pwsh 工具未能执行：.*policy: no writes/)
    assert.ok(shellCalls.every((c) => c.hasParent), 'agent-path commands are nested dispatches under the done_check_run call')
    assert.ok(shellCalls.every((c) => !c.command.includes('pwned')), 'the denied command never reached the shell tool')
    assert.equal(run.value.verdict, '❌ 新增 CSV 导出功能还有 1 项检查未通过')
    assert.match(run.value.nextStep, /让 Agent 排查/)
    assert.match(run.value.markdown, /测试报告：lint: 2 problems/)
    assert.match(run.value.markdown, /命令被权限设置拒绝，没有执行/)

    const show = await command(agent, ' 详情 lint')
    assert.match(show.text, /lint: 2 problems/)
    assert.match(show.text, /退出码 1/)
    const legacy = await command(agent, ' show lint')
    assert.equal(legacy.text, show.text, 'the old show alias still works')

    const verdict = await command(agent, ' ok 手动下载了 报表.csv')
    assert.equal(verdict.kind, 'success')

    repo.write('src/export.ts', 'export const csv = 2\n')
    const stale = await callTool('done_check_status', {}, agent)
    assert.deepEqual(stale.value.checks.map((c: any) => c.state), ['stale', 'stale', 'not_run', 'stale'])
    // The refused command's reason is remembered across commands, and outranks "re-check".
    assert.equal(stale.value.verdict, '⚠️ 1 项检查没能运行，结果未知')
    assert.match(stale.value.markdown, /原因：命令被权限设置拒绝，没有执行/)
    assert.equal(stale.value.checks[2].state, 'not_run', 'the derived state is unchanged: no result exists')

    const userRun = await command(agent, ' run tests')
    assert.equal(userRun.kind, 'success')
    assert.ok(!shellCalls.at(-1)?.hasParent, 'user-path commands are root dispatches through the same pipeline')
    const after = await callTool('done_check_status', {}, agent)
    assert.equal(after.value.checks[0].state, 'passed')

    // The bare command does the next thing that is due: lint is stale, forbidden was never checked; tests stays untouched.
    const before = shellCalls.length
    const smart = await command(agent, '')
    assert.deepEqual(shellCalls.slice(before).map((c) => c.command.includes('lint:') ? 'lint' : 'other'), ['lint'], 'only the due check ran; the denied one never reached the shell')
    const lines = smart.text.split('\n')
    assert.equal(lines[0], '❌ 新增 CSV 导出功能还有 1 项检查未通过')
    assert.match(smart.text, /⚠️ 被权限策略拒绝的命令\n   原因：命令被权限设置拒绝，没有执行\n   这不是检查失败，也不表示功能测过了。/)
    assert.doesNotMatch(smart.text, /export-tests|[0-9a-f]{12}|\bms\b|毫秒/, 'the default summary carries no internal ids, hashes or timings')
  })

  it('refuses to record a verdict on an automatic check or an unknown number', async () => {
    const repo = makeRepo({ 'src/a.ts': 'a\n' })
    repo.write('done-check.yaml', CHECKLIST)
    const agent = agentFor(repo.root)
    await command(agent, '')
    await command(agent, ' confirm')
    assert.match((await command(agent, ' ok 1')).text, /是自动检查/)
    assert.match((await command(agent, ' ok 9')).text, /没有第 9 项/)
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
