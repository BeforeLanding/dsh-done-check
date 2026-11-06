/**
 * The four operations of the v0.1 flow — confirm, run, decide, report —
 * independent of DSH. The plugin layer supplies `exec` (backed by the
 * session's authorized shell path) and decides who may call which
 * operation: `confirm` and `decide` are wired only to user commands.
 */
import { readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { canonicalJson, sha256 } from './core/hash.ts'
import { CHECKLIST_FILE, type CheckDefinition, type Checklist, definitionHash, parseChecklist, structureHash } from './core/checklist.ts'
import { type ListFiles, type WorkspaceSnapshot, fingerprintFor, gitListFiles, snapshotWorkspace, watchCoverageError } from './core/fingerprint.ts'
import {
  type AutoRun, type ChecklistConfirmation, type NotExecutedAttempt, type NotExecutedKind, type CompletedRun, type CorruptRecord, type ManualDecision, type RawRun, type Report,
  STATE_LABELS, assessStability, classifyRun, deriveReport,
} from './core/status.ts'
import { failureExcerpt } from './core/excerpt.ts'
import { type StateStore, confirmState, newRunId, recordRun, tail } from './store/state.ts'

export interface ExecRequest {
  readonly command: string
  /** Absolute working directory inside the project. */
  readonly cwd: string
  readonly timeoutMs: number
  readonly signal: AbortSignal
}

export interface ExecOutcome extends RawRun {
  readonly stdout: string
  readonly stderr: string
  /** Executor that ran it, e.g. "bash-local" or "pwsh-sandbox". */
  readonly shell: string | null
}

export type Exec = (req: ExecRequest) => Promise<ExecOutcome>

export interface ServiceEnv {
  readonly root: string
  readonly store: StateStore
  readonly listFiles?: ListFiles
  readonly now?: () => Date
}

export class DoneCheckError extends Error {}

/**
 * Thrown by an `exec` when the command never ran — denied by a permission
 * policy, no shell tool registered, PTC collapse, … No evidence exists, so
 * nothing is recorded and the previous result stays in place.
 */
export class NotExecutedError extends Error {
  readonly kind: NotExecutedKind
  readonly detail: string
  constructor(message: string, kind: NotExecutedKind = 'other', detail: string = message) {
    super(message)
    this.kind = kind
    this.detail = detail
  }
}

export async function loadChecklist(root: string): Promise<Checklist> {
  let text: string
  try {
    text = await readFile(join(root, CHECKLIST_FILE), 'utf8')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') throw new DoneCheckError(`项目根目录没有 ${CHECKLIST_FILE}`)
    throw err
  }
  const parsed = parseChecklist(text)
  if (!parsed.ok) throw new DoneCheckError(`${CHECKLIST_FILE} 无效：\n- ${parsed.errors.join('\n- ')}`)
  return parsed.checklist
}

const nowOf = (env: ServiceEnv) => (env.now ?? (() => new Date()))()
const snapshotOf = (env: ServiceEnv, checks: readonly CheckDefinition[]) => snapshotWorkspace(env.root, env.listFiles ?? gitListFiles, checks.map((c) => c.watch))

function coverageErrors(checks: readonly CheckDefinition[], snapshot: WorkspaceSnapshot): string[] {
  return checks.flatMap((c) => {
    const err = watchCoverageError(c.watch, fingerprintFor(snapshot, c.watch))
    return err ? [`${c.id}: ${err}`] : []
  })
}

/** The checklist on disk is no longer the one the user was shown. */
export class PreviewMismatchError extends DoneCheckError {}

/**
 * User-only: confirm the checklist exactly as it is on disk now. With
 * `expectedPreview` (a `previewDigest`), it only goes through if the list
 * is still the one the user was shown.
 */
export async function confirm(env: ServiceEnv, expectedPreview?: string): Promise<Report> {
  const checklist = await loadChecklist(env.root)
  if (expectedPreview !== undefined && previewDigest(checklist) !== expectedPreview) {
    throw new PreviewMismatchError('清单在你预览之后又变了')
  }
  const errors = coverageErrors(checklist.checks, await snapshotOf(env, checklist.checks))
  if (errors.length) throw new DoneCheckError(`无法确认：\n- ${errors.join('\n- ')}`)
  const confirmation: ChecklistConfirmation = {
    task: checklist.task,
    checkIds: checklist.checks.map((c) => c.id).sort(),
    names: Object.fromEntries(checklist.checks.map((c) => [c.id, c.name])),
    structureHash: structureHash(checklist),
    definitions: Object.fromEntries(checklist.checks.map((c) => [c.id, definitionHash(c)])),
    confirmedAt: nowOf(env).toISOString(),
  }
  await env.store.update(env.root, (s) => ({ state: confirmState(s, confirmation), value: undefined }))
  return report(env)
}

export async function report(env: ServiceEnv): Promise<Report> {
  return (await view(env)).report
}

/** Everything the UI needs to describe the current state: the checklist, the derived report, and the latest run per check. */
export interface View {
  readonly checklist: Checklist
  readonly report: Report
  readonly results: Readonly<Record<string, CompletedRun | CorruptRecord>>
  /** Checks whose latest attempt never started (for the current definition), with why. */
  readonly notExecuted: Readonly<Record<string, Pick<NotExecutedAttempt, 'kind' | 'detail'>>>
  /** Names recorded at confirmation, so a deleted check can be shown by name. Empty for older confirmations. */
  readonly confirmedNames: Readonly<Record<string, string>>
}

export async function view(env: ServiceEnv): Promise<View> {
  const checklist = await loadChecklist(env.root)
  const loaded = await env.store.load(env.root)
  if (!loaded.ok) {
    const reason = `证据状态无法读取：${loaded.reason}`
    const checks = checklist.checks.map((c) => ({
      checkId: c.id, state: 'unknown' as const, lastOutcome: null, changes: null, reason, lastAttemptCancelled: false,
    }))
    return {
      checklist, results: {}, notExecuted: {}, confirmedNames: {},
      report: { structure: 'unconfirmed', taskChanged: false, added: [], removed: [], checks, summary: `${checks.length} 项验收全部${STATE_LABELS.unknown}：${reason}` },
    }
  }
  const state = loaded.state
  let snapshot: WorkspaceSnapshot | { error: string }
  try {
    snapshot = await snapshotOf(env, checklist.checks)
  } catch (err) {
    snapshot = { error: (err as Error).message }
  }
  const results = await env.store.loadResults(env.root, state)
  const rep = deriveReport({
    checklist,
    confirmation: state.confirmation ?? undefined,
    snapshot,
    results,
    active: state.active,
    cancelled: new Set(Object.keys(state.cancelled)),
    now: nowOf(env),
  })
  const notExecuted: Record<string, Pick<NotExecutedAttempt, 'kind' | 'detail'>> = {}
  for (const c of checklist.checks) {
    const a = state.notExecuted?.[c.id]
    if (a && a.definitionHash === definitionHash(c)) notExecuted[c.id] = { kind: a.kind, detail: a.detail }
  }
  return { checklist, report: rep, results, notExecuted, confirmedNames: state.confirmation?.names ?? {} }
}

/**
 * Identifies exactly what the user is shown in a confirmation preview: the
 * task, the id set and every check's full definition. `confirm` from the UI
 * only goes through when this still matches the last preview.
 */
export function previewDigest(checklist: Checklist): string {
  return sha256(canonicalJson({ structure: structureHash(checklist), definitions: checklist.checks.map((c) => [c.id, definitionHash(c)]).sort() }))
}

export type SkipKind =
  /** The command never ran: denied by a permission policy, no shell tool, sandbox failure. No evidence. */
  | 'not_executed'
  /** Not confirmed, changed since confirmation, or the watch matches nothing. */
  | 'blocked'
  /** Already running in another session. */
  | 'busy'
  | 'cancelled'

export interface RunSkip {
  readonly checkId: string
  readonly kind: SkipKind
  readonly reason: string
  /** For `not_executed`: why the command never started. */
  readonly notExecuted?: { readonly kind: NotExecutedKind; readonly detail: string }
}

export interface RunSummary {
  readonly ran: readonly AutoRun[]
  readonly cancelled: readonly string[]
  readonly skipped: readonly RunSkip[]
}

/** Preconditions shared by running and deciding: confirmed, unchanged, watch covers files. */
function preflight(check: CheckDefinition, checklist: Checklist, confirmation: ChecklistConfirmation | null, snapshot: WorkspaceSnapshot): string | null {
  if (confirmation && (structureHash(checklist) !== confirmation.structureHash || checklist.checks.some((c) => confirmation.definitions[c.id] !== definitionHash(c)))) {
    return '清单结构或检查定义已改动，请先预览，再重新确认整份清单'
  }
  const confirmed = confirmation?.definitions[check.id]
  if (confirmed === undefined) return '尚未确认，请用户先查看并确认清单（/done-check）'
  if (confirmed !== definitionHash(check)) return '确认后定义已改动，请用户重新确认'
  return watchCoverageError(check.watch, fingerprintFor(snapshot, check.watch))
}

/**
 * Run confirmed automatic checks one at a time. Each result is bound to the
 * workspace as it was before the command started; if the workspace or the
 * check's definition differs afterwards, the result is recorded as unstable
 * and stays unusable until a clean re-run — restoring files does not revive it.
 */
export async function runChecks(env: ServiceEnv, exec: Exec, opts: { ids?: readonly string[]; signal: AbortSignal }): Promise<RunSummary> {
  const checklist = await loadChecklist(env.root)
  const unknown = (opts.ids ?? []).filter((id) => !checklist.checks.some((c) => c.id === id))
  if (unknown.length) throw new DoneCheckError(`清单中没有这些检查：${unknown.join(', ')}`)
  const selected = checklist.checks.filter((c) => !c.manual && (!opts.ids?.length || opts.ids.includes(c.id)))

  const ran: AutoRun[] = []
  const cancelled: string[] = []
  const skipped: RunSkip[] = []
  for (const check of selected) {
    if (opts.signal.aborted) {
      skipped.push({ checkId: check.id, kind: 'cancelled', reason: '已取消' })
      continue
    }
    const loaded = await env.store.load(env.root)
    if (!loaded.ok) throw new DoneCheckError(`证据状态无法读取：${loaded.reason}`)
    const before = await snapshotOf(env, [check])
    const blocked = preflight(check, await loadChecklist(env.root), loaded.state.confirmation, before)
    if (blocked) {
      skipped.push({ checkId: check.id, kind: 'blocked', reason: blocked })
      continue
    }

    const runId = newRunId(nowOf(env))
    const startedAt = nowOf(env)
    const deadline = new Date(startedAt.getTime() + check.timeout * 1000 + 60_000).toISOString()
    const claimed = await env.store.update(env.root, (s) => {
      const active = s.active[check.id]
      if (active && startedAt.getTime() < Date.parse(active.deadline)) return { state: s, value: false }
      return { state: { ...s, active: { ...s.active, [check.id]: { runId, checkId: check.id, startedAt: startedAt.toISOString(), deadline } } }, value: true }
    })
    if (!claimed) {
      skipped.push({ checkId: check.id, kind: 'busy', reason: '该项正在另一处执行' })
      continue
    }

    try {
      const hash = definitionHash(check)
      const fpBefore = fingerprintFor(before, check.watch)
      let out: ExecOutcome
      try {
        out = await exec({ command: check.run ?? '', cwd: resolve(env.root, check.cwd), timeoutMs: check.timeout * 1000, signal: opts.signal })
      } catch (err) {
        if (err instanceof NotExecutedError) {
          const attempt: NotExecutedAttempt = { kind: err.kind, detail: err.detail, definitionHash: hash, at: nowOf(env).toISOString() }
          await env.store.update(env.root, (s) => {
            const { [check.id]: _gone, ...active } = s.active
            return { state: { ...s, active, notExecuted: { ...s.notExecuted, [check.id]: attempt } }, value: undefined }
          })
          skipped.push({ checkId: check.id, kind: 'not_executed', reason: `未执行：${err.message}`, notExecuted: { kind: err.kind, detail: err.detail } })
          continue
        }
        out = { exitCode: null, signal: null, timedOut: false, aborted: opts.signal.aborted, infraError: (err as Error).message, stdout: '', stderr: '', shell: null }
      }
      const finishedAt = nowOf(env)
      const outcome = classifyRun(out)
      const durationMs = finishedAt.getTime() - startedAt.getTime()

      if (outcome === 'cancelled') {
        const rec = { kind: 'cancelled' as const, runId, checkId: check.id, definitionHash: hash, fingerprint: fpBefore, startedAt: startedAt.toISOString(), finishedAt: finishedAt.toISOString(), durationMs }
        await env.store.writeRun(env.root, rec)
        await env.store.update(env.root, (s) => ({ state: recordRun(s, rec), value: undefined }))
        cancelled.push(check.id)
        continue
      }

      const fpAfter = fingerprintFor(await snapshotOf(env, [check]), check.watch)
      const defAfter = await loadChecklist(env.root)
        .then((l) => l.checks.find((c) => c.id === check.id))
        .then((c) => (c ? definitionHash(c) : null), () => null)
      const log = await env.store.writeLog(env.root, runId, `$ ${check.run}\n--- stdout ---\n${out.stdout}\n--- stderr ---\n${out.stderr}\n`)
      const record: AutoRun = {
        kind: 'auto', runId, checkId: check.id, command: check.run ?? '', definitionHash: hash, fingerprint: fpBefore,
        startedAt: startedAt.toISOString(), finishedAt: finishedAt.toISOString(), durationMs,
        outcome, exitCode: out.exitCode, signal: out.signal, timedOut: out.timedOut, errorMessage: out.infraError,
        shell: out.shell, stdoutTail: tail(out.stdout), stderrTail: tail(out.stderr), log,
        unstable: assessStability(fpBefore, fpAfter, hash, defAfter),
        ...(outcome !== 'passed' ? { failureExcerpt: failureExcerpt(out.stdout, out.stderr) } : {}),
      }
      await env.store.writeRun(env.root, record)
      await env.store.update(env.root, (s) => ({ state: recordRun(s, record), value: undefined }))
      ran.push(record)
    } catch (err) {
      // Never leave a phantom "running" claim behind an infrastructure failure.
      await env.store.update(env.root, (s) => {
        const { [check.id]: _gone, ...active } = s.active
        return { state: { ...s, active }, value: undefined }
      })
      throw err
    }
  }
  return { ran, cancelled, skipped }
}

/** User-only: record a manual check's verdict against the current workspace. */
export async function decide(env: ServiceEnv, checkId: string, outcome: 'passed' | 'failed', note: string): Promise<ManualDecision> {
  const checklist = await loadChecklist(env.root)
  const check = checklist.checks.find((c) => c.id === checkId)
  if (!check) throw new DoneCheckError(`清单中没有检查 ${checkId}`)
  if (!check.manual) throw new DoneCheckError(`${checkId} 是自动检查，请用 /done-check ok 或 /done-check no 记录结论`)
  const loaded = await env.store.load(env.root)
  if (!loaded.ok) throw new DoneCheckError(`证据状态无法读取：${loaded.reason}`)
  const snapshot = await snapshotOf(env, [check])
  const blocked = preflight(check, checklist, loaded.state.confirmation, snapshot)
  if (blocked) throw new DoneCheckError(`${checkId}: ${blocked}`)
  const now = nowOf(env)
  const record: ManualDecision = {
    kind: 'manual', runId: newRunId(now), checkId, definitionHash: definitionHash(check),
    fingerprint: fingerprintFor(snapshot, check.watch), startedAt: now.toISOString(), outcome, note,
  }
  await env.store.writeRun(env.root, record)
  await env.store.update(env.root, (s) => ({ state: recordRun(s, record), value: undefined }))
  return record
}
