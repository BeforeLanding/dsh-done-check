/**
 * What the user reads (v0.2). Pure functions over the derived report: no DSH
 * imports, no state of their own, nothing here can change a verdict — it only
 * words it. Every output starts with one complete conclusion line, because
 * DSH uses a command's first line as the collapsed row title.
 *
 * Three layers, each more technical than the last:
 *   summary  — conclusion, one line per check, a quote of what failed, the next step
 *   details  — command, exit code, time, output tail, changed files, internal id
 *   tech     — executor and sandbox, full fingerprint, definition hash, log path
 *
 * Symbols only ever lead a line; nothing is aligned after them, because
 * their rendered width is not reliable.
 */
import type { CheckDefinition } from '../core/checklist.ts'
import { stripAnsi } from '../core/excerpt.ts'
import type { AutoRun, CheckStatus, CompletedRun, CorruptRecord } from '../core/status.ts'
import type { RunSummary, View } from '../service.ts'

/** Why checks that were attempted this time never ran (id → user-facing reason). */
export type NotRunReasons = ReadonlyMap<string, string>

export type Tier = 'confirm' | 'failed' | 'cannot_run' | 'recheck' | 'awaiting' | 'passed'

export interface Verdict {
  readonly tier: Tier
  /** The first line of every output. */
  readonly headline: string
  /** The single most useful next action, or null when there is nothing to do. */
  readonly nextStep: string | null
}

/** What a check looks like to the user; coarser than the internal state. */
type Shown =
  | 'passed' | 'failed' | 'cannot_run' | 'error' | 'unknown' | 'stale' | 'unstable'
  | 'not_checked' | 'running' | 'awaiting' | 'changed' | 'unconfirmed'

export interface Item {
  /** 1-based position in the checklist: the number users type. */
  readonly n: number
  readonly check: CheckDefinition
  readonly status: CheckStatus
  readonly record: CompletedRun | CorruptRecord | undefined
  readonly shown: Shown
  readonly notRunReason: string | null
}

const BOUNDARY = '这表示约定的检查都通过了，不代表需求里的每一点都被检查到。'
const NO_EXCERPT = '测试未给出错误信息，见运行详情'

export function describeNotExecuted(reason: string): string {
  const r = reason.replace(/^未执行：/, '')
  if (/拒绝/.test(r)) return '命令被权限设置拒绝，没有执行'
  if (/没有可用的/.test(r)) return '当前没有可用的 shell 工具，命令没有执行'
  if (/沙箱/.test(r)) return '沙箱运行失败，命令没有执行'
  return `命令没有执行（${r}）`
}

export function notRunReasons(run: RunSummary): Map<string, string> {
  return new Map(run.skipped.filter((s) => s.kind === 'not_executed').map((s) => [s.checkId, describeNotExecuted(s.reason)]))
}

export function itemsOf(view: View, notRun: NotRunReasons = new Map()): Item[] {
  return view.checklist.checks.map((check, i) => {
    const status = view.report.checks.find((s) => s.checkId === check.id)!
    const reason = notRun.get(check.id) ?? null
    const retriable = status.state === 'not_run' || status.state === 'stale' || status.state === 'unstable' || status.state === 'error'
    return { n: i + 1, check, status, record: view.results[check.id], notRunReason: reason && retriable ? reason : null, shown: shownOf(status.state, reason !== null && retriable) }
  })
}

function shownOf(state: CheckStatus['state'], cannotRun: boolean): Shown {
  if (cannotRun) return 'cannot_run'
  switch (state) {
    case 'passed': return 'passed'
    case 'failed': return 'failed'
    case 'error': return 'error'
    case 'unknown': return 'unknown'
    case 'stale': return 'stale'
    case 'unstable': return 'unstable'
    case 'not_run': return 'not_checked'
    case 'running': return 'running'
    case 'awaiting_manual': return 'awaiting'
    case 'definition_changed': return 'changed'
    case 'unconfirmed': return 'unconfirmed'
  }
}

