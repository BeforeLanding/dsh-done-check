/**
 * The only way done-check runs a command: dispatch it to the shell tool the
 * composition already registered (`pwsh` / `bash`) through `ctx.tools.execute`,
 * so every permission policy, guard and approval prompt that applies to the
 * agent's own shell calls sees the exact command. There is deliberately no
 * fallback to `ctx.shell`: if the dispatch is refused, the check did not run.
 */
import { randomBytes } from 'node:crypto'
import type { NotExecutedKind } from '../core/status.ts'
import type { Exec, ExecOutcome } from '../service.ts'
import { NotExecutedError } from '../service.ts'

/** The slice of `ctx.tools` this adapter needs (structural, so tests can fake it). */
export interface ToolsLike {
  execute(input: {
    readonly callId: never
    readonly rootCallId?: never
    readonly name: string
    readonly arguments: unknown
    readonly agent?: never
    readonly parent?: never
    readonly signal: AbortSignal
  }): Promise<
    | { readonly isError: false; readonly value: unknown }
    | { readonly isError: true; readonly error: { readonly message: string; readonly info?: { readonly code: string } } }
  >
}

/** Who the dispatch is on behalf of: the calling agent, plus the outer tool call when there is one. */
export interface DispatchOrigin {
  readonly agent: unknown
  readonly parent?: unknown
  readonly rootCallId?: string
  readonly callIdPrefix: string
}

const ABORT_CODES = new Set(['ABORTED', 'ABORTED_BEFORE_DISPATCH'])
const UNKNOWN_TOOL = 'UNKNOWN_TOOL'

/** Shell tools to try, preferred first. */
export function shellToolOrder(platform: NodeJS.Platform = process.platform): readonly ('pwsh' | 'bash')[] {
  return platform === 'win32' ? ['pwsh', 'bash'] : ['bash', 'pwsh']
}

interface ForegroundValue {
  kind: 'foreground'
  exitCode: number | null
  signal: string | null
  timedOut: boolean
  aborted: boolean
  stdout: { text: string }
  stderr: { text: string }
  sandbox?: { mode: string; runnerFailed?: boolean }
}

function isForeground(v: unknown): v is ForegroundValue {
  const o = v as ForegroundValue | null
  return !!o && o.kind === 'foreground' && typeof o.timedOut === 'boolean' && typeof o.stdout?.text === 'string'
}

export function toolExec(tools: ToolsLike, origin: DispatchOrigin, platform: NodeJS.Platform = process.platform): Exec {
  let n = 0
  return async (req): Promise<ExecOutcome> => {
    // Tools are registered per agent scope in real compositions, so visibility
    // is only known by dispatching as that agent: an UNKNOWN_TOOL answer means
    // "not available to this agent", and the next shell is tried.
    for (const tool of shellToolOrder(platform)) {
      const callId = `${origin.callIdPrefix}:done-check:${++n}:${randomBytes(3).toString('hex')}`
      const res = await tools.execute({
        callId: callId as never,
        ...(origin.rootCallId !== undefined ? { rootCallId: origin.rootCallId as never } : {}),
        name: tool,
        arguments: { command: req.command, description: 'done-check acceptance check', timeoutMs: req.timeoutMs, workdir: req.cwd },
        agent: origin.agent as never,
        ...(origin.parent !== undefined ? { parent: origin.parent as never } : {}),
        signal: req.signal,
      })
      if (res.isError) {
        const code = res.error.info?.code
        if (code === UNKNOWN_TOOL) continue
        if (code && ABORT_CODES.has(code)) {
          return { exitCode: null, signal: null, timedOut: false, aborted: true, infraError: null, stdout: '', stderr: '', shell: tool }
        }
        throw new NotExecutedError(`${tool} 工具未能执行：${res.error.message}`, classifyRefusal(res.error.message), res.error.message)
      }
      return toOutcome(tool, res.value)
    }
    throw new NotExecutedError('当前 Agent 没有可用的 pwsh 或 bash 工具', 'no_shell')
  }
}

const SANDBOX_SIGNS = /sandbox|沙箱|SetNamedSecurityInfo|Win32|ACL/i
const DENIAL_SIGNS = /den(y|ied)|refus|reject|forbid|not allowed|permission|approval|policy|拒绝|禁止|不允许|未批准|权限/i

/** Best-effort reading of why the shell tool refused. Unrecognized messages stay 'other' and are shown as they are. */
export function classifyRefusal(message: string): NotExecutedKind {
  if (SANDBOX_SIGNS.test(message)) return 'sandbox'
  if (DENIAL_SIGNS.test(message)) return 'denied'
  return 'other'
}

function toOutcome(tool: string, value: unknown): ExecOutcome {
  if (!isForeground(value)) throw new NotExecutedError(`${tool} 工具没有返回前台执行结果`, 'other')
  const v = value
  if (v.sandbox?.runnerFailed) throw new NotExecutedError(`沙箱运行器在 ${v.sandbox.mode} 模式下失败，命令没有运行`, 'sandbox', `${v.sandbox.mode} 模式下运行器失败`)
  return {
    exitCode: v.exitCode,
    signal: v.signal,
    timedOut: v.timedOut,
    aborted: v.aborted,
    infraError: null,
    stdout: v.stdout.text,
    stderr: v.stderr.text,
    shell: v.sandbox ? `${tool} (sandbox: ${v.sandbox.mode})` : tool,
  }
}
