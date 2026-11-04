import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { type CheckStatus, classifyRun, summarize } from '../src/core/status.ts'
import { capLog, tail } from '../src/store/state.ts'

const status = (state: CheckStatus['state']): CheckStatus => ({ checkId: 'x', state, lastOutcome: null, changes: null, reason: null, lastAttemptCancelled: false })

describe('summarize', () => {
  it('counts states without percentages', () => {
    const s = summarize([status('passed'), status('passed'), status('awaiting_manual')])
    assert.equal(s, '3 项验收中，2 项通过、1 项待人工确认')
    assert.ok(!s.includes('%'))
  })
})

describe('classifyRun', () => {
  const base = { exitCode: 0, signal: null, timedOut: false, aborted: false, infraError: null }
  it('maps exit codes, timeouts, infra failures and cancellation', () => {
    assert.equal(classifyRun(base), 'passed')
    assert.equal(classifyRun({ ...base, exitCode: 1 }), 'failed')
    assert.equal(classifyRun({ ...base, exitCode: null, timedOut: true }), 'error')
    assert.equal(classifyRun({ ...base, exitCode: 0, timedOut: true }), 'error')
    assert.equal(classifyRun({ ...base, exitCode: null, signal: 'SIGKILL' }), 'error')
    assert.equal(classifyRun({ ...base, infraError: 'shell not found' }), 'error')
    assert.equal(classifyRun({ ...base, aborted: true }), 'cancelled')
  })
})

describe('tail / capLog', () => {
  it('keeps the end and never splits a multi-byte character', () => {
    assert.equal(tail('short', 100), 'short')
    const t = tail('中文输出'.repeat(10), 10)
    assert.ok(t.startsWith('…'))
    assert.ok(!t.includes('�'))
    assert.ok(Buffer.byteLength(t.slice(1)) <= 10)
  })

  it('caps logs with a visible marker', () => {
    assert.deepEqual(capLog('abc', 10), { content: 'abc', originalBytes: 3, truncated: false })
    const c = capLog('0123456789abcdef', 4)
    assert.equal(c.truncated, true)
    assert.match(c.content, /^\[done-check\] 日志已截断：原始 16 字节，仅保留末尾 4 字节\ncdef$/)
  })
})
