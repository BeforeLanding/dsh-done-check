/**
 * DSH plugin layer. Trust split (DESIGN.md §7–8):
 * - Agent tools may validate a draft, run confirmed automatic checks and read status.
 * - Only the human `/done-check` command can confirm the checklist or record a
 *   manual verdict — commands are executed by the UI, never by the model.
 * - Every check command is dispatched to the registered shell tool through
 *   `ctx.tools.execute`, so the session's permission policies apply to it.
 */
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-commands'
import { dshHomePath } from '@deepseek-ai/dsh-home-paths'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { CHECKLIST_FILE, parseChecklist, serializeChecklist } from '../core/checklist.ts'
import { fingerprintFor, snapshotWorkspace, watchCoverageError } from '../core/fingerprint.ts'
import { STATE_LABELS, type Report } from '../core/status.ts'
import { DoneCheckError, type ServiceEnv, confirm, decide, loadChecklist, report, runChecks } from '../service.ts'
import { StateStore } from '../store/state.ts'
import { renderEvidence, renderReport, renderRunSummary } from './render.ts'
import { type ToolsLike, toolExec } from './shell.ts'

export const name = 'dsh-done-check'
export const inject = ['tools', 'commands']

const execFileAsync = promisify(execFile)

interface AgentLike {
  readonly session?: { readonly header?: { readonly cwd?: string } }
}

/** The git top-level of the agent's session workspace. */
export async function projectRootFor(agent: unknown): Promise<string> {
  const cwd = (agent as AgentLike | undefined)?.session?.header?.cwd
  if (!cwd) throw new DoneCheckError('当前会话没有工作目录')
  try {
    const { stdout } = await execFileAsync('git', ['rev-parse', '--show-toplevel'], { cwd })
    return stdout.trim()
  } catch {
    throw new DoneCheckError(`工作目录不在 git 仓库中（v0.1 要求 git）：${cwd}`)
  }
}

function statusValue(r: Report) {
  return {
    summary: r.summary,
    structure: r.structure,
    checks: r.checks.map((c) => ({ id: c.checkId, state: c.state, label: STATE_LABELS[c.state], reason: c.reason, lastOutcome: c.lastOutcome })),
  }
}

const HELP = [
  '用法：',
  '- `/done-check` 或 `/done-check status`：查看验收状态',
  '- `/done-check confirm`：确认当前 `done-check.yaml`（只有你能确认）',
  '- `/done-check run [id …]`：执行已确认的自动检查（经由 shell 工具，按当前会话权限）',
  '- `/done-check pass <id> [备注]` / `/done-check fail <id> [备注]`：记录人工检查结论',
  '- `/done-check show <id>`：查看该项最近一次的证据',
].join('\n')

export function parseCommandInput(raw: string): { sub: string; args: string[]; rest: string } {
  const trimmed = raw.trim()
  const [sub = 'status', ...args] = trimmed.split(/\s+/).filter(Boolean)
  const rest = trimmed.slice(sub.length).trim()
  return { sub: sub.toLowerCase(), args, rest }
}

