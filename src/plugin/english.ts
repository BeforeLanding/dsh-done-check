import type { View } from '../service.ts'
import { itemsOf, needsConfirmation, verdictOf, type Item, type NotRunReasons, type Verdict } from './present.ts'

const labels: Record<Item['shown'], string> = {
  passed: 'Passed', failed: 'Failed', cannot_run: 'Not run', error: 'No usable result', unknown: 'Cannot determine',
  stale: 'Code changed; re-check', unstable: 'Code or definition changed during the run; re-check',
  not_checked: 'Not checked yet', running: 'Running', awaiting: 'Awaiting your manual verdict',
  changed: 'Definition changed; confirm again', unconfirmed: 'Checklist not confirmed',
}
export const englishLabel = (item: Item): string => labels[item.shown]

export function englishVerdict(view: View, reasons: NotRunReasons = new Map()): Verdict {
  const { tier } = verdictOf(view, reasons)
  const items = itemsOf(view, reasons)
  const count = (...states: Item['shown'][]) => items.filter((i) => states.includes(i.shown)).length
  const task = view.checklist.task
  switch (tier) {
    case 'confirm': return { tier, headline: `${task}: review and confirm the checklist (${items.length} checks)`, nextStep: 'Review the commands, then enter /done-check confirm. Nothing runs during preview.' }
    case 'failed': return { tier, headline: `❌ ${task}: ${count('failed')} check(s) failed`, nextStep: 'Inspect /done-check details, fix the problem, then enter /done-check (or /done-check run to force a re-run).' }
    case 'cannot_run': return { tier, headline: `⚠️ ${task}: ${count('cannot_run', 'error', 'unknown')} check(s) have no usable result`, nextStep: 'Resolve the permission, executor or evidence issue, then enter /done-check run.' }
    case 'recheck': return { tier, headline: `🔄 ${task}: ${count('stale', 'unstable', 'not_checked', 'running')} check(s) need attention`, nextStep: items.some((i) => !i.check.manual && ['stale', 'unstable', 'not_checked'].includes(i.shown))
      ? 'Enter /done-check to run the checks that are due.' : items.some((i) => i.shown === 'running') ? 'Wait for the running checks.' : 'Verify the manual item yourself, then enter /done-check ok [n] or /done-check no [n] [note].' }
    case 'awaiting': return { tier, headline: `👤 ${task}: ${count('passed')} passed, ${count('awaiting')} awaiting you`, nextStep: 'Verify the manual item yourself, then enter /done-check ok [n] or /done-check no [n] [note].' }
    case 'passed': return { tier, headline: `✅ ${task}: all ${items.length} agreed checks passed`, nextStep: null }
  }
}

/** Render structured status, never translate test reports, commands or user text. */
export function renderEnglish(view: View, reasons: NotRunReasons = new Map(), options: { notice?: string; detail?: 'run' | 'tech'; items?: readonly Item[] } = {}): string {
  const verdict = englishVerdict(view, reasons)
  const out = [verdict.headline]
  if (options.notice) out.push(options.notice)
  out.push('')
  const preview = needsConfirmation(view)
  const items = options.items ?? itemsOf(view, reasons)
  for (const item of items) {
    const c = item.check
    out.push(`${item.n}. ${c.name} — ${preview ? 'Awaiting checklist confirmation' : englishLabel(item)}`)
    if (item.status.lastAttemptCancelled) out.push('   Last attempt was cancelled; any result shown is from the previous completed run.')
    if (preview && !c.manual) {
      out.push(`   Command: ${c.run}`, `   Working directory: ${c.cwd}`)
    }
    if (c.manual && c.how) out.push(`   How to verify: ${c.how}`)
    if (item.notRun) out.push(`   Command not started (${item.notRun.kind}): ${item.notRun.detail}`)
    if (item.status.reason) out.push(`   Diagnostic: ${item.status.reason}`)
    const rec = item.record
    if (rec && 'corrupt' in rec) out.push(`   Unreadable evidence: ${rec.corrupt}`)
    else if (rec && !preview) {
      if (rec.kind === 'auto') {
        if (rec.failureExcerpt?.length) out.push('   Original test report:', ...rec.failureExcerpt.map((line) => `      ${line}`))
        if (options.detail) {
          out.push(`   Command: ${rec.command}`, `   Exit code: ${rec.exitCode ?? 'none'}; duration: ${rec.durationMs} ms; finished: ${rec.finishedAt}`)
          if (rec.timedOut) out.push('   Timed out; no usable result.')
          if (rec.errorMessage) out.push(`   Executor error: ${rec.errorMessage}`)
          if (rec.stdoutTail) out.push(`   stdout (tail):\n${rec.stdoutTail}`)
          if (rec.stderrTail) out.push(`   stderr (tail):\n${rec.stderrTail}`)
        }
      } else if (options.detail) out.push(`   Your verdict: ${rec.outcome}; ${rec.startedAt}`, `   Note: ${rec.note}`)
      if (options.detail && item.status.changes) {
        const changes = item.status.changes
        out.push(`   Modified: ${changes.modified.join(', ')}`, `   Added: ${changes.added.join(', ')}`, `   Removed: ${changes.removed.join(', ')}`)
      }
      if (options.detail === 'tech') {
        out.push(`   Fingerprint: ${rec.fingerprint.digest}`, `   Definition: ${rec.definitionHash}`, `   Run: ${rec.runId}`)
        if (rec.kind === 'auto') out.push(`   Executor: ${rec.shell ?? 'unknown'}`, `   Log: ${rec.log?.path ?? 'none'}${rec.log?.truncated ? ' (truncated)' : ''}`)
      }
    }
    out.push('')
  }
  if (preview) {
    for (const removed of view.report.removed) out.push(`Removed check: ${view.confirmedNames[removed.checkId] ?? removed.checkId} (previous result: ${removed.lastOutcome ?? 'none'})`)
    if (view.report.taskChanged) out.push('The task description changed.')
    out.push('Confirmation does not bypass shell permissions.')
  }
  if (verdict.nextStep) out.push(`Next: ${verdict.nextStep}`)
  else out.push('Only the agreed checks passed. This does not prove every requirement was covered.')
  return out.join('\n').trimEnd()
}

export const ENGLISH_HELP = `
/done-check — preview, run due checks, or read the verdict
/done-check init — create a draft from existing package scripts and a manual review item
/done-check lang en|zh — select output language for this session
/done-check confirm — confirm the exact checklist you previewed (user only)
/done-check ok [n] / no [n] [note] — record a manual verdict (user only)
/done-check status — read status without running checks
/done-check details [n] — command, result, output and changed files
/done-check all — details for every item
/done-check tech [n] — executor, fingerprint and logs
/done-check run — force-run confirmed automatic checks
/done-check help — this help
Chinese aliases also work. Confirmation never bypasses shell permissions.
`.trim()
