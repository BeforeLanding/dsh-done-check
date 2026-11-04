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
import {
  DoneCheckError, PreviewMismatchError, type ServiceEnv, type View, confirm, decide, previewDigest, runChecks, view,
} from '../service.ts'
import { StateStore } from '../store/state.ts'
import {
  type NotRunReasons, confirmedHeadline, dueAutoChecks, draftWarnings, itemLabel, itemsOf, needsConfirmation, notRunReasons, pendingManual,
  problemItems, renderAll, renderDetails, renderSummary, resolveItem, runNote, verdictOf,
} from './present.ts'
import { type ToolsLike, toolExec } from './shell.ts'

export const name = 'dsh-done-check'
export const inject = ['tools', 'commands']

const execFileAsync = promisify(execFile)

interface AgentLike {
  readonly session?: { readonly header?: { readonly cwd?: string } }
}

/** DSH 0.2+ service: the session's current working directory (it can change mid-session). */
export interface WorkingDirectoryLike {
  get(session: unknown): string
}

/**
 * The git top-level of the agent's current working directory. Uses the
 * `workingDirectory` service when the host has one (0.2+), else the
 * directory the session was created in (0.1.x).
 */
export async function projectRootFor(agent: unknown, workingDirectory?: WorkingDirectoryLike): Promise<string> {
  const session = (agent as AgentLike | undefined)?.session
  const cwd = workingDirectory && session ? workingDirectory.get(session) : session?.header?.cwd
  if (!cwd) throw new DoneCheckError('当前会话没有工作目录')
  try {
    const { stdout } = await execFileAsync('git', ['rev-parse', '--show-toplevel'], { cwd })
    return stdout.trim()
  } catch {
    throw new DoneCheckError(`工作目录不在 git 仓库中（v0.1 要求 git）：${cwd}`)
  }
}

function statusValue(v: View, notRun?: NotRunReasons) {
  const verdict = verdictOf(v, notRun)
  return {
    verdict: verdict.headline,
    nextStep: verdict.nextStep,
    structure: v.report.structure,
    checks: itemsOf(v, notRun).map((i) => ({
      id: i.check.id, number: i.n, name: i.check.name, state: i.status.state, label: itemLabel(i), reason: i.notRunReason ?? i.status.reason, lastOutcome: i.status.lastOutcome,
    })),
  }
}

const HELP = [
  '/done-check 一个命令走完主路径：先预览清单，确认后执行检查并给出结论。',
  '',
  '常用：',
  '- /done-check：按当前状态做下一件该做的事（预览清单 / 执行检查 / 看结论）',
  '- /done-check 确认：确认刚预览过的清单（只有你能确认）',
  '- /done-check ok [序号] / no [序号] [备注]：记录人工项的结论',
  '- /done-check 详情 [序号]：命令、退出码、输出末尾、变化的文件',
  '- /done-check 全部：每一项的状态和详情',
  '- /done-check 技术详情 [序号]：执行器、指纹、日志路径',
  '- /done-check 重新检查：强制重跑全部自动检查',
  '',
  '英文写法等价：confirm / ok / no / details / all / tech / run。旧写法 show、pass、fail 仍可用，下个版本移除。',
].join('\n')

export type Subcommand = 'smart' | 'status' | 'confirm' | 'ok' | 'no' | 'details' | 'all' | 'tech' | 'run' | 'help' | 'unknown'

const ALIASES: Readonly<Record<string, Subcommand>> = {
  '': 'smart', status: 'status', 状态: 'status',
  confirm: 'confirm', 确认: 'confirm',
  ok: 'ok', pass: 'ok', 通过: 'ok',
  no: 'no', fail: 'no', 未通过: 'no',
  details: 'details', detail: 'details', show: 'details', 详情: 'details',
  all: 'all', 全部: 'all',
  tech: 'tech', 技术详情: 'tech',
  run: 'run', 重新检查: 'run',
  help: 'help', 帮助: 'help',
}

export function parseCommandInput(raw: string): { sub: Subcommand; word: string; args: string[]; rest: string } {
  const trimmed = raw.trim()
  const [word = '', ...args] = trimmed.split(/\s+/).filter(Boolean)
  return { sub: ALIASES[word.toLowerCase()] ?? 'unknown', word, args, rest: trimmed.slice(word.length).trim() }
}

