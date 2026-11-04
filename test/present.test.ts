/**
 * The five target outputs of the v0.2 plan, as exact snapshots, plus the
 * rules that hold for every output: the first line is a complete
 * conclusion, and the default layer shows no ids, hashes, paths or timings.
 */
import assert from 'node:assert/strict'
import { afterEach, describe, it } from 'node:test'
import { confirmedHeadline, itemsOf, notRunReasons, problemItems, renderAll, renderDetails, renderPreview, renderSummary, verdictOf } from '../src/plugin/present.ts'
import { NotExecutedError, confirm, decide, previewDigest, runChecks, view } from '../src/service.ts'
import { cleanupAll, fakeExec, makeRepo, outcome, signal } from './helpers.ts'

afterEach(cleanupAll)

const YAML = `
version: 1
task: CSV 导出
checks:
  - id: export-tests
    name: 导出内容与所选数据一致
    run: node test/export.test.mjs
    watch: ["src/**", "test/**"]
  - id: escape-tests
    name: 含逗号和换行的数据能正确导出
    run: node test/escape.test.mjs
    watch: ["src/**", "test/**"]
  - id: zh-filename
    name: 中文文件名可以正常下载
    manual: true
    how: 在浏览器里导出一个名为“报表”的文件，确认文件名没有乱码
    watch: ["src/**"]
`

const FAILING = fakeExec({
  'node test/export.test.mjs': {
    exitCode: 1,
    stderr: "(node:9) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.\ntoCsv mismatch\n",
  },
})

function newRepo() {
  const repo = makeRepo({ 'src/export.mjs': 'a\n', 'test/x.mjs': 'b\n' })
  repo.write('done-check.yaml', YAML)
  return repo
}

async function confirmedAndPassed() {
  const repo = newRepo()
  await confirm(repo.env)
  await runChecks(repo.env, fakeExec(), { signal: signal() })
  await decide(repo.env, 'zh-filename', 'passed', '')
  return repo
}

/** Every output the default layer can produce must satisfy these. */
function assertPlain(text: string) {
  assert.ok(text.split('\n')[0]!.trim().length > 4, 'the first line is a complete conclusion')
  assert.doesNotMatch(text, /export-tests|escape-tests|zh-filename/, 'no internal ids')
  assert.doesNotMatch(text, /[0-9a-f]{12}/, 'no hashes')
  assert.doesNotMatch(text, /\bms\b|毫秒|\.log|done-check-home/, 'no timings or paths')
  assert.doesNotMatch(text, /已过期|执行出错|待人工确认/, 'none of the old wording')
}

describe('scenario A: preview before confirming', () => {
  it('shows what will run and executes nothing', async () => {
    const repo = newRepo()
    const text = renderPreview(await view(repo.env))
    assert.equal(text, [
      'CSV 导出的验收清单等你确认（3 项）',
      '',
      '自动检查（确认后执行以下命令）',
      '  1. 导出内容与所选数据一致',
      '     $ node test/export.test.mjs',
      '  2. 含逗号和换行的数据能正确导出',
      '     $ node test/escape.test.mjs',
      '需要你亲自确认',
      '  3. 中文文件名可以正常下载',
      '     验证方式：在浏览器里导出一个名为“报表”的文件，确认文件名没有乱码',
      '',
      '确认后输入 /done-check 会执行这些命令，按你当前的权限设置执行。',
      '下一步：确认无误后输入 /done-check 确认',
    ].join('\n'))
    assertPlain(text)
  })

  it('marks what changed when a confirmed list is edited', async () => {
    const repo = await confirmedAndPassed()
    repo.write('done-check.yaml', YAML.replace('node test/escape.test.mjs', 'node test/escape2.test.mjs') + '  - id: extra\n    name: 空数据导出为空文件\n    run: node test/empty.test.mjs\n')
    const text = renderSummary(await view(repo.env))
    assert.match(text.split('\n')[0]!, /^CSV 导出的验收清单有改动，等你重新确认（4 项）$/)
    assert.match(text, /2\. 含逗号和换行的数据能正确导出（修改过）\n {5}\$ node test\/escape2\.test\.mjs/)
    assert.match(text, /4\. 空数据导出为空文件（新增）/)
  })

  it('lists a removed check with its last result', async () => {
    const repo = await confirmedAndPassed()
    repo.write('done-check.yaml', YAML.replace(/ {2}- id: escape-tests[\s\S]*?(?= {2}- id: zh)/, ''))
    const text = renderSummary(await view(repo.env))
    assert.match(text, /已删除的检查\n {2}含逗号和换行的数据能正确导出（上次通过）/)
  })
})

