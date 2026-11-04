import { type CheckDefinition, type Checklist, definitionHash, structureHash } from './checklist.ts'
import { type FileChanges, type Fingerprint, type WorkspaceSnapshot, diffFingerprints, fingerprintFor, hasChanges } from './fingerprint.ts'

export type Outcome = 'passed' | 'failed' | 'error'

/** Written only by the user's `/done-check confirm` command. */
export interface ChecklistConfirmation {
  readonly task: string
  readonly checkIds: readonly string[]
  readonly structureHash: string
  readonly definitions: Readonly<Record<string, string>>
  readonly confirmedAt: string
}

/** Why a run cannot be trusted no matter what the workspace looks like later. */
export interface Instability {
  /** Workspace files that changed between the start and the end of the run. */
  readonly files: FileChanges | null
  /** The check's definition in done-check.yaml changed while it ran. */
  readonly definitionChanged: boolean
}

interface RunBase {
  readonly runId: string
  readonly checkId: string
  readonly definitionHash: string
  /** Workspace state the run is bound to, taken before it started. */
  readonly fingerprint: Fingerprint
  readonly startedAt: string
}

export interface LogRef {
  readonly path: string
  readonly originalBytes: number
  readonly truncated: boolean
}

/** Produced by the execution path; never by the agent. */
export interface AutoRun extends RunBase {
  readonly kind: 'auto'
  readonly outcome: Outcome
  readonly finishedAt: string
  readonly durationMs: number
  readonly exitCode: number | null
  readonly signal: string | null
  readonly timedOut: boolean
  readonly errorMessage: string | null
  /** Executor that ran the command (e.g. bash-local, pwsh-sandbox), when known. */
  readonly shell: string | null
  readonly stdoutTail: string
  readonly stderrTail: string
  readonly log: LogRef | null
  readonly unstable: Instability | null
}

/** A run the user cancelled: recorded as an attempt, never as a result. */
export interface CancelledRun extends RunBase {
  readonly kind: 'cancelled'
  readonly finishedAt: string
  readonly durationMs: number
}

/** Written only by the user's `/done-check pass|fail` command. */
export interface ManualDecision extends RunBase {
  readonly kind: 'manual'
  readonly outcome: 'passed' | 'failed'
  readonly note: string
}

export type RunRecord = AutoRun | CancelledRun | ManualDecision
export type CompletedRun = AutoRun | ManualDecision

/** A run record that is referenced but cannot be read back. */
export interface CorruptRecord {
  readonly corrupt: string
}

export interface ActiveRun {
  readonly runId: string
  readonly checkId: string
  readonly startedAt: string
  /** After this instant an unfinished run is treated as abandoned. */
  readonly deadline: string
}

export type CheckState =
  | 'running'
  | 'unconfirmed'
  | 'definition_changed'
  | 'not_run'
  | 'awaiting_manual'
  | 'unknown'
  | 'unstable'
  | 'stale'
  | 'passed'
  | 'failed'
  | 'error'

export const STATE_LABELS: Readonly<Record<CheckState, string>> = {
  passed: '通过',
  failed: '失败',
  error: '执行出错',
  unstable: '执行不稳定（须重跑）',
  stale: '已过期',
  unknown: '无法判定',
  running: '执行中',
  not_run: '未执行',
  awaiting_manual: '待人工确认',
  definition_changed: '清单已改动',
  unconfirmed: '待确认清单',
}

/** Display order of states in summaries. */
export const STATE_ORDER: readonly CheckState[] = [
  'passed', 'failed', 'error', 'unstable', 'stale', 'unknown', 'running', 'not_run', 'awaiting_manual', 'definition_changed', 'unconfirmed',
]

export interface CheckStatus {
  readonly checkId: string
  readonly state: CheckState
  /** For `stale` / `unstable`: the conclusion that no longer applies. */
  readonly lastOutcome: Outcome | null
  /** For `stale`: which files differ from the ones the result was bound to. */
  readonly changes: FileChanges | null
  /** Human-readable cause for `unknown` / `unstable`. */
  readonly reason: string | null
  /** The most recent attempt was cancelled; the state still reflects the last completed run. */
  readonly lastAttemptCancelled: boolean
}

