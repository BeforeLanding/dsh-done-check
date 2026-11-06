import assert from 'node:assert/strict'
import { after, it } from 'node:test'
import { renderEnglish } from '../src/plugin/english.ts'
import { view, runChecks } from '../src/service.ts'
import { passedRepo } from './fixtures.ts'
import { cleanupAll, fakeExec, signal } from './helpers.ts'

after(cleanupAll)

it('localizes presentation while preserving task names and the original failure report', async () => {
  const repo = await passedRepo()
  await runChecks(repo.env, fakeExec({ 'node --test': { exitCode: 1, stderr: '原始测试报告：CSV 转义失败\n' } }), { ids: ['export-tests'], signal: signal() })
  const text = renderEnglish(await view(repo.env), undefined, { detail: 'tech' })
  assert.match(text, /check\(s\) failed/)
  assert.match(text, /原始测试报告：CSV 转义失败/)
  assert.match(text, /导出相关测试通过/)
  assert.match(text, /Exit code: 1/)
  assert.match(text, /Fingerprint:/)
  assert.match(text, /Next:/)
})