describe('scenario B: everything passed', () => {
  it('says so, once, with the boundary sentence', async () => {
    const repo = await confirmedAndPassed()
    const text = renderSummary(await view(repo.env))
    assert.equal(text, [
      '✅ CSV 导出的 3 项检查全部通过',
      '',
      '✅ 导出内容与所选数据一致',
      '✅ 含逗号和换行的数据能正确导出',
      '✅ 中文文件名可以正常下载（你已确认）',
      '',
      '这表示约定的检查都通过了，不代表需求里的每一点都被检查到。',
    ].join('\n'))
    assertPlain(text)
    assert.equal(verdictOf(await view(repo.env)).nextStep, null)
  })
})

describe('scenario C: code changed after a pass', () => {
  it('says the code moved on, not that time ran out', async () => {
    const repo = await confirmedAndPassed()
    repo.write('src/export.mjs', 'changed\n')
    const text = renderSummary(await view(repo.env))
    assert.equal(text, [
      '🔄 代码已更新，3 项需要重新检查',
      '',
      '上次通过的结果对应修改前的代码。',
      '2 项可以自动重验，1 项需要你手动复核。',
      '',
      '下一步：输入 /done-check 重新检查（变化的文件见 /done-check 详情）',
    ].join('\n'))
    assertPlain(text)
  })
})

describe('scenario D: a check found a problem', () => {
  it('quotes the test report and names one next step', async () => {
    const repo = await confirmedAndPassed()
    repo.write('src/export.mjs', 'changed\n')
    await runChecks(repo.env, FAILING, { signal: signal() })
    const text = renderSummary(await view(repo.env))
    assert.equal(text, [
      '❌ CSV 导出还有 1 项检查未通过',
      '',
      '❌ 导出内容与所选数据一致',
      '   测试报告：toCsv mismatch',
      '✅ 含逗号和换行的数据能正确导出',
      '👤 中文文件名可以正常下载',
      '   怎么验证：在浏览器里导出一个名为“报表”的文件，确认文件名没有乱码',
      '   需要你重新确认（代码改过）',
      '',
      '下一步：让 Agent 排查失败的检查，修复后输入 /done-check 重新验证。',
      '详情：/done-check 详情',
    ].join('\n'))
    assertPlain(text)
  })

  it('says so when the test printed nothing useful', async () => {
    const repo = newRepo()
    await confirm(repo.env)
    await runChecks(repo.env, fakeExec({ 'node test/export.test.mjs': { exitCode: 1, stdout: '', stderr: '' } }), { signal: signal() })
    assert.match(renderSummary(await view(repo.env)), /❌ 导出内容与所选数据一致\n {3}测试未给出错误信息，见运行详情/)
  })

  it('run details: command, exit code, the quoted error, the next step', async () => {
    const repo = newRepo()
    await confirm(repo.env)
    await runChecks(repo.env, FAILING, { signal: signal() })
    const v = await view(repo.env)
    const only = problemItems(v).filter((p) => p.shown === 'failed')
    assert.equal(only.length, 1, 'one failing check, so no id has to be typed')
    const text = renderDetails(v, only, 'run').replace(/\d\d:\d\d/, 'HH:MM').replace(/用时 [\d.]+ 秒|用时不到 0\.1 秒/, '用时 T')
    assert.equal(text, [
      '❌ 导出内容与所选数据一致（export-tests）',
      '',
      '测试报告的错误',
      '   toCsv mismatch',
      '',
      '运行详情',
      '   命令    node test/export.test.mjs',
      '   结果    退出码 1，用时 T，HH:MM',
      '   代码    与检查时一致',
      '   stderr（末尾）',
      '      toCsv mismatch',
      '   stdout（末尾）',
      '      ok',
      '',
      '下一步：让 Agent 排查失败的检查，修复后输入 /done-check 重新验证。',
      '技术详情（执行器、指纹、日志）：/done-check 技术详情',
    ].join(String.fromCharCode(10)))
  })

  it('tech details add executor, full fingerprint, definition hash and log path', async () => {
    const repo = newRepo()
    await confirm(repo.env)
    await runChecks(repo.env, FAILING, { signal: signal() })
    const v = await view(repo.env)
    const text = renderDetails(v, [itemsOf(v)[0]!], 'tech')
    assert.match(text, /技术详情\n {3}执行器 {4}fake\n {3}指纹 {6}[0-9a-f]{64}（覆盖 \d+ 个文件）\n {3}定义哈希 {2}[0-9a-f]{64}/)
    assert.match(text, /完整日志 {2}.+\.log/)
  })
})

