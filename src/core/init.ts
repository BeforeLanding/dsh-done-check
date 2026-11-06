import { lstat, readFile, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { CHECKLIST_FILE, parseChecklist } from './checklist.ts'
import yaml from 'js-yaml'

/** Create a draft only. Never replace a checklist, confirm it, or execute scripts. */
export async function initializeChecklist(root: string, language: 'en' | 'zh'): Promise<boolean> {
  try {
    await lstat(join(root, CHECKLIST_FILE))
    return false
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  let pkg: Record<string, unknown> = {}
  try {
    pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
    if (!pkg || typeof pkg !== 'object' || Array.isArray(pkg)) throw new Error('Invalid package.json object')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  const manager = typeof pkg.packageManager === 'string' ? pkg.packageManager.split('@')[0] : 'npm'
  const runner = ['npm', 'pnpm', 'yarn', 'bun'].includes(manager ?? '') ? manager : 'npm'
  const scripts = pkg.scripts && typeof pkg.scripts === 'object' ? pkg.scripts as Record<string, unknown> : {}
  const checks: Record<string, unknown>[] = []
  for (const script of ['test', 'typecheck', 'lint']) {
    if (typeof scripts[script] !== 'string' || !(scripts[script] as string).trim() || (scripts[script] as string).includes('no test specified')) continue
    checks.push({ id: script, name: language === 'en' ? `Project ${script} script passes` : `项目 ${script} 脚本通过`, run: `${runner} run ${script}` })
  }
  checks.push({ id: 'manual-review', name: language === 'en' ? 'Task output meets the agreed acceptance criteria' : '任务产出符合约定的验收要求', manual: true,
    how: language === 'en' ? 'Replace this instruction with concrete steps and expected results for your task before confirming.' : '确认前，请把这段说明替换为当前任务的具体操作步骤和预期结果。' })
  const text = yaml.dump({ version: 1, task: basename(root), checks }, { lineWidth: 120 })
  const parsed = parseChecklist(text)
  if (!parsed.ok) throw new Error(parsed.errors.join('\n'))
  try {
    await writeFile(join(root, CHECKLIST_FILE), text, { encoding: 'utf8', flag: 'wx' })
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') return false
    throw error
  }
}
