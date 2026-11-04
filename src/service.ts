/**
 * The four operations of the v0.1 flow — confirm, run, decide, report —
 * independent of DSH. The plugin layer supplies `exec` (backed by the
 * session's authorized shell path) and decides who may call which
 * operation: `confirm` and `decide` are wired only to user commands.
 */
import { readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { CHECKLIST_FILE, type CheckDefinition, type Checklist, definitionHash, parseChecklist, structureHash } from './core/checklist.ts'
import { type ListFiles, type WorkspaceSnapshot, fingerprintFor, gitListFiles, snapshotWorkspace, watchCoverageError } from './core/fingerprint.ts'
import {
  type AutoRun, type ChecklistConfirmation, type ManualDecision, type RawRun, type Report,
  STATE_LABELS, assessStability, classifyRun, deriveReport,
} from './core/status.ts'
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
const snapshotOf = (env: ServiceEnv) => snapshotWorkspace(env.root, env.listFiles ?? gitListFiles)

function coverageErrors(checks: readonly CheckDefinition[], snapshot: WorkspaceSnapshot): string[] {
  return checks.flatMap((c) => {
    const err = watchCoverageError(c.watch, fingerprintFor(snapshot, c.watch))
    return err ? [`${c.id}: ${err}`] : []
  })
}

/** User-only: confirm the checklist exactly as it is on disk now. */
export async function confirm(env: ServiceEnv): Promise<Report> {
  const checklist = await loadChecklist(env.root)
  const errors = coverageErrors(checklist.checks, await snapshotOf(env))
  if (errors.length) throw new DoneCheckError(`无法确认：\n- ${errors.join('\n- ')}`)
  const confirmation: ChecklistConfirmation = {
    task: checklist.task,
    checkIds: checklist.checks.map((c) => c.id).sort(),
    structureHash: structureHash(checklist),
    definitions: Object.fromEntries(checklist.checks.map((c) => [c.id, definitionHash(c)])),
    confirmedAt: nowOf(env).toISOString(),
  }
  await env.store.update(env.root, (s) => ({ state: confirmState(s, confirmation), value: undefined }))
  return report(env)
}

export async function report(env: ServiceEnv): Promise<Report> {
  const checklist = await loadChecklist(env.root)
  const loaded = await env.store.load(env.root)
  if (!loaded.ok) {
    const reason = `证据状态无法读取：${loaded.reason}`
    const checks = checklist.checks.map((c) => ({
      checkId: c.id, state: 'unknown' as const, lastOutcome: null, changes: null, reason, lastAttemptCancelled: false,
    }))
    return { structure: 'unconfirmed', taskChanged: false, added: [], removed: [], checks, summary: `${checks.length} 项验收全部${STATE_LABELS.unknown}：${reason}` }
  }
  const state = loaded.state
  let snapshot: WorkspaceSnapshot | { error: string }
  try {
    snapshot = await snapshotOf(env)
  } catch (err) {
    snapshot = { error: (err as Error).message }
  }
  return deriveReport({
    checklist,
    confirmation: state.confirmation ?? undefined,
    snapshot,
    results: await env.store.loadResults(env.root, state),
    active: state.active,
    cancelled: new Set(Object.keys(state.cancelled)),
    now: nowOf(env),
  })
}

export interface RunSkip {
  readonly checkId: string
  readonly reason: string
}

export interface RunSummary {
  readonly ran: readonly AutoRun[]
  readonly cancelled: readonly string[]
  readonly skipped: readonly RunSkip[]
}

/** Preconditions shared by running and deciding: confirmed, unchanged, watch covers files. */
function preflight(check: CheckDefinition, confirmation: ChecklistConfirmation | null, snapshot: WorkspaceSnapshot): string | null {
  const confirmed = confirmation?.definitions[check.id]
  if (confirmed === undefined) return '尚未确认，请用户运行 /done-check confirm'
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
      skipped.push({ checkId: check.id, reason: '已取消' })
      continue
    }
    const loaded = await env.store.load(env.root)
    if (!loaded.ok) throw new DoneCheckError(`证据状态无法读取：${loaded.reason}`)
    const before = await snapshotOf(env)
    const blocked = preflight(check, loaded.state.confirmation, before)
    if (blocked) {
      skipped.push({ checkId: check.id, reason: blocked })
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
      skipped.push({ checkId: check.id, reason: '该项正在另一处执行' })
      continue
    }

    try {
      const hash = definitionHash(check)
      const fpBefore = fingerprintFor(before, check.watch)
      let out: ExecOutcome
      try {
        out = await exec({ command: check.run ?? '', cwd: resolve(env.root, check.cwd), timeoutMs: check.timeout * 1000, signal: opts.signal })
      } catch (err) {
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

      const fpAfter = fingerprintFor(await snapshotOf(env), check.watch)
      const defAfter = await loadChecklist(env.root)
        .then((l) => l.checks.find((c) => c.id === check.id))
        .then((c) => (c ? definitionHash(c) : null), () => null)
      const log = await env.store.writeLog(env.root, runId, `$ ${check.run}\n--- stdout ---\n${out.stdout}\n--- stderr ---\n${out.stderr}\n`)
      const record: AutoRun = {
        kind: 'auto', runId, checkId: check.id, definitionHash: hash, fingerprint: fpBefore,
        startedAt: startedAt.toISOString(), finishedAt: finishedAt.toISOString(), durationMs,
        outcome, exitCode: out.exitCode, signal: out.signal, timedOut: out.timedOut, errorMessage: out.infraError,
        shell: out.shell, stdoutTail: tail(out.stdout), stderrTail: tail(out.stderr), log,
        unstable: assessStability(fpBefore, fpAfter, hash, defAfter),
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
  if (!check.manual) throw new DoneCheckError(`${checkId} 是自动检查，请用 /done-check run`)
  const loaded = await env.store.load(env.root)
  if (!loaded.ok) throw new DoneCheckError(`证据状态无法读取：${loaded.reason}`)
  const snapshot = await snapshotOf(env)
  const blocked = preflight(check, loaded.state.confirmation, snapshot)
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