describe('scenario E: a check could not run', () => {
  it('is not worded like a failure and not like a pass', async () => {
    const repo = await confirmedAndPassed()
    repo.write('src/export.mjs', 'changed\n')
    const denied = async (req: { command: string }) => {
      if (req.command.includes('escape')) throw new NotExecutedError('pwsh 工具未能执行：policy: no', 'denied', 'policy: no')
      return outcome()
    }
    const run = await runChecks(repo.env, denied, { signal: signal() })
    const text = renderSummary(await view(repo.env), { notRun: notRunReasons(run) })
    assert.equal(text, [
      '⚠️ 1 项检查没能运行，结果未知',
      '',
      '✅ 导出内容与所选数据一致',
      '⚠️ 含逗号和换行的数据能正确导出',
      '   原因：命令被权限设置拒绝，没有执行',
      '   这不是检查失败，也不表示功能测过了。',
      '👤 中文文件名可以正常下载',
      '   怎么验证：在浏览器里导出一个名为“报表”的文件，确认文件名没有乱码',
      '   需要你重新确认（代码改过）',
      '',
      '下一步：放宽这条命令的权限后，输入 /done-check 重试',
      '详情：/done-check 详情',
    ].join('\n'))
    assertPlain(text)
  })

  it('a timeout is "could not finish", never "failed"', async () => {
    const repo = newRepo()
    await confirm(repo.env)
    await runChecks(repo.env, fakeExec({ 'node test/export.test.mjs': { exitCode: null, timedOut: true } }), { signal: signal() })
    const text = renderSummary(await view(repo.env))
    assert.match(text.split('\n')[0]!, /^⚠️ 1 项检查没能运行，结果未知$/)
    assert.match(text, /没能跑完：超时。这不是检查失败，结果未知。/)
  })
})

describe('priority and single next step', () => {
  it('confirmation outranks problems, problems outrank re-checking', async () => {
    const repo = await confirmedAndPassed()
    repo.write('src/export.mjs', 'changed\n')
    await runChecks(repo.env, FAILING, { signal: signal() })
    assert.equal(verdictOf(await view(repo.env)).tier, 'failed')
    repo.write('done-check.yaml', `${YAML}  - id: more\n    name: 多一项\n    run: node test/m.mjs\n`)
    assert.equal(verdictOf(await view(repo.env)).tier, 'confirm')
  })

  it('manual checks wait for the user, with numbers only when there are several', async () => {
    const repo = newRepo()
    repo.write('done-check.yaml', `${YAML}  - id: second\n    name: 第二个人工项\n    manual: true\n`)
    await confirm(repo.env)
    await runChecks(repo.env, fakeExec(), { signal: signal() })
    const text = renderSummary(await view(repo.env))
    assert.match(text.split('\n')[0]!, /^👤 CSV 导出：2 项已通过，2 项等你确认$/)
    assert.match(text, /👤 3\. 中文文件名可以正常下载\n {3}怎么验证：.+\n {3}等你确认/)
    assert.match(text, /👤 4\. 第二个人工项/)
    assert.match(text, /下一步：亲自验证后输入 \/done-check ok <序号>/)
  })

  it('`全部` lists every check, passing ones included, with their numbers', async () => {
    const repo = await confirmedAndPassed()
    const text = renderAll(await view(repo.env), 'run')
    assert.match(text, /1\. ✅ 导出内容与所选数据一致（export-tests）/)
    assert.match(text, /3\. ✅ 中文文件名可以正常下载（zh-filename）/)
  })
})

