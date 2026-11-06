import { sha256 } from '../core/hash.ts'
import type { RunRecord } from '../core/status.ts'
import type { ProjectState } from './state.ts'

type ObjectValue = Record<string, unknown>
const object = (v: unknown): v is ObjectValue => v !== null && typeof v === 'object' && !Array.isArray(v)
const string = (v: unknown): v is string => typeof v === 'string'
const nonempty = (v: unknown): v is string => string(v) && v.length > 0
const id = (v: unknown): v is string => string(v) && /^[a-z0-9][a-z0-9-]{0,63}$/.test(v)
const runId = (v: unknown): v is string => string(v) && /^[a-zA-Z0-9-]+$/.test(v)
const hash = (v: unknown): v is string => string(v) && /^[a-f0-9]{64}$/.test(v)
const date = (v: unknown): v is string => string(v) && Number.isFinite(Date.parse(v))
const integer = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v)
const nonnegative = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0
const nullableString = (v: unknown) => v === null || string(v)
const strings = (v: unknown): v is string[] => Array.isArray(v) && v.every(string)
const map = (v: unknown, value: (v: unknown) => boolean, key: (v: unknown) => boolean = id) =>
  object(v) && Object.entries(v).every(([k, entry]) => key(k) && value(entry))

export function validState(v: unknown): v is ProjectState {
  if (!object(v) || v.version !== 1 || !nonempty(v.root)) return false
  if (!map(v.latest, runId) || !map(v.cancelled, runId) || !map(v.history, (a) => Array.isArray(a) && a.every(runId))) return false
  if (!map(v.active, (a) => object(a) && runId(a.runId) && id(a.checkId) && date(a.startedAt) && date(a.deadline))) return false
  if (v.notExecuted !== undefined && !map(v.notExecuted, (a) => object(a) &&
    ['denied', 'sandbox', 'no_shell', 'other'].includes(String(a.kind)) && string(a.detail) && hash(a.definitionHash) && date(a.at))) return false
  if (v.confirmation === null) return true
  const c = v.confirmation
  return object(c) && nonempty(c.task) && Array.isArray(c.checkIds) && c.checkIds.every(id) &&
    new Set(c.checkIds).size === c.checkIds.length && hash(c.structureHash) && map(c.definitions, hash) &&
    c.checkIds.every((key) => object(c.definitions) && hash(c.definitions[key])) && date(c.confirmedAt) &&
    (c.names === undefined || map(c.names, string))
}

function fingerprint(v: unknown): boolean {
  if (!object(v) || !hash(v.digest) || !map(v.files, hash, nonempty)) return false
  // Verify the digest against its file list; a partial record is not evidence.
  const canonical = Object.entries(v.files as ObjectValue).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
    .map(([path, digest]) => `${path}\0${digest}\n`).join('')
  return sha256(canonical) === v.digest
}

export function validRun(v: unknown): v is RunRecord {
  if (!object(v) || !runId(v.runId) || !id(v.checkId) || !hash(v.definitionHash) || !fingerprint(v.fingerprint) || !date(v.startedAt)) return false
  if (v.kind === 'manual') return (v.outcome === 'passed' || v.outcome === 'failed') && string(v.note)
  if (!date(v.finishedAt) || Date.parse(v.finishedAt) < Date.parse(v.startedAt) || !nonnegative(v.durationMs)) return false
  if (v.kind === 'cancelled') return true
  if (v.kind !== 'auto' || !nonempty(v.command) || !['passed', 'failed', 'error'].includes(String(v.outcome))) return false
  if (!(v.exitCode === null || integer(v.exitCode)) || !nullableString(v.signal) || typeof v.timedOut !== 'boolean' ||
    !nullableString(v.errorMessage) || !nullableString(v.shell) || !string(v.stdoutTail) || !string(v.stderrTail)) return false
  const outcome = v.errorMessage !== null || v.timedOut || v.exitCode === null ? 'error' : v.exitCode === 0 ? 'passed' : 'failed'
  if (v.outcome !== outcome) return false
  if (v.log !== null && !(object(v.log) && nonempty(v.log.path) && integer(v.log.originalBytes) && v.log.originalBytes >= 0 && typeof v.log.truncated === 'boolean')) return false
  if (v.failureExcerpt !== undefined && !strings(v.failureExcerpt)) return false
  if (v.unstable !== null) {
    if (!object(v.unstable) || typeof v.unstable.definitionChanged !== 'boolean') return false
    const files = v.unstable.files
    if (files !== null && !(object(files) && strings(files.modified) && strings(files.added) && strings(files.removed))) return false
  }
  return true
}
