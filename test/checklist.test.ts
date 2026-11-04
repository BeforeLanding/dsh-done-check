import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { DEFAULT_TIMEOUT_SEC, definitionHash, parseChecklist, serializeChecklist, validateChecklist } from '../src/core/checklist.ts'

const SAMPLE = `
version: 1
task: 新增 CSV 导出功能
checks:
  - id: export-tests
    name: 导出相关测试通过
    run: pnpm test -- export
    timeout: 120
    watch: ["test/**", "src/**"]
  - id: typecheck
    name: TypeScript 类型检查通过
    run: pnpm tsc --noEmit
  - id: zh-filename
    name: 中文文件名下载正常
    manual: true
`

function parseOk(text: string) {
  const r = parseChecklist(text)
  if (!r.ok) throw new Error(r.errors.join('\n'))
  return r.checklist
}

describe('parseChecklist', () => {
  it('fills defaults and normalizes', () => {
    const list = parseOk(SAMPLE)
    assert.equal(list.checks.length, 3)
    const [tests, tsc, manual] = list.checks
    assert.deepEqual(tests?.watch, ['src/**', 'test/**'], 'watch is sorted')
    assert.equal(tsc?.timeout, DEFAULT_TIMEOUT_SEC)
    assert.equal(tsc?.cwd, '.')
    assert.equal(manual?.run, null)
    assert.equal(manual?.manual, true)
  })

  it('rejects invalid checklists with every error listed', () => {
    const r = validateChecklist({
      version: 2,
      task: '',
      checks: [
        { id: 'A', name: 'x', run: 'true' },
        { id: 'b', name: 'x', run: 'true', manual: true },
        { id: 'c', name: 'x' },
        { id: 'd', name: 'x', run: 'true', timeout: 99999 },
        { id: 'e', name: 'x', run: 'true', cwd: '../outside' },
        { id: 'f', name: 'x', run: 'true', watch: ['../x'] },
        { id: 'g', name: 'x', run: 'true', extra: 1 },
        { id: 'g', name: 'x', run: 'true' },
      ],
    })
    assert.equal(r.ok, false)
    if (r.ok) return
    const text = r.errors.join('\n')
    for (const needle of ['version', 'task', 'checks[0].id', 'b: run 与 manual', 'c: 自动项', 'd: timeout', 'e: cwd', 'f: watch', '未知字段 extra', 'id 重复']) {
      assert.ok(text.includes(needle), `missing error: ${needle}\n${text}`)
    }
  })

  it('reports YAML syntax errors instead of throwing', () => {
    const r = parseChecklist('checks: [unclosed')
    assert.equal(r.ok, false)
  })
})

describe('definitionHash', () => {
  it('ignores key order and watch order', () => {
    const a = parseOk(SAMPLE).checks[0]!
    const b = parseOk(`
version: 1
task: other task text
checks:
  - watch: ["src/**", "test/**"]
    timeout: 120
    run: pnpm test -- export
    name: 导出相关测试通过
    id: export-tests
`).checks[0]!
    assert.equal(definitionHash(a), definitionHash(b))
  })

  it('changes when any field changes, including a manual check name', () => {
    const base = parseOk(SAMPLE)
    const edited = parseOk(SAMPLE.replace('pnpm tsc --noEmit', 'exit 0').replace('中文文件名下载正常', '下载正常'))
    assert.equal(definitionHash(base.checks[0]!), definitionHash(edited.checks[0]!))
    assert.notEqual(definitionHash(base.checks[1]!), definitionHash(edited.checks[1]!))
    assert.notEqual(definitionHash(base.checks[2]!), definitionHash(edited.checks[2]!))
  })
})

describe('serializeChecklist', () => {
  it('round-trips to the same definitions', () => {
    const list = parseOk(SAMPLE)
    const again = parseOk(serializeChecklist(list))
    assert.deepEqual(again.checks.map(definitionHash), list.checks.map(definitionHash))
  })
})

describe('manual check "how" (v0.2)', () => {
  const WITH_HOW = SAMPLE.replace('    name: 中文文件名下载正常\n    manual: true', '    name: 中文文件名下载正常\n    manual: true\n    how: 导出“报表”，确认文件名没有乱码')

  it('is part of the definition and survives serialization', () => {
    const plain = parseOk(SAMPLE).checks[2]!
    const withHow = parseOk(WITH_HOW).checks[2]!
    assert.equal(withHow.how, '导出“报表”，确认文件名没有乱码')
    assert.notEqual(definitionHash(withHow), definitionHash(plain))
    assert.deepEqual(parseOk(serializeChecklist(parseOk(WITH_HOW))), parseOk(WITH_HOW))
  })

  it('leaves existing definitions byte-for-byte as they were, so v0.1 confirmations stay valid', () => {
    const plain = parseOk(SAMPLE).checks[2]!
    assert.ok(!('how' in plain))
    assert.ok(!serializeChecklist(parseOk(SAMPLE)).includes('how'))
  })

  it('is only for manual checks and must not be empty', () => {
    const auto = SAMPLE.replace('    run: pnpm tsc --noEmit', '    run: pnpm tsc --noEmit\n    how: x')
    assert.equal(parseChecklist(auto).ok, false)
    assert.equal(parseChecklist(WITH_HOW.replace(/how: .*/, 'how: "  "')).ok, false)
  })
})