describe('preview digest', () => {
  it('changes with any definition, including a manual check\'s how', async () => {
    const repo = newRepo()
    const before = previewDigest((await view(repo.env)).checklist)
    repo.write('done-check.yaml', YAML.replace('确认文件名没有乱码', '确认文件名正确'))
    assert.notEqual(previewDigest((await view(repo.env)).checklist), before)
  })
})

describe('why a command did not run (real-host findings)', () => {
  const sandboxFail = async () => { throw new NotExecutedError('pwsh 工具未能执行：SetNamedSecurityInfoW failed: Win32 error 5', 'sandbox', 'SetNamedSecurityInfoW failed: Win32 error 5') }

  it('names the real cause: a sandbox failure is not "denied by permission settings"', async () => {
    const repo = newRepo()
    await confirm(repo.env)
    const run = await runChecks(repo.env, sandboxFail, { signal: signal() })
    const text = renderSummary(await view(repo.env), { notRun: notRunReasons(run) })
    assert.match(text, /原因：沙箱运行失败，命令没有执行/)
    assert.doesNotMatch(text, /权限设置拒绝/)
    assert.match(text, /下一步：处理沙箱问题/)
  })

  it('the reason survives to the next command, and is not evidence', async () => {
    const repo = newRepo()
    await confirm(repo.env)
    await runChecks(repo.env, sandboxFail, { signal: signal() })
    const v = await view(repo.env)
    const item = itemsOf(v)[0]!
    assert.equal(item.shown, 'cannot_run', 'a later command still says it could not run')
    assert.equal(item.status.state, 'not_run', 'the derived status is untouched: no result was ever recorded')
    assert.match(renderDetails(v, [item], 'run'), /没能运行：沙箱运行失败/)
    assert.equal((await repo.env.store.load(repo.root)).ok && Object.keys((await repo.env.store.load(repo.root) as any).state.latest).length, 0, 'no run record')
  })

  it('goes away after the next completed run, and does not outlive a changed definition', async () => {
    const repo = newRepo()
    await confirm(repo.env)
    await runChecks(repo.env, sandboxFail, { signal: signal() })
    await runChecks(repo.env, fakeExec(), { signal: signal() })
    assert.notEqual(itemsOf(await view(repo.env))[0]!.shown, 'cannot_run')

    const other = newRepo()
    await confirm(other.env)
    await runChecks(other.env, sandboxFail, { signal: signal() })
    other.write('done-check.yaml', YAML.replace('node test/export.test.mjs', 'node test/other.mjs'))
    assert.equal((await view(other.env)).notExecuted['export-tests'], undefined)
  })

  it('classifies the shell tool\'s refusals by what they say', async () => {
    const { classifyRefusal } = await import('../src/plugin/shell.ts')
    assert.equal(classifyRefusal('policy: no writes'), 'denied')
    assert.equal(classifyRefusal('user rejected the approval'), 'denied')
    assert.equal(classifyRefusal('SetNamedSecurityInfoW returned Win32 error 5'), 'sandbox')
    assert.equal(classifyRefusal('something unexpected'), 'other')
  })

  it('tech details carry the raw tool message so a sandbox failure can be troubleshot', async () => {
    const repo = newRepo()
    await confirm(repo.env)
    await runChecks(repo.env, sandboxFail, { signal: signal() })
    const v = await view(repo.env)
    const item = itemsOf(v)[0]!
    assert.doesNotMatch(renderDetails(v, [item], 'run'), /SetNamedSecurityInfoW/, 'the default and run layers stay plain')
    assert.match(renderDetails(v, [item], 'tech'), /工具原始信息 {2}SetNamedSecurityInfoW failed: Win32 error 5[\s\S]*原因类别 {6}sandbox/)
    const tech = renderDetails(v, [item], 'tech').split('\n')
    const heading = tech.findIndex((l) => l === '   技术详情')
    assert.ok(heading > 0, 'the subheading is indented like the item body')
    assert.ok(tech.findIndex((l) => l.includes('没能运行：')) < heading, 'the item\'s own lines come before its technical block')
    assert.match(tech[heading + 1]!, /^ {6}工具原始信息/)
  })

  it('shows an unrecognized reason as it is, instead of calling it a permission denial', async () => {
    const repo = newRepo()
    await confirm(repo.env)
    const run = await runChecks(repo.env, async () => { throw new NotExecutedError('x', 'other', 'tool exploded') }, { signal: signal() })
    assert.match(renderSummary(await view(repo.env), { notRun: notRunReasons(run) }), /原因：命令没有执行：tool exploded/)
  })
})