export function apply(ctx: Context): void {
  const store = new StateStore(dshHomePath('done-check'))
  const tools = ctx.tools as unknown as ToolsLike
  // Optional: present on DSH 0.2+, absent on 0.1.x (then this callback never runs).
  let workingDirectory: WorkingDirectoryLike | undefined
  ctx.inject(['workingDirectory'], (c) => {
    workingDirectory = (c as unknown as { workingDirectory: WorkingDirectoryLike }).workingDirectory
    c.effect(() => () => { workingDirectory = undefined })
  })
  const envFor = async (agent: unknown): Promise<ServiceEnv> => ({ root: await projectRootFor(agent, workingDirectory), store })

  // The checklist each project was last previewed in, so `确认` only confirms what the user was shown.
  const previews = new Map<string, string>()
  const summary = (v: View, root: string, opts: { notRun?: NotRunReasons; preface?: readonly string[] } = {}) => {
    if (needsConfirmation(v)) previews.set(root, previewDigest(v.checklist))
    return renderSummary(v, opts)
  }

  ctx.tools.register(defineTool({
    name: 'done_check_draft',
    description:
      `Validate a proposed acceptance checklist for the current task before you save it as ${CHECKLIST_FILE} at the git root. ` +
      'Returns errors, or the normalized YAML to write with your file tool. Each check has id, name, and either run (a shell command) ' +
      'or manual: true; optional timeout (seconds), cwd, watch (globs); manual checks may also have how (one sentence telling the user how to verify it). ' +
      'The user confirms the checklist with /done-check — you cannot confirm it. ' +
      'Drafting rules: (1) Name every check by a behaviour the user can judge, e.g. "含逗号和换行的数据能正确导出", never "测试通过". ' +
      '(2) Every name must have a real check behind it: one command that verifies only that behaviour, or a manual check with a how the user can follow. If there is none, leave the item out — do not rename a generic check to sound better. ' +
      '(3) Existing project scripts (test, typecheck, lint) may be base checks, but name them honestly ("类型检查通过"); they are not feature acceptance.',
    parameters: {
      yaml: { type: 'string', required: true, description: `Full ${CHECKLIST_FILE} content (version: 1, task, checks).` },
    },
    output: {
      schema: { type: 'json' },
      render: (_args, value) => {
        const v = value as { ok: boolean; errors: string[]; warnings: string[]; normalized: string | null; path: string }
        const warn = v.warnings.length ? `\n\nWarnings (not blocking — fix them before asking the user to confirm):\n- ${v.warnings.join('\n- ')}` : ''
        return [{
          type: 'text',
          text: v.ok
            ? `Checklist is valid. Write it to ${v.path}, then ask the user to run /done-check to preview it and /done-check 确认 to confirm.${warn}\n\n${v.normalized}`
            : `Checklist is invalid:\n- ${v.errors.join('\n- ')}`,
        }]
      },
    },
    async execute(args, exec) {
      const root = await projectRootFor(exec.agent, workingDirectory)
      const path = `${root}/${CHECKLIST_FILE}`
      const parsed = parseChecklist(args.yaml)
      if (!parsed.ok) return { ok: false, errors: [...parsed.errors], warnings: [], normalized: null, path }
      const snapshot = await snapshotWorkspace(root)
      const errors = parsed.checklist.checks.flatMap((c) => {
        const e = watchCoverageError(c.watch, fingerprintFor(snapshot, c.watch))
        return e ? [`${c.id}: ${e}`] : []
      })
      return {
        ok: errors.length === 0, errors, warnings: draftWarnings(parsed.checklist.checks),
        normalized: errors.length ? null : serializeChecklist(parsed.checklist), path,
      }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'done_check_status',
    description:
      'Report the acceptance status of the current task: which agreed checks passed, which found a problem, which could not run, and which need re-checking after code changes. ' +
      'Returns verdict (the one-line conclusion) and nextStep. Passing checks do not prove the requirement is complete.',
    parameters: {},
    output: {
      schema: { type: 'json' },
      render: (_args, value) => [{ type: 'text', text: String((value as { markdown: string }).markdown) }],
    },
    async execute(_args, exec) {
      const env = await envFor(exec.agent)
      const v = await view(env)
      return { ...statusValue(v), markdown: renderSummary(v) }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'done_check_run',
    description:
      'Run the user-confirmed automatic acceptance checks (all, or the given ids) and record their evidence. Each command goes through the normal shell tool and its permission rules. ' +
      'Checks that are unconfirmed or changed since confirmation are skipped. Manual checks can only be decided by the user. ' +
      'When the project has a confirmed checklist, call this before you say the work is done, and relay the returned verdict line to the user as it is. ' +
      'If a check found a problem: fix it from the test report and run again. If a check could not run: tell the user why — never work around it.',
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
      const notRun = notRunReasons(run)
      const v = await view(env)
      return {
        ...statusValue(v, notRun),
        ran: run.ran.map((x) => ({ id: x.checkId, outcome: x.outcome, exitCode: x.exitCode, unstable: x.unstable !== null })),
        skipped: run.skipped.map((s) => ({ id: s.checkId, reason: s.reason })),
        markdown: renderSummary(v, { notRun, preface: runNote(run) }),
      }
    },
  }))

  ctx.commands.register({
    name: 'done-check',
    description: '验收清单：看懂 AI 做完后，哪些已经验证，哪些还需要处理',
    input: { hint: '（留空）| 确认 | ok [序号] | no [序号] [备注] | 详情 [序号] | 全部 | 技术详情 | 重新检查' },
    async handler(inv) {
      try {
        const env = await envFor(inv.agent)
        const { sub, word, args, rest } = parseCommandInput(inv.rawInput)
        const execFor = () => toolExec(tools, { agent: inv.agent, callIdPrefix: `command-${inv.commandId}` })
        const ok = (text: string) => ({ kind: 'success' as const, text })
        const fail = (text: string) => ({ kind: 'error' as const, text })

        /** Run the given checks (all automatic ones when empty), then describe the new state. */
        const runAndSummarize = async (ids: readonly string[]) => {
          const run = await runChecks(env, execFor(), { ...(ids.length ? { ids } : {}), signal: inv.signal })
          return ok(summary(await view(env), env.root, { notRun: notRunReasons(run), preface: runNote(run) }))
        }

        switch (sub) {
          case 'smart': {
            const v = await view(env)
            if (needsConfirmation(v)) return ok(summary(v, env.root))
            const due = dueAutoChecks(v)
            return due.length ? runAndSummarize(due) : ok(summary(v, env.root))
          }
          case 'status':
            return ok(summary(await view(env), env.root))
          case 'confirm': {
            const v = await view(env)
            if (!needsConfirmation(v)) return ok(summary(v, env.root, { preface: ['清单已经确认过，没有改动。'] }))
            const seen = previews.get(env.root)
            if (seen !== previewDigest(v.checklist)) {
              return ok(summary(v, env.root, { preface: ['你还没看过这份清单（或它在预览后变了）。请先看下面的内容：'] }))
            }
            try {
              await confirm(env, seen)
            } catch (err) {
              if (!(err instanceof PreviewMismatchError)) throw err
              return ok(summary(await view(env), env.root, { preface: ['清单在你预览之后又变了，请重新看一遍：'] }))
            }
            previews.delete(env.root)
            const after = await view(env)
            return ok(renderSummary(after, { headline: confirmedHeadline(after), preface: ['输入 /done-check 会执行已确认的命令，按你当前的权限设置执行。'] }))
          }
          case 'run': {
            const v = await view(env)
            if (needsConfirmation(v)) return ok(summary(v, env.root))
            return runAndSummarize(args)
          }
          case 'ok':
          case 'no': {
            const v = await view(env)
            if (needsConfirmation(v)) return ok(summary(v, env.root, { preface: ['清单需要先确认，才能记录结论。'] }))
            const items = itemsOf(v)
            const pending = pendingManual(items)
            const token = args[0]
            let target = token !== undefined && (/^\d+$/.test(token) || items.some((i) => i.check.id === token)) ? resolveItem(items, token) : undefined
            let note = rest
            if (target) note = rest.slice(token!.length).trim()
            else if (pending.length === 1) target = { ok: true, item: pending[0]! }
            if (!target) {
              if (!pending.length) return fail('现在没有等你确认的人工项。')
              return fail(`有 ${pending.length} 项等你确认，请指明序号：\n${pending.map((i) => `  ${i.n}. ${i.check.name}`).join('\n')}\n例如：/done-check ${sub} ${pending[0]!.n}`)
            }
            if (!target.ok) return fail(target.message)
            const { item } = target
            if (!item.check.manual) return fail(`第 ${item.n} 项「${item.check.name}」是自动检查，由 /done-check 执行，不能手动记录结论。`)
            await decide(env, item.check.id, sub === 'ok' ? 'passed' : 'failed', note)
            return ok(summary(await view(env), env.root, { preface: [`${sub === 'ok' ? '已记录你的确认' : '已记录你的结论'}：「${item.check.name}」${sub === 'ok' ? '通过' : '未通过'}`] }))
          }
          case 'details':
          case 'tech': {
            const v = await view(env)
            if (needsConfirmation(v)) return ok(summary(v, env.root))
            const level = sub === 'tech' ? 'tech' : 'run'
            if (!args[0]) return ok(renderDetails(v, problemItems(v), level))
            const r = resolveItem(itemsOf(v), args[0])
            return r.ok ? ok(renderDetails(v, [r.item], level)) : fail(r.message)
          }
          case 'all': {
            const v = await view(env)
            if (needsConfirmation(v)) return ok(summary(v, env.root))
            return ok(renderAll(v, 'run'))
          }
          case 'help':
            return ok(HELP)
          default:
            return fail(`不认识的写法：${word}\n\n${HELP}`)
        }
      } catch (err) {
        return { kind: 'error', text: err instanceof DoneCheckError ? err.message : `done-check 出错：${(err as Error).message}` }
      }
    },
  })
}
