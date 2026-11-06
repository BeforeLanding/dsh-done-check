import { randomBytes } from 'node:crypto'
import { mkdir, readFile, realpath, rename, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { sha256 } from '../core/hash.ts'
import { validRun, validState } from './validate.ts'
import type { ActiveRun, ChecklistConfirmation, NotExecutedAttempt, CompletedRun, CorruptRecord, LogRef, RunRecord } from '../core/status.ts'

/** Bytes of stdout/stderr kept inline in a run record. */
export const TAIL_BYTES = 8 * 1024
/** Bytes of a full log kept on disk per run; the head is dropped beyond this. */
export const LOG_CAP_BYTES = 1024 * 1024
/** Run records kept per check; older ones are pruned (worst case ≈ 20 MiB of logs per check). */
export const HISTORY_PER_CHECK = 20
const LOCK_STALE_MS = 2 * 60 * 1000
const LOCK_WAIT_MS = 15 * 1000

export interface ProjectState {
  readonly version: 1
  readonly root: string
  readonly confirmation: ChecklistConfirmation | null
  /** Latest completed run per check: the index the report reads. */
  readonly latest: Readonly<Record<string, string>>
  /** Checks whose most recent attempt, after `latest`, was cancelled. */
  readonly cancelled: Readonly<Record<string, string>>
  /** Every kept run id per check, oldest first. */
  readonly history: Readonly<Record<string, readonly string[]>>
  readonly active: Readonly<Record<string, ActiveRun>>
  /** Checks whose last attempt never started, until their next completed run. Absent in states written before v0.2. */
  readonly notExecuted?: Readonly<Record<string, NotExecutedAttempt>>
}

export type LoadResult = { readonly ok: true; readonly state: ProjectState } | { readonly ok: false; readonly reason: string }

export function emptyState(root: string): ProjectState {
  return { version: 1, root, confirmation: null, latest: {}, cancelled: {}, history: {}, active: {} }
}

export function newRunId(now: Date = new Date()): string {
  return `${now.getTime().toString(36)}-${randomBytes(4).toString('hex')}`
}

/** Stable per-project key: the real path, case-folded on Windows. */
export async function projectId(root: string): Promise<string> {
  let real = (await realpath(root)).replaceAll('\\', '/')
  if (process.platform === 'win32') real = real.toLowerCase()
  return sha256(real).slice(0, 16)
}

/**
 * Evidence lives outside the project (under DSH home), so recording it never
 * changes the workspace fingerprint and workspace-scoped file tools cannot
 * reach it. This does not stop an agent with an unrestricted shell.
 *
 * Every state change goes through `update`, which serializes writers both in
 * this process and across processes (a lock directory), so two sessions
 * running checks at once cannot overwrite each other's confirmation or index.
 */
export class StateStore {
  private readonly baseDir: string
  private readonly queues = new Map<string, Promise<unknown>>()

  constructor(baseDir: string) {
    this.baseDir = baseDir
  }

  async dirFor(root: string): Promise<string> {
    return join(this.baseDir, await projectId(root))
  }

  async load(root: string): Promise<LoadResult> {
    const file = join(await this.dirFor(root), 'state.json')
    let text: string
    try {
      text = await readFile(file, 'utf8')
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return { ok: true, state: emptyState(root) }
      return { ok: false, reason: (err as Error).message }
    }
    try {
      const parsed: unknown = JSON.parse(text)
      if (!validState(parsed)) {
        return { ok: false, reason: 'state.json 格式不符' }
      }
      return { ok: true, state: parsed }
    } catch (err) {
      return { ok: false, reason: `state.json 已损坏：${(err as Error).message}` }
    }
  }

  /** Read-modify-write under the project lock. A corrupt state is never overwritten. */
  async update<T>(root: string, fn: (state: ProjectState) => { state: ProjectState; value: T }): Promise<T> {
    const dir = await this.dirFor(root)
    const prev = this.queues.get(dir) ?? Promise.resolve()
    const next = prev.catch(() => {}).then(() => this.withLock(dir, async () => {
      const loaded = await this.load(root)
      if (!loaded.ok) throw new Error(`证据状态无法读取，拒绝写入：${loaded.reason}`)
      const { state, value } = fn(loaded.state)
      await this.save(dir, state)
      await this.prune(dir, loaded.state, state)
      return value
    }))
    this.queues.set(dir, next)
    return next
  }

  async writeRun(root: string, record: RunRecord): Promise<void> {
    const dir = join(await this.dirFor(root), 'runs')
    await mkdir(dir, { recursive: true })
    await atomicWrite(join(dir, `${record.runId}.json`), `${JSON.stringify(record, null, 2)}\n`)
  }

  async readRun(root: string, runId: string): Promise<RunRecord | CorruptRecord> {
    try {
      if (!/^[a-zA-Z0-9-]+$/.test(runId)) return { corrupt: '运行编号格式不符' }
      const rec: unknown = JSON.parse(await readFile(join(await this.dirFor(root), 'runs', `${runId}.json`), 'utf8'))
      if (!validRun(rec) || rec.runId !== runId) return { corrupt: `运行记录 ${runId} 格式不符` }
      return rec
    } catch (err) {
      return { corrupt: `运行记录 ${runId}：${(err as Error).message}` }
    }
  }

  /** Latest completed run per check id in the index. */
  async loadResults(root: string, state: ProjectState): Promise<Record<string, CompletedRun | CorruptRecord>> {
    const out: Record<string, CompletedRun | CorruptRecord> = {}
    for (const [checkId, runId] of Object.entries(state.latest)) {
      const rec = await this.readRun(root, runId)
      out[checkId] = 'corrupt' in rec ? rec : rec.checkId !== checkId ? { corrupt: '记录与检查项不匹配' }
        : rec.kind === 'cancelled' ? { corrupt: `索引指向已取消的运行 ${runId}` } : rec
    }
    return out
  }

  /** Write a run's full log, keeping at most LOG_CAP_BYTES of its end. */
  async writeLog(root: string, runId: string, content: string): Promise<LogRef> {
    const dir = join(await this.dirFor(root), 'logs')
    await mkdir(dir, { recursive: true })
    const path = join(dir, `${runId}.log`)
    const capped = capLog(content)
    await writeFile(path, capped.content, 'utf8')
    return { path, originalBytes: capped.originalBytes, truncated: capped.truncated }
  }

  private async save(dir: string, state: ProjectState): Promise<void> {
    await mkdir(dir, { recursive: true })
    await atomicWrite(join(dir, 'state.json'), `${JSON.stringify(state, null, 2)}\n`)
  }

  /** Delete records that fell out of every check's history. */
  private async prune(dir: string, before: ProjectState, after: ProjectState): Promise<void> {
    const kept = new Set(Object.values(after.history).flat())
    for (const id of Object.values(after.latest)) kept.add(id)
    const dropped = Object.values(before.history).flat().filter((id) => !kept.has(id))
    for (const id of dropped) {
      await rm(join(dir, 'runs', `${id}.json`), { force: true })
      await rm(join(dir, 'logs', `${id}.log`), { force: true })
    }
  }

  private async withLock<T>(dir: string, fn: () => Promise<T>): Promise<T> {
    await mkdir(dir, { recursive: true })
    const lock = join(dir, 'lock')
    const start = Date.now()
    for (;;) {
      try {
        await mkdir(lock)
        break
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err
        const age = await stat(lock).then((s) => Date.now() - s.mtimeMs, () => 0)
        if (age > LOCK_STALE_MS) {
          await rm(lock, { recursive: true, force: true })
          continue
        }
        if (Date.now() - start > LOCK_WAIT_MS) throw new Error('等待证据锁超时，可能有其他会话正在写入')
        await new Promise((r) => setTimeout(r, 25 + Math.random() * 50))
      }
    }
    try {
      return await fn()
    } finally {
      await rm(lock, { recursive: true, force: true })
    }
  }
}

/** Record a finished run in the index: completed runs become `latest`; cancelled ones are only attempts. */
export function recordRun(state: ProjectState, record: RunRecord): ProjectState {
  const id = record.checkId
  const history = [...(state.history[id] ?? []), record.runId].slice(-HISTORY_PER_CHECK)
  const { [id]: _done, ...active } = state.active
  if (record.kind === 'cancelled') {
    return { ...state, active, history: { ...state.history, [id]: history }, cancelled: { ...state.cancelled, [id]: record.runId } }
  }
  const { [id]: _cleared, ...cancelled } = state.cancelled
  const { [id]: _attempt, ...notExecuted } = state.notExecuted ?? {}
  return { ...state, active, cancelled, notExecuted, history: { ...state.history, [id]: history }, latest: { ...state.latest, [id]: record.runId } }
}

export function confirmState(state: ProjectState, confirmation: ChecklistConfirmation): ProjectState {
  return { ...state, confirmation }
}

/** Last `max` bytes of a UTF-8 string, cut on a character boundary. */
export function tail(text: string, max: number = TAIL_BYTES): string {
  const buf = Buffer.from(text, 'utf8')
  if (buf.length <= max) return text
  let start = buf.length - max
  while (start < buf.length && ((buf[start] ?? 0) & 0xc0) === 0x80) start++
  return `…${buf.subarray(start).toString('utf8')}`
}

export function capLog(content: string, cap: number = LOG_CAP_BYTES): { content: string; originalBytes: number; truncated: boolean } {
  const originalBytes = Buffer.byteLength(content, 'utf8')
  if (originalBytes <= cap) return { content, originalBytes, truncated: false }
  const kept = tail(content, cap).slice(1)
  return { content: `[done-check] 日志已截断：原始 ${originalBytes} 字节，仅保留末尾 ${cap} 字节\n${kept}`, originalBytes, truncated: true }
}

async function atomicWrite(file: string, content: string): Promise<void> {
  const tmp = `${file}.${process.pid}.${randomBytes(3).toString('hex')}.tmp`
  await writeFile(tmp, content, 'utf8')
  await rename(tmp, file)
}
