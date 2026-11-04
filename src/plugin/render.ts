import type { Checklist } from '../core/checklist.ts'
import { type CheckStatus, type Outcome, type Report, type RunRecord, STATE_LABELS } from '../core/status.ts'
import type { RunSummary } from '../service.ts'

const OUTCOME: Readonly<Record<Outcome, string>> = { passed: '通过', failed: '失败', error: '执行出错' }

/** Markdown cell: no pipes or newlines. */
function cell(text: string): string {
  return text.replaceAll('|', '\\|').replaceAll(/\r?\n/g, ' ')
}

function listFiles(files: readonly string[]): string {
  return files.length > 3 ? `${files.slice(0, 3).join(', ')} 等 ${files.length} 个` : files.join(', ')
}

function note(s: CheckStatus): string {
  const parts: string[] = []
  if (s.state === 'stale' && s.lastOutcome) {
    parts.push(`上次${OUTCOME[s.lastOutcome]}`)
    const c = s.changes
    if (c?.modified.length) parts.push(`修改 ${listFiles(c.modified)}`)
    if (c?.added.length) parts.push(`新增 ${listFiles(c.added)}`)
    if (c?.removed.length) parts.push(`删除 ${listFiles(c.removed)}`)
  }
  if (s.reason) parts.push(s.reason)
  if (s.lastAttemptCancelled) parts.push('最近一次执行已取消')
  return parts.join('；')
}

export function renderReport(report: Report, checklist: Checklist): string {
  const names = new Map(checklist.checks.map((c) => [c.id, c]))
  const rows = report.checks.map((s) => {
    const c = names.get(s.checkId)
    const kind = c?.manual ? '人工' : '自动'
    return `| \`${s.checkId}\` | ${cell(c?.name ?? '')} | ${kind} | ${STATE_LABELS[s.state]} | ${cell(note(s))} |`
  })
  return [
    `**${cell(checklist.task)}**`,
    '',
    report.summary,
    '',
    '| 检查 | 验收标准 | 类型 | 状态 | 说明 |',
    '|---|---|---|---|---|',
    ...rows,
    '',
    '"通过"只表示约定的检查通过，不表示需求已完整实现。`/done-check show <id>` 查看证据。',
  ].join('\n')
}

/** Terminal colour/cursor escapes render as garbage in Markdown; evidence on disk keeps them. */
export function stripAnsi(text: string): string {
  return text.replaceAll(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, '').replaceAll('\r\n', '\n')
}

function fence(raw: string): string {
  const text = stripAnsi(raw)
  const longest = Math.max(2, ...[...text.matchAll(/`+/g)].map((m) => m[0].length))
  const f = '`'.repeat(longest + 1)
  return `${f}text\n${text.trimEnd() || '(无输出)'}\n${f}`
}

export function renderEvidence(record: RunRecord | undefined, checkName: string): string {
  if (!record) return `**${cell(checkName)}**：还没有完成的运行或结论。`
  const lines = [`**${cell(checkName)}**`, '']
  if (record.kind === 'manual') {
    lines.push(`- 人工结论：${OUTCOME[record.outcome]}（${record.startedAt}）`)
    if (record.note) lines.push(`- 备注：${record.note}`)
    lines.push(`- 绑定指纹：\`${record.fingerprint.digest.slice(0, 12)}\`，覆盖 ${Object.keys(record.fingerprint.files).length} 个文件`)
    return lines.join('\n')
  }
  if (record.kind === 'cancelled') {
    lines.push(`- 已取消的尝试（${record.startedAt}，${record.durationMs} ms）`)
    return lines.join('\n')
  }
  lines.push(
    `- 命令：\`${record.command}\``,
    `- 结论：${OUTCOME[record.outcome]}；退出码 ${record.exitCode ?? '无'}${record.signal ? `，信号 ${record.signal}` : ''}${record.timedOut ? '，超时' : ''}`,
    `- 执行器：${record.shell ?? '未知'}；开始 ${record.startedAt}；耗时 ${record.durationMs} ms`,
    `- 绑定指纹：\`${record.fingerprint.digest.slice(0, 12)}\`，覆盖 ${Object.keys(record.fingerprint.files).length} 个文件`,
  )
  if (record.errorMessage) lines.push(`- 执行器错误：${record.errorMessage}`)
  if (record.unstable) lines.push('- ⚠ 执行期间工作区或定义发生变化，该结果无效，须重跑')
  if (record.log) lines.push(`- 完整日志：\`${record.log.path}\`${record.log.truncated ? `（已截断，原始 ${record.log.originalBytes} 字节）` : ''}`)
  lines.push('', 'stdout（末尾）：', fence(record.stdoutTail), '', 'stderr（末尾）：', fence(record.stderrTail))
  return lines.join('\n')
}

export function renderRunSummary(run: RunSummary): string {
  const lines: string[] = []
  for (const r of run.ran) {
    lines.push(`- \`${r.checkId}\`：${OUTCOME[r.outcome]}（退出码 ${r.exitCode ?? '无'}，${r.durationMs} ms）${r.unstable ? '，⚠ 执行期间工作区变化，结果无效' : ''}`)
  }
  for (const id of run.cancelled) lines.push(`- \`${id}\`：已取消`)
  for (const s of run.skipped) lines.push(`- \`${s.checkId}\`：跳过，${s.reason}`)
  return lines.length ? lines.join('\n') : '没有可执行的自动检查。'
}