describe('real-host copy findings', () => {
  it('a run of an earlier definition is not shown as this check\'s run', async () => {
    const repo = await confirmedAndPassed()
    repo.write('done-check.yaml', YAML.replace('node test/export.test.mjs', 'node test/export2.test.mjs'))
    await confirm(repo.env)
    const v = await view(repo.env)
    const item = itemsOf(v)[0]!
    assert.equal(item.shown, 'not_checked')
    const text = renderDetails(v, [item], 'run')
    assert.match(text, /属于旧定义，不代表当前清单/)
    assert.doesNotMatch(text, /node test\/export\.test\.mjs|退出码/)
  })

  it('when only a manual check is stale, there is nothing to "re-check"', async () => {
    const repo = await confirmedAndPassed()
    repo.write('src/export.mjs', 'changed\n')
    repo.write('done-check.yaml', YAML.replaceAll('watch: ["src/**", "test/**"]', 'watch: ["test/**"]'))
    await confirm(repo.env)
    const text = renderSummary(await view(repo.env))
    assert.match(text, /下一步：输入 \/done-check 开始检查$/m)
  })

  it('checks that never ran are started, not "re-checked"', async () => {
    const repo = newRepo()
    await confirm(repo.env)
    const text = renderSummary(await view(repo.env))
    assert.match(text, /下一步：输入 \/done-check 开始检查$/m)
    assert.doesNotMatch(text, /变化的文件/)
  })

  it('names a deleted check, falling back to its id only for confirmations without names', async () => {
    const repo = await confirmedAndPassed()
    const v = await view(repo.env)
    assert.equal(v.confirmedNames['escape-tests'], '含逗号和换行的数据能正确导出')
  })

  it('says it was confirmed, with what is left; and counts what already passed', async () => {
    const repo = newRepo()
    await confirm(repo.env)
    assert.equal(confirmedHeadline(await view(repo.env)), '已确认 CSV 导出的 3 项检查，2 项待执行，1 项等你确认')
    await runChecks(repo.env, fakeExec(), { signal: signal() })
    assert.equal(verdictOf(await view(repo.env)).headline, '👤 CSV 导出：2 项已通过，1 项等你确认')
  })

  it('the preview\'s next step has no parenthetical about changes already shown', async () => {
    const repo = await confirmedAndPassed()
    repo.write('done-check.yaml', YAML.replace('node test/export.test.mjs', 'node test/export2.test.mjs'))
    assert.match(renderSummary(await view(repo.env)), /下一步：确认无误后输入 \/done-check 确认$/)
  })

  it('hides PowerShell startup noise from the output tails', async () => {
    const repo = newRepo()
    await confirm(repo.env)
    const noisy = 'CannotCreateTypeConstrainedLanguage\n�� garbled\ntoCsv mismatch\n'
    await runChecks(repo.env, fakeExec({ 'node test/export.test.mjs': { exitCode: 1, stderr: noisy } }), { signal: signal() })
    const v = await view(repo.env)
    const text = renderDetails(v, [itemsOf(v)[0]!], 'run')
    assert.match(text, /toCsv mismatch/)
    assert.doesNotMatch(text, /ConstrainedLanguage|�/)
  })
})