export interface CheckInput {
  readonly check: CheckDefinition
  readonly confirmation: ChecklistConfirmation | undefined
  readonly result: CompletedRun | CorruptRecord | undefined
  /** Current fingerprint for this check, or why it could not be computed. */
  readonly current: Fingerprint | { readonly error: string }
  readonly active: ActiveRun | undefined
  readonly lastAttemptCancelled: boolean
  readonly now: Date
}

/**
 * The only place a check's state is decided. State is never stored; it is
 * recomputed from the confirmed definition, the latest completed run and the
 * current workspace fingerprint, so an old result can never pass for a
 * current one, and a result that cannot be verified never reads as valid.
 */
export function deriveStatus(input: CheckInput): CheckStatus {
  const { check, confirmation, result, current, active, now } = input
  const base = { checkId: check.id, lastOutcome: null, changes: null, reason: null, lastAttemptCancelled: input.lastAttemptCancelled }
  const hash = definitionHash(check)
  if (active && now.getTime() < Date.parse(active.deadline)) return { ...base, state: 'running' }
  const confirmedHash = confirmation?.definitions[check.id]
  if (confirmedHash === undefined) return { ...base, state: 'unconfirmed' }
  if (confirmedHash !== hash) return { ...base, state: 'definition_changed' }
  if (!result) return { ...base, state: check.manual ? 'awaiting_manual' : 'not_run' }
  if ('corrupt' in result) return { ...base, state: 'unknown', reason: `证据无法读取：${result.corrupt}` }
  if (result.definitionHash !== hash) return { ...base, state: check.manual ? 'awaiting_manual' : 'not_run' }
  if (result.kind === 'auto' && result.unstable) {
    return { ...base, state: 'unstable', lastOutcome: result.outcome, reason: describeInstability(result.unstable) }
  }
  if ('error' in current) return { ...base, state: 'unknown', reason: `无法读取当前工作区：${current.error}` }
  if (result.fingerprint.digest !== current.digest) {
    return { ...base, state: 'stale', lastOutcome: result.outcome, changes: diffFingerprints(result.fingerprint.files, current.files) }
  }
  return { ...base, state: result.outcome }
}

/** Compare the workspace and definition before and after a run. */
export function assessStability(before: Fingerprint, after: Fingerprint, definitionBefore: string, definitionAfter: string | null): Instability | null {
  const files = diffFingerprints(before.files, after.files)
  const definitionChanged = definitionAfter !== definitionBefore
  if (!hasChanges(files) && !definitionChanged) return null
  return { files: hasChanges(files) ? files : null, definitionChanged }
}

function describeInstability(u: Instability): string {
  const parts: string[] = []
  if (u.files) {
    const n = u.files.modified.length + u.files.added.length + u.files.removed.length
    const sample = [...u.files.modified, ...u.files.added, ...u.files.removed].slice(0, 3).join(', ')
    parts.push(`执行期间 ${n} 个文件发生变化（${sample}${n > 3 ? '…' : ''}）`)
  }
  if (u.definitionChanged) parts.push('执行期间该项定义被修改')
  return `${parts.join('；')}；无法确定检查针对哪个版本，须重跑`
}

export type StructureState = 'unconfirmed' | 'confirmed' | 'changed'

export interface ReportInput {
  readonly checklist: Checklist
  readonly confirmation: ChecklistConfirmation | undefined
  /** Current workspace, or why it could not be read. */
  readonly snapshot: WorkspaceSnapshot | { readonly error: string }
  /** Latest completed run per check id, including ids no longer in the list. */
  readonly results: Readonly<Record<string, CompletedRun | CorruptRecord>>
  readonly active: Readonly<Record<string, ActiveRun>>
  readonly cancelled: ReadonlySet<string>
  readonly now: Date
}