const count = (items: readonly Item[], ...shown: Shown[]) => items.filter((i) => shown.includes(i.shown)).length

/** Manual checks the user can decide right now. */
export function pendingManual(items: readonly Item[]): Item[] {
  return items.filter((i) => i.check.manual && (i.shown === 'awaiting' || i.shown === 'stale'))
}

export function needsConfirmation(view: View): boolean {
  return view.report.structure !== 'confirmed' || view.report.checks.some((s) => s.state === 'definition_changed' || s.state === 'unconfirmed')
}

/** Auto checks the smart `/done-check` runs on its own: never checked, or code moved on since. */
export function dueAutoChecks(view: View): string[] {
  return view.report.checks
    .filter((s) => ['not_run', 'stale', 'unstable'].includes(s.state))
    .map((s) => s.checkId)
    .filter((id) => view.checklist.checks.find((c) => c.id === id)?.manual === false)
}

export function verdictOf(view: View, notRun: NotRunReasons = new Map()): Verdict {
  const items = itemsOf(view, notRun)
  const { task } = view.checklist
  const total = items.length
  const rep = view.report

  if (needsConfirmation(view)) {
    if (rep.structure === 'unconfirmed') return { tier: 'confirm', headline: `${task}的验收清单等你确认（${total} 项）`, nextStep: '确认无误后输入 /done-check 确认' }
    if (rep.structure === 'changed') return { tier: 'confirm', headline: `${task}的验收清单有改动，等你重新确认（${total} 项）`, nextStep: '确认无误后输入 /done-check 确认' }
    const k = count(items, 'changed', 'unconfirmed')
    return { tier: 'confirm', headline: `✏️ ${k} 项检查被修改过，需要你重新确认`, nextStep: '确认无误后输入 /done-check 确认（会先展示改动）' }
  }

  const failed = count(items, 'failed')
  if (failed) {
    return { tier: 'failed', headline: `❌ ${task}还有 ${failed} 项检查未通过`, nextStep: '让 Agent 排查失败的检查，修复后输入 /done-check 重新验证。' }
  }

  const cannot = count(items, 'cannot_run')
  const errored = count(items, 'error')
  const unknown = count(items, 'unknown')
  if (cannot + errored + unknown) {
    if (cannot + errored) {
      const next = cannot ? '放宽这条命令的权限后，输入 /done-check 重试' : '排查执行环境或超时设置后，输入 /done-check 重新检查'
      return { tier: 'cannot_run', headline: `⚠️ ${cannot + errored} 项检查没能运行，结果未知`, nextStep: next }
    }
    return { tier: 'cannot_run', headline: `❓ ${unknown} 项检查无法判定`, nextStep: '按提示修复后，输入 /done-check 重新检查' }
  }

  const stale = count(items, 'stale')
  const unstable = count(items, 'unstable')
  const notChecked = count(items, 'not_checked')
  const running = count(items, 'running')
  if (stale + unstable + notChecked + running) {
    const auto = items.some((i) => !i.check.manual && ['stale', 'unstable', 'not_checked'].includes(i.shown))
    const manualOnly = pendingManual(items)
    const nextStep = auto
      ? '输入 /done-check 重新检查（变化的文件见 /done-check 详情）'
      : running && !manualOnly.length ? '等待检查结束' : manualNext(manualOnly)
    const headline = stale
      ? `🔄 代码已更新，${stale + unstable} 项需要重新检查`
      : unstable ? `🔄 ${unstable} 项检查时代码正在变化，结果不可信`
        : notChecked ? `⏳ ${notChecked} 项检查还没执行` : `⏳ ${running} 项正在检查`
    return { tier: 'recheck', headline, nextStep }
  }

  const awaiting = count(items, 'awaiting')
  if (awaiting) return { tier: 'awaiting', headline: `👤 ${awaiting} 项等你确认`, nextStep: manualNext(pendingManual(items)) }

  return { tier: 'passed', headline: `✅ ${task}的 ${total} 项检查全部通过`, nextStep: null }
}

