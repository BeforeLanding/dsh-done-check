import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { type ToolsLike, toolExec } from '../src/plugin/shell.ts'
import { NotExecutedError } from '../src/service.ts'
import { failureExcerpt, stripAnsi } from '../src/core/excerpt.ts'

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

describe('failureExcerpt', () => {
  const NODE_NOISE = "(node:5188) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.\n(Use `node --trace-warnings ...` to show where the warning was created)\n"

  it('quotes the last three meaningful stderr lines, without colour codes or runtime warnings', () => {
    const stderr = `${NODE_NOISE}\u001b[31mfirst\u001b[39m\nsecond\n\nthird\nfourth\n`
    assert.deepEqual(failureExcerpt('ignored', stderr), ['second', 'third', 'fourth'])
  })

  it('falls back to stdout when stderr only had warnings, and to nothing when there is no output', () => {
    assert.deepEqual(failureExcerpt('not ok 1 - toCsv mismatch\n', NODE_NOISE), ['not ok 1 - toCsv mismatch'])
    assert.deepEqual(failureExcerpt('', NODE_NOISE), [])
  })

  it('caps very long lines', () => {
    const [line] = failureExcerpt('', 'x'.repeat(500))
    assert.ok(line!.length <= 201 && line!.endsWith('…'))
  })
})