export interface RemovedCheck {
  readonly checkId: string
  readonly lastOutcome: Outcome | null
}

export interface Report {
  readonly structure: StructureState
  readonly taskChanged: boolean
  readonly added: readonly string[]
  readonly removed: readonly RemovedCheck[]
  readonly checks: readonly CheckStatus[]
  /** e.g. "3 项验收中，2 项通过、1 项待人工确认". Never a percentage. */
  readonly summary: string
}

export function deriveReport(input: ReportInput): Report {
  const { checklist, confirmation, snapshot } = input
  const checks = checklist.checks.map((check) =>
    deriveStatus({
      check,
      confirmation,
      result: input.results[check.id],
      current: snapshotIsError(snapshot) ? snapshot : fingerprintFor(snapshot, check.watch),
      active: input.active[check.id],
      lastAttemptCancelled: input.cancelled.has(check.id),
      now: input.now,
    }))

  let structure: StructureState = 'unconfirmed'
  let taskChanged = false
  let added: string[] = []
  let removed: RemovedCheck[] = []
  if (confirmation) {
    const ids = new Set(checklist.checks.map((c) => c.id))
    const confirmedIds = new Set(confirmation.checkIds)
    added = [...ids].filter((id) => !confirmedIds.has(id)).sort()
    removed = [...confirmedIds].filter((id) => !ids.has(id)).sort().map((checkId) => {
      const r = input.results[checkId]
      return { checkId, lastOutcome: r && !('corrupt' in r) ? r.outcome : null }
    })
    taskChanged = confirmation.task !== checklist.task
    structure = structureHash(checklist) === confirmation.structureHash ? 'confirmed' : 'changed'
  }
  return { structure, taskChanged, added, removed, checks, summary: summarize(checks, { structure, taskChanged, added, removed }) }
}

function snapshotIsError(s: WorkspaceSnapshot | { readonly error: string }): s is { readonly error: string } {
  return !(s instanceof Map)
}

const OUTCOME_LABEL: Readonly<Record<Outcome, string>> = { passed: '通过', failed: '失败', error: '执行出错' }

export function summarize(
  statuses: readonly CheckStatus[],
  structure?: Pick<Report, 'structure' | 'taskChanged' | 'added' | 'removed'>,
): string {
  const counts: Partial<Record<CheckState, number>> = {}
  for (const s of statuses) counts[s.state] = (counts[s.state] ?? 0) + 1
  const parts = STATE_ORDER.filter((st) => counts[st]).map((st) => `${counts[st]} 项${STATE_LABELS[st]}`)
  const body = `${statuses.length} 项验收中，${parts.join('、')}`
  if (!structure || structure.structure === 'confirmed') return body
  if (structure.structure === 'unconfirmed') return `清单未确认；${body}`
  const changes: string[] = []
  if (structure.added.length) changes.push(`新增 ${structure.added.join('、')}`)
  if (structure.removed.length) {
    changes.push(`删除 ${structure.removed.map((r) => (r.lastOutcome ? `${r.checkId}（上次${OUTCOME_LABEL[r.lastOutcome]}）` : r.checkId)).join('、')}`)
  }
  if (structure.taskChanged) changes.push('任务描述已改')
  return `清单结构已变，待确认（${changes.join('；')}）；${body}`
}

export interface RawRun {
  readonly exitCode: number | null
  readonly signal: string | null
  readonly timedOut: boolean
  readonly aborted: boolean
  readonly infraError: string | null
}

/** A user-cancelled run is only an attempt; a hang or a missing shell is an error, not a failure. */
export function classifyRun(run: RawRun): Outcome | 'cancelled' {
  if (run.aborted) return 'cancelled'
  if (run.infraError !== null || run.timedOut) return 'error'
  if (run.exitCode === 0) return 'passed'
  if (run.exitCode === null) return 'error'
  return 'failed'
}