function manualNext(pending: readonly Item[]): string {
  return pending.length === 1 ? '亲自验证后输入 /done-check ok（没通过输入 /done-check no）' : '亲自验证后输入 /done-check ok <序号>（没通过用 no）'
}

function excerptLines(record: Item['record']): string[] | null {
  if (!record || 'corrupt' in record || record.kind !== 'auto') return null
  return record.failureExcerpt?.length ? [...record.failureExcerpt] : []
}

/** Lines for one check in the default summary. Never contains an id, hash, path or millisecond count. */
function summaryLines(item: Item, withNumber: boolean): string[] {
  const { name, manual } = item.check
  const label = withNumber ? `${item.n}. ${name}` : name
  switch (item.shown) {
    case 'passed': return [`✅ ${label}${manual ? '（你已确认）' : ''}`]
    case 'failed': {
      if (manual) {
        const note = item.record && !('corrupt' in item.record) && item.record.kind === 'manual' ? item.record.note : ''
        return [`❌ ${label}（你标记为未通过）`, ...(note ? [`   备注：${note}`] : [])]
      }
      const ex = excerptLines(item.record)
      return [`❌ ${label}`, ...quoted(ex?.length ? ex : [NO_EXCERPT], !!ex?.length)]
    }
    case 'cannot_run': return [`⚠️ ${label}`, `   原因：${item.notRunReason}`, '   这不是检查失败，也不表示功能测过了。']
    case 'error': {
      const rec = item.record && !('corrupt' in item.record) && item.record.kind === 'auto' ? item.record : null
      return [`⚠️ ${label}`, `   没能跑完：${rec?.timedOut ? '超时' : '执行环境出错'}。这不是检查失败，结果未知。`]
    }
    case 'unknown': return [`❓ ${label}`, `   无法判定：${item.status.reason ?? '验收记录无法读取'}`]
    case 'stale': return manual ? [`👤 ${label}`, '   需要你重新确认（代码改过）'] : [`🔄 ${label}`, '   代码已更新，需要重新检查']
    case 'unstable': return [`🔄 ${label}`, '   检查时代码正在变化，结果不可信']
    case 'not_checked': return [`⏳ ${label}`, '   还没检查']
    case 'running': return [`⏳ ${label}`, '   正在检查']
    case 'awaiting': return [`👤 ${label}`, ...(manual && item.check.how ? [`   怎么验证：${item.check.how}`] : []), '   等你确认']
    case 'changed':
    case 'unconfirmed': return [`✏️ ${label}`, '   这项检查被修改过，需要你重新确认']
  }
}

function quoted(lines: readonly string[], isQuote: boolean): string[] {
  if (!isQuote) return [`   ${lines[0]}`]
  const [first = '', ...more] = lines
  return [`   测试报告：${first}`, ...more.map((l) => `   　　　　　${l}`)]
}

export interface SummaryOptions {
  readonly notRun?: NotRunReasons
  /** Extra lines directly under the headline, e.g. "已记录：…". */
  readonly preface?: readonly string[]
}

/** The default output: conclusion, what each check came to, the next step. */
export function renderSummary(view: View, opts: SummaryOptions = {}): string {
  const notRun = opts.notRun ?? new Map()
  if (needsConfirmation(view)) return renderPreview(view, opts)
  const verdict = verdictOf(view, notRun)
  const items = itemsOf(view, notRun)
  const out: string[] = [verdict.headline]
  if (opts.preface?.length) out.push(...opts.preface)
  out.push('')

  if (verdict.tier === 'recheck') {
    const stale = items.filter((i) => i.shown === 'stale' || i.shown === 'unstable')
    const notChecked = count(items, 'not_checked')
    if (stale.length) {
      out.push(stale.every((i) => i.record && !('corrupt' in i.record) && i.record.outcome === 'passed') ? '上次通过的结果对应修改前的代码。' : '上次的结果对应修改前的代码。')
      const auto = stale.filter((i) => !i.check.manual).length
      out.push([auto ? `${auto} 项可以自动重验` : '', stale.length - auto ? `${stale.length - auto} 项需要你手动复核` : ''].filter(Boolean).join('，') + '。')
    }
    if (notChecked) out.push(`${notChecked} 项还没有检查过。`)
    const valid = count(items, 'passed')
    if (valid) out.push(`另有 ${valid} 项结果仍然有效。`)
  } else {
    const numbered = pendingManual(items).length > 1
    for (const item of items) out.push(...summaryLines(item, numbered && pendingManual(items).includes(item)))
  }

  out.push('')
  if (verdict.tier === 'passed') out.push(BOUNDARY)
  else {
    if (verdict.nextStep) out.push(`下一步：${verdict.nextStep}`)
    if (verdict.tier !== 'recheck' && items.some((i) => ['failed', 'cannot_run', 'error', 'stale', 'unknown'].includes(i.shown))) out.push('详情：/done-check 详情')
  }
  return trimBlank(out)
}

