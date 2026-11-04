import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { type ToolsLike, toolExec } from '../src/plugin/shell.ts'
import { NotExecutedError } from '../src/service.ts'
import { stripAnsi } from '../src/plugin/render.ts'

const fg = (exitCode: number) => ({ kind: 'foreground', exitCode, signal: null, timedOut: false, aborted: false, timeoutMs: 1, stdout: { text: 'out', truncated: false }, stderr: { text: '', truncated: false } })
const unknown = (name: string) => ({ isError: true as const, error: { message: `unknown tool "${name}"`, info: { name: 'ToolNotFoundError', code: 'UNKNOWN_TOOL' } } })

/** A registry where only some shell tools are visible to the agent, as with scoped registration. */
function registry(visible: Record<string, (args: any) => any>): ToolsLike & { calls: string[] } {
  const calls: string[] = []
  return {
    calls,
    async execute(input) {
      calls.push(input.name)
      const fn = visible[input.name]
      return fn ? fn(input.arguments) : unknown(input.name)
    },
  }
}

const req = { command: 'node -v', cwd: 'D:/x', timeoutMs: 1000, signal: new AbortController().signal }
const origin = { agent: {}, callIdPrefix: 't' }

describe('toolExec', () => {
  it('prefers pwsh on Windows and falls back to bash when pwsh is not visible to the agent', async () => {
    const tools = registry({ bash: () => ({ isError: false, value: fg(0) }) })
    const out = await toolExec(tools, origin, 'win32')(req)
    assert.deepEqual(tools.calls, ['pwsh', 'bash'])
    assert.equal(out.shell, 'bash')
    assert.equal(out.exitCode, 0)
  })

  it('never falls back to anything else when no shell tool is visible', async () => {
    const tools = registry({})
    await assert.rejects(toolExec(tools, origin, 'linux')(req), (e) => e instanceof NotExecutedError && /没有可用的 pwsh 或 bash/.test(e.message))
  })

  it('a policy denial is "not executed", not a failure, and does not try another shell', async () => {
    const tools = registry({ bash: () => ({ isError: true, error: { message: 'denied by policy', info: { name: 'X', code: 'POLICY_DENIED' } } }), pwsh: () => ({ isError: false, value: fg(0) }) })
    await assert.rejects(toolExec(tools, origin, 'linux')(req), (e) => e instanceof NotExecutedError && /denied by policy/.test(e.message))
    assert.deepEqual(tools.calls, ['bash'])
  })

  it('maps cancellation and sandbox runner failures', async () => {
    const aborted = registry({ bash: () => ({ isError: true, error: { message: 'aborted', info: { name: 'X', code: 'ABORTED' } } }) })
    assert.equal((await toolExec(aborted, origin, 'linux')(req)).aborted, true)
    const runner = registry({ bash: () => ({ isError: false, value: { ...fg(1), sandbox: { mode: 'read-only', denied: false, runnerFailed: true } } }) })
    await assert.rejects(toolExec(runner, origin, 'linux')(req), /沙箱运行器/)
  })

  it('passes the check command, timeout and workdir through unchanged', async () => {
    let seen: any
    const tools = registry({ bash: (args) => { seen = args; return { isError: false, value: fg(3) } } })
    const out = await toolExec(tools, origin, 'linux')(req)
    assert.deepEqual({ command: seen.command, timeoutMs: seen.timeoutMs, workdir: seen.workdir }, { command: 'node -v', timeoutMs: 1000, workdir: 'D:/x' })
    assert.equal(out.exitCode, 3)
  })
})

describe('stripAnsi', () => {

  it('removes colour codes and normalizes CRLF', () => {
    assert.equal(stripAnsi('\u001b[90m    at x\u001b[39m\r\nok'), '    at x\nok')
  })
})

describe('renderReportText', () => {
  it('pads only the ASCII id column and puts CJK text on its own lines', async () => {
    const { renderReportText } = await import('../src/plugin/render.ts')
    const checklist = { version: 1 as const, task: '新增 CSV 导出', checks: [
      { id: 'export-tests', name: '导出测试通过', run: 'x', manual: false, timeout: 300, cwd: '.', watch: [] },
      { id: 'zh', name: '中文文件名', run: null, manual: true, timeout: 0, cwd: '.', watch: [] },
    ] }
    const st = (checkId: string, state: any, extra = {}) => ({ checkId, state, lastOutcome: null, changes: null, reason: null, lastAttemptCancelled: false, ...extra })
    const text = renderReportText({ structure: 'confirmed', taskChanged: false, added: [], removed: [], summary: '2 项验收中，1 项已过期、1 项待人工确认',
      checks: [st('export-tests', 'stale', { lastOutcome: 'passed', changes: { modified: ['src/a.mjs'], added: [], removed: [] } }), st('zh', 'awaiting_manual')] }, checklist)
    assert.ok(text.includes('export-tests  已过期\n  导出测试通过\n  上次通过；修改 src/a.mjs'), text)
    assert.ok(text.includes('zh            待人工确认\n  中文文件名（人工）'), text)
    assert.ok(!text.includes('|'), 'no Markdown table syntax')
  })
})
