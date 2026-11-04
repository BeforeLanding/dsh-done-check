import { confirm, decide, runChecks } from '../src/service.ts'
import { fakeExec, makeRepo, signal } from './helpers.ts'

export const CHECKLIST = `
version: 1
task: 新增 CSV 导出功能
checks:
  - id: export-tests
    name: 导出相关测试通过
    run: node --test
    watch: ["src/**", "test/**"]
  - id: typecheck
    name: 类型检查通过
    run: tsc --noEmit
  - id: zh-filename
    name: 中文文件名下载正常
    manual: true
    watch: ["src/**"]
`

export const FILES = {
  '.gitignore': 'coverage/\n*.log\n',
  'src/export.ts': 'export const csv = 1\n',
  'test/export.test.ts': 'test\n',
  'README.md': '# demo\n',
  'package.json': '{}\n',
}

/** A repo where all three checks have just passed. */
export async function passedRepo(checklist = CHECKLIST) {
  const repo = makeRepo(FILES)
  repo.write('done-check.yaml', checklist)
  await confirm(repo.env)
  await runChecks(repo.env, fakeExec(), { signal: signal() })
  await decide(repo.env, 'zh-filename', 'passed', '手动下载了“报表.csv”')
  return repo
}