/** The checklist as the user is about to confirm it — commands included. Runs nothing. */
export function renderPreview(view: View, opts: SummaryOptions = {}): string {
  const verdict = verdictOf(view)
  const items = itemsOf(view)
  const rep = view.report
  const reconfirm = rep.structure !== 'unconfirmed'
  const mark = (item: Item) => (!reconfirm ? '' : rep.added.includes(item.check.id) ? '（新增）' : item.shown === 'changed' ? '（修改过）' : '')
  const out: string[] = [verdict.headline]
  if (opts.preface?.length) out.push(...opts.preface)
  out.push('')

  const auto = items.filter((i) => !i.check.manual)
  const manual = items.filter((i) => i.check.manual)
  if (auto.length) {
    out.push('自动检查（确认后执行以下命令）')
    for (const i of auto) {
      out.push(`  ${i.n}. ${i.check.name}${mark(i)}`, `     $ ${i.check.run}`)
      if (i.check.cwd !== '.') out.push(`     在目录 ${i.check.cwd} 下执行`)
    }
  }
  if (manual.length) {
    out.push('需要你亲自确认')
    for (const i of manual) {
      out.push(`  ${i.n}. ${i.check.name}${mark(i)}`)
      if (i.check.how) out.push(`     验证方式：${i.check.how}`)
    }
  }
  if (reconfirm && rep.removed.length) {
    out.push('已删除的检查')
    for (const r of rep.removed) out.push(`  ${r.checkId}${r.lastOutcome ? `（上次${{ passed: '通过', failed: '未通过', error: '没能跑完' }[r.lastOutcome]}）` : ''}`)
  }
  if (reconfirm && rep.taskChanged) out.push('任务描述有改动。')
  out.push('')
  if (auto.length) out.push('确认后输入 /done-check 会执行这些命令，按你当前的权限设置执行。')
  out.push(`下一步：${verdict.nextStep}`)
  return trimBlank(out)
}

export type DetailLevel = 'run' | 'tech'

/** Items that the details command shows when no number is given. */
export function problemItems(view: View, notRun: NotRunReasons = new Map()): Item[] {
  return itemsOf(view, notRun).filter((i) => i.shown !== 'passed')
}

export function renderDetails(view: View, items: readonly Item[], level: DetailLevel, notRun: NotRunReasons = new Map()): string {
  const verdict = verdictOf(view, notRun)
  if (!items.length) return [verdict.headline, '', '没有需要展开的项目。输入 /done-check 全部 查看每一项。'].join('\n')
  const out: string[] = [items.length === 1 ? itemHeadline(items[0]!) : verdict.headline, '']
  items.forEach((item, idx) => {
    if (idx) out.push('')
    out.push(...itemDetail(view, item, level, items.length > 1))
  })
  out.push('')
  if (verdict.nextStep) out.push(`下一步：${verdict.nextStep}`)
  if (level === 'run') out.push('技术详情（执行器、指纹、日志）：/done-check 技术详情')
  return trimBlank(out)
}

const SYMBOL: Record<Shown, string> = {
  passed: '✅', failed: '❌', cannot_run: '⚠️', error: '⚠️', unknown: '❓', stale: '🔄', unstable: '🔄',
  not_checked: '⏳', running: '⏳', awaiting: '👤', changed: '✏️', unconfirmed: '✏️',
}