export function apply(ctx: Context): void {
  const store = new StateStore(dshHomePath('done-check'))
  const tools = ctx.tools as unknown as ToolsLike
  const envFor = async (agent: unknown): Promise<ServiceEnv> => ({ root: await projectRootFor(agent), store })

  ctx.tools.register(defineTool({
    name: 'done_check_draft',
    description:
      `Validate a proposed acceptance checklist for the current task before you save it as ${CHECKLIST_FILE} at the git root. ` +
      'Returns errors, or the normalized YAML to write with your file tool. Each check has id, name, and either run (a shell command) ' +
      'or manual: true; optional timeout (seconds), cwd, watch (globs). The user must confirm it with /done-check confirm — you cannot confirm it.',
    parameters: {
      yaml: { type: 'string', required: true, description: `Full ${CHECKLIST_FILE} content (version: 1, task, checks).` },
    },
    output: {
      schema: { type: 'json' },
      render: (_args, value) => {
        const v = value as { ok: boolean; errors: string[]; normalized: string | null; path: string }
        return [{
          type: 'text',
          text: v.ok
            ? `Checklist is valid. Write it to ${v.path}, then ask the user to review and run /done-check confirm.\n\n${v.normalized}`
            : `Checklist is invalid:\n- ${v.errors.join('\n- ')}`,
        }]
      },
    },
    async execute(args, exec) {
      const root = await projectRootFor(exec.agent)
      const parsed = parseChecklist(args.yaml)
      if (!parsed.ok) return { ok: false, errors: [...parsed.errors], normalized: null, path: `${root}/${CHECKLIST_FILE}` }
      const snapshot = await snapshotWorkspace(root)
      const errors = parsed.checklist.checks.flatMap((c) => {
        const e = watchCoverageError(c.watch, fingerprintFor(snapshot, c.watch))
        return e ? [`${c.id}: ${e}`] : []
      })
      return { ok: errors.length === 0, errors, normalized: errors.length ? null : serializeChecklist(parsed.checklist), path: `${root}/${CHECKLIST_FILE}` }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'done_check_status',
    description: 'Report the acceptance status of the current task: which agreed checks passed, failed, went stale after code changes, or still await the user. Passing checks do not prove the requirement is complete.',
    parameters: {},
    output: {
      schema: { type: 'json' },
      render: (_args, value) => [{ type: 'text', text: String((value as { markdown: string }).markdown) }],
    },
    async execute(_args, exec) {
      const env = await envFor(exec.agent)
      const r = await report(env)
      return { ...statusValue(r), markdown: renderReport(r, await loadChecklist(env.root)) }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'done_check_run',
    description:
      'Run the user-confirmed automatic acceptance checks (all, or the given ids) and record their evidence. Each command goes through the normal shell tool and its permission rules. ' +
      'Checks that are unconfirmed or changed since confirmation are skipped. Manual checks can only be decided by the user.',
    parameters: {
      ids: { type: 'array', items: { type: 'string' }, description: 'Check ids to run; omit to run every automatic check.' },
    },
    output: {
      schema: { type: 'json' },
      render: (_args, value) => [{ type: 'text', text: String((value as { markdown: string }).markdown) }],
    },
    async execute(args, exec) {
      const env = await envFor(exec.agent)
      const run = await runChecks(env, toolExec(tools, { agent: exec.agent, parent: exec.token, rootCallId: exec.rootCallId, callIdPrefix: exec.callId }), {
        ...(args.ids ? { ids: args.ids } : {}),
        signal: exec.signal,
      })
      const r = await report(env)
      return {
        ...statusValue(r),
        ran: run.ran.map((x) => ({ id: x.checkId, outcome: x.outcome, exitCode: x.exitCode, unstable: x.unstable !== null })),
        skipped: run.skipped.map((s) => ({ id: s.checkId, reason: s.reason })),
        markdown: `${renderRunSummary(run)}\n\n${renderReport(r, await loadChecklist(env.root))}`,
      }
    },
  }))

  ctx.commands.register({
    name: 'done-check',
    description: '验收清单：查看状态、确认清单、执行检查、记录人工结论',
    input: { hint: 'status | confirm | run [id…] | pass <id> [备注] | fail <id> [备注] | show <id>' },
    async handler(inv) {
      try {
        const env = await envFor(inv.agent)
        const { sub, args, rest } = parseCommandInput(inv.rawInput)
        const table = async () => renderReport(await report(env), await loadChecklist(env.root))
        switch (sub) {
          case 'status':
            return { kind: 'success', text: await table() }
          case 'confirm':
            await confirm(env)
            return { kind: 'success', text: `已确认清单。\n\n${await table()}` }
          case 'run': {
            const run = await runChecks(env, toolExec(tools, { agent: inv.agent, callIdPrefix: `command-${inv.commandId}` }), {
              ...(args.length ? { ids: args } : {}),
              signal: inv.signal,
            })
            return { kind: 'success', text: `${renderRunSummary(run)}\n\n${await table()}` }
          }
          case 'pass':
          case 'fail': {
            const id = args[0]
            if (!id) return { kind: 'error', text: `用法：/done-check ${sub} <id> [备注]` }
            await decide(env, id, sub === 'pass' ? 'passed' : 'failed', rest.slice(id.length).trim())
            return { kind: 'success', text: await table() }
          }
          case 'show': {
            const id = args[0]
            const checklist = await loadChecklist(env.root)
            const check = checklist.checks.find((c) => c.id === id)
            if (!check) return { kind: 'error', text: `清单中没有检查 ${id ?? ''}` }
            const loaded = await store.load(env.root)
            if (!loaded.ok) return { kind: 'error', text: `证据状态无法读取：${loaded.reason}` }
            const runId = loaded.state.latest[check.id]
            const rec = runId ? await store.readRun(env.root, runId) : undefined
            if (rec && 'corrupt' in rec) return { kind: 'error', text: rec.corrupt }
            return { kind: 'success', text: renderEvidence(rec, check.name) }
          }
          default:
            return { kind: 'success', text: HELP }
        }
      } catch (err) {
        return { kind: 'error', text: err instanceof DoneCheckError ? err.message : `done-check 出错：${(err as Error).message}` }
      }
    },
  })
}
