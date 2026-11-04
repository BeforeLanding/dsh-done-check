import yaml from 'js-yaml'
import { canonicalJson, sha256 } from './hash.ts'

export const CHECKLIST_FILE = 'done-check.yaml'
export const DEFAULT_TIMEOUT_SEC = 300
export const MAX_TIMEOUT_SEC = 1800

/** One normalized check: every default is filled, so its hash is stable. */
export interface CheckDefinition {
  readonly id: string
  readonly name: string
  /** Shell command for automatic checks; null for manual checks. */
  readonly run: string | null
  readonly manual: boolean
  readonly timeout: number
  /** Working directory relative to the project root, always POSIX-style. */
  readonly cwd: string
  /** Glob patterns relative to the project root; empty = whole workspace. */
  readonly watch: readonly string[]
  /** Manual checks only: one sentence on how the user can verify it. Part of the definition. Omitted when absent, so old hashes stay valid. */
  readonly how?: string
}

export interface Checklist {
  readonly version: 1
  readonly task: string
  readonly checks: readonly CheckDefinition[]
}

export type ParseResult =
  | { readonly ok: true; readonly checklist: Checklist }
  | { readonly ok: false; readonly errors: readonly string[] }

const ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/
const KNOWN_KEYS = new Set(['id', 'name', 'run', 'manual', 'timeout', 'cwd', 'watch', 'how'])

export function parseChecklist(text: string): ParseResult {
  let raw: unknown
  try {
    raw = yaml.load(text)
  } catch (err) {
    return { ok: false, errors: [`YAML 解析失败：${(err as Error).message}`] }
  }
  return validateChecklist(raw)
}

export function validateChecklist(raw: unknown): ParseResult {
  const errors: string[] = []
  if (!isRecord(raw)) return { ok: false, errors: ['清单根节点必须是对象'] }
  if (raw.version !== 1) errors.push('version 必须为 1')
  const task = typeof raw.task === 'string' ? raw.task.trim() : ''
  if (!task) errors.push('task 必须是非空字符串')
  if (!Array.isArray(raw.checks) || raw.checks.length === 0) {
    errors.push('checks 必须是非空数组')
    return { ok: false, errors }
  }

  const checks: CheckDefinition[] = []
  const seen = new Set<string>()
  raw.checks.forEach((item: unknown, i: number) => {
    const where = `checks[${i}]`
    if (!isRecord(item)) {
      errors.push(`${where} 必须是对象`)
      return
    }
    for (const key of Object.keys(item)) {
      if (!KNOWN_KEYS.has(key)) errors.push(`${where} 含未知字段 ${key}`)
    }
    const id = item.id
    if (typeof id !== 'string' || !ID_PATTERN.test(id)) {
      errors.push(`${where}.id 只能包含小写字母、数字和连字符，且以字母或数字开头`)
      return
    }
    if (seen.has(id)) errors.push(`${where}.id 重复：${id}`)
    seen.add(id)

    const name = typeof item.name === 'string' ? item.name.trim() : ''
    if (!name) errors.push(`${id}: name 必须是非空字符串`)

    const manual = item.manual === true
    if (item.manual !== undefined && typeof item.manual !== 'boolean') errors.push(`${id}: manual 必须是布尔值`)
    const run = typeof item.run === 'string' ? item.run.trim() : ''
    if (item.run !== undefined && typeof item.run !== 'string') errors.push(`${id}: run 必须是字符串`)
    if (manual && run) errors.push(`${id}: run 与 manual 只能二选一`)
    if (!manual && !run) errors.push(`${id}: 自动项必须提供 run，人工项请写 manual: true`)

    let how: string | undefined
    if (item.how !== undefined) {
      if (!manual) errors.push(`${id}: how 只用于人工项`)
      else if (typeof item.how !== 'string' || !item.how.trim()) errors.push(`${id}: how 必须是非空字符串`)
      else how = item.how.trim()
    }

    let timeout = DEFAULT_TIMEOUT_SEC
    if (item.timeout !== undefined) {
      if (manual) errors.push(`${id}: 人工项不需要 timeout`)
      else if (typeof item.timeout !== 'number' || !Number.isInteger(item.timeout) || item.timeout <= 0 || item.timeout > MAX_TIMEOUT_SEC) {
        errors.push(`${id}: timeout 必须是 1–${MAX_TIMEOUT_SEC} 的整数秒`)
      } else timeout = item.timeout
    }

    let cwd = '.'
    if (item.cwd !== undefined) {
      if (manual) errors.push(`${id}: 人工项不需要 cwd`)
      else if (typeof item.cwd !== 'string') errors.push(`${id}: cwd 必须是字符串`)
      else {
        const normalized = normalizeRelative(item.cwd)
        if (normalized === null) errors.push(`${id}: cwd 必须是项目根内的相对路径`)
        else cwd = normalized
      }
    }

    let watch: string[] = []
    if (item.watch !== undefined) {
      if (!Array.isArray(item.watch) || item.watch.some((p: unknown) => typeof p !== 'string' || !p.trim())) {
        errors.push(`${id}: watch 必须是非空字符串数组`)
      } else {
        watch = item.watch.map((p: string) => p.trim().replaceAll('\\', '/'))
        if (watch.some((p) => p.startsWith('/') || /^[a-zA-Z]:/.test(p) || p.split('/').includes('..'))) {
          errors.push(`${id}: watch 必须是项目根内的相对路径模式`)
        }
      }
    }

    checks.push({
      id,
      name,
      run: manual ? null : run,
      manual,
      timeout: manual ? 0 : timeout,
      cwd: manual ? '.' : cwd,
      watch: [...new Set(watch)].sort(),
      ...(how !== undefined ? { how } : {}),
    })
  })

  if (errors.length) return { ok: false, errors }
  return { ok: true, checklist: { version: 1, task, checks } }
}

/** Any field change — including the name, which is the criterion of a manual check — changes the hash. */
export function definitionHash(check: CheckDefinition): string {
  return sha256(canonicalJson(check))
}

/**
 * The checklist as a whole: task text plus the set of check ids. Removing a
 * failing check or rewording the task changes it, so a confirmed list cannot
 * silently shrink to only the checks that pass.
 */
export function structureHash(checklist: Pick<Checklist, 'task' | 'checks'>): string {
  return sha256(canonicalJson({ task: checklist.task, ids: checklist.checks.map((c) => c.id).sort() }))
}

export function serializeChecklist(checklist: Checklist): string {
  const checks = checklist.checks.map((c) => {
    const out: Record<string, unknown> = { id: c.id, name: c.name }
    if (c.manual) {
      out.manual = true
      if (c.how) out.how = c.how
    } else {
      out.run = c.run
      if (c.timeout !== DEFAULT_TIMEOUT_SEC) out.timeout = c.timeout
      if (c.cwd !== '.') out.cwd = c.cwd
    }
    if (c.watch.length) out.watch = [...c.watch]
    return out
  })
  return yaml.dump({ version: 1, task: checklist.task, checks }, { lineWidth: 120 })
}

function normalizeRelative(p: string): string | null {
  const parts = p.replaceAll('\\', '/').trim().split('/').filter((s) => s && s !== '.')
  if (p.trim().startsWith('/') || /^[a-zA-Z]:/.test(p.trim()) || parts.includes('..')) return null
  return parts.length ? parts.join('/') : '.'
}

function isRecord(v: unknown): v is Record<string, any> {
  return v !== null && typeof v === 'object' && !Array.isArray(v)
}