function itemHeadline(item: Item): string {
  const sym = item.shown === 'stale' && item.check.manual ? '👤' : SYMBOL[item.shown]
  return `${sym} ${item.check.name}（${item.check.id}）`
}

const STATE_TEXT: Partial<Record<Shown, string>> = {
  passed: '通过', stale: '代码已更新，需要重新检查', unstable: '检查时代码正在变化，结果不可信', not_checked: '还没检查', running: '正在检查',
  awaiting: '等你确认', changed: '这项检查被修改过，需要你重新确认', unconfirmed: '清单还没有确认',
}

function itemDetail(view: View, item: Item, level: DetailLevel, withHeader: boolean): string[] {
  const out: string[] = []
  if (withHeader) out.push(`${item.n}. ${itemHeadline(item)}`)
  const text = STATE_TEXT[item.shown]
  if (text && (item.shown !== 'passed' || withHeader)) out.push(`   ${text}`)
  if (item.shown === 'cannot_run') out.push(`   没能运行：${item.notRunReason}`, '   这不是检查失败，也不表示功能测过了。')
  if (item.shown === 'unknown') out.push(`   无法判定：${item.status.reason ?? '验收记录无法读取'}`)
  if (item.status.reason && (item.shown === 'unstable' || item.shown === 'error')) out.push(`   ${item.status.reason}`)
  const rec = item.record
  if (!rec) {
    if (item.shown !== 'cannot_run') out.push('   还没有运行记录。')
    return out
  }
  if ('corrupt' in rec) return [...out, `   记录无法读取：${rec.corrupt}`]

  if (rec.kind === 'manual') {
    out.push('', '你的结论', `   ${rec.outcome === 'passed' ? '通过' : '未通过'}，${hhmm(rec.startedAt)}`)
    if (rec.note) out.push(`   备注    ${rec.note}`)
    if (item.check.how) out.push(`   验证方式  ${item.check.how}`)
    out.push(`   代码    ${codeLine(item)}`)
    if (level === 'tech') out.push('', ...techLines(rec))
    return out
  }

  const ex = rec.failureExcerpt
  if (rec.outcome !== 'passed') {
    out.push('', rec.outcome === 'failed' ? '测试报告的错误' : '执行情况')
    if (rec.outcome === 'error') out.push(`   ${rec.timedOut ? '命令超时' : '执行环境出错'}${rec.errorMessage ? `：${rec.errorMessage}` : ''}`)
    else out.push(...(ex?.length ? ex : [NO_EXCERPT]).map((l) => `   ${l}`))
  }
  out.push('', '运行详情')
  out.push(`   命令    ${rec.command}`)
  const exit = rec.exitCode === null ? '无退出码' : `退出码 ${rec.exitCode}`
  out.push(`   结果    ${exit}${rec.timedOut ? '，超时' : ''}，${duration(rec.durationMs)}，${hhmm(rec.finishedAt)}`)
  out.push(`   代码    ${codeLine(item)}`)
  for (const [label, body] of [['stderr', rec.stderrTail], ['stdout', rec.stdoutTail]] as const) {
    const lines = stripAnsi(body).split('\n').filter((l) => l.trim()).slice(-8)
    if (lines.length) out.push(`   ${label}（末尾）`, ...lines.map((l) => `      ${l}`))
  }
  if (level === 'tech') out.push('', ...techLines(rec))
  return out
}

function codeLine(item: Item): string {
  const c = item.status.changes
  if (item.shown === 'stale' && c) {
    const parts = [
      c.modified.length ? `修改 ${files(c.modified)}` : '', c.added.length ? `新增 ${files(c.added)}` : '', c.removed.length ? `删除 ${files(c.removed)}` : '',
    ].filter(Boolean)
    return `已更新：${parts.join('；')}`
  }
  if (item.shown === 'unstable') return '检查期间代码发生了变化'
  return '与检查时一致'
}

function files(list: readonly string[]): string {
  return list.length > 3 ? `${list.slice(0, 3).join('、')} 等 ${list.length} 个` : list.join('、')
}

function techLines(rec: AutoRun | Extract<CompletedRun, { kind: 'manual' }>): string[] {
  const out = ['技术详情']
  if (rec.kind === 'auto') out.push(`   执行器    ${rec.shell ?? '未知'}`)
  out.push(`   指纹      ${rec.fingerprint.digest}（覆盖 ${Object.keys(rec.fingerprint.files).length} 个文件）`)
  out.push(`   定义哈希  ${rec.definitionHash}`)
  out.push(`   运行编号  ${rec.runId}`)
  if (rec.kind === 'auto') {
    if (rec.signal) out.push(`   信号      ${rec.signal}`)
    out.push(`   耗时      ${rec.durationMs} ms`)
    if (rec.log) out.push(`   完整日志  ${rec.log.path}${rec.log.truncated ? `（已截断，原始 ${rec.log.originalBytes} 字节）` : ''}`)
  }
  return out
}

function duration(ms: number): string {
  return ms < 50 ? '用时不到 0.1 秒' : `用时 ${(ms / 1000).toFixed(1)} 秒`
}

function hhmm(iso: string): string {
  const d = new Date(iso)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

function trimBlank(lines: readonly string[]): string {
  return lines.join('\n').replaceAll(/\n{3,}/g, '\n\n').trimEnd()
}

/** `/done-check 全部`: every check, passing ones included. */
export function renderAll(view: View, level: DetailLevel, notRun: NotRunReasons = new Map()): string {
  return renderDetails(view, itemsOf(view, notRun), level, notRun)
}

export type Resolved = { readonly ok: true; readonly item: Item } | { readonly ok: false; readonly message: string }

/** A number (position in the checklist) or an internal id. */
export function resolveItem(items: readonly Item[], token: string): Resolved {
  const byNumber = /^\d+$/.test(token) ? items[Number(token) - 1] : undefined
  const item = byNumber ?? items.find((i) => i.check.id === token)
  return item ? { ok: true, item } : { ok: false, message: `清单里没有第 ${token} 项（共 ${items.length} 项）` }
}

/** Plain-text report of a run, for the user's `重新检查` and legacy `run`: nothing to add to the summary, so only what the run itself changed. */
export function runNote(run: RunSummary): string[] {
  const out: string[] = []
  if (run.cancelled.length) out.push(`已取消 ${run.cancelled.length} 项检查。`)
  const blocked = run.skipped.filter((s) => s.kind === 'blocked' || s.kind === 'busy')
  for (const s of blocked) out.push(`跳过一项：${s.reason}`)
  return out
}

const SHOWN_LABEL: Record<Shown, string> = {
  passed: '通过', failed: '未通过', cannot_run: '没能运行', error: '没能跑完', unknown: '无法判定',
  stale: '代码已更新，需要重新检查', unstable: '检查时代码正在变化，结果不可信', not_checked: '还没检查', running: '正在检查',
  awaiting: '等你确认', changed: '需要你重新确认', unconfirmed: '需要你重新确认',
}

/** The user-facing wording of one check's state (the internal state name is unchanged). */
export function itemLabel(item: Item): string {
  return item.shown === 'stale' && item.check.manual ? '需要你重新确认（代码改过）' : SHOWN_LABEL[item.shown]
}

const GENERIC_NAME = /^(测试|检查|验证|单测|test|tests|check|checks|ci|build|lint)(\s*(通过|成功|ok|passes?|passed))?$/i

/** Non-blocking hints on a draft: names that say nothing a user can judge. */
export function draftWarnings(checks: readonly CheckDefinition[]): string[] {
  return checks
    .filter((c) => GENERIC_NAME.test(c.name.trim()))
    .map((c) => `${c.id}：名称"${c.name}"太笼统，用户看不出它验证了什么；请改成用户能判断的行为，例如"含逗号和换行的数据能正确导出"。`)
}
