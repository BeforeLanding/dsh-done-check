import { appendFileSync, copyFileSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const directory = fileURLToPath(new URL('.', import.meta.url))
const files = ['README.md', 'csv.mjs', 'test.mjs', 'done-check.yaml', 'demo.mjs']
const broken = '  return String(value) // DEMO: intentionally unescaped'
const fixed = '  const text = String(value)\n  return /[",\\r\\n]/.test(text) ? `"${text.replaceAll(\'"\', \'""\')}"` : text'
const command = process.argv[2]

function git(args, cwd) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' })
  if (result.error || result.status !== 0) {
    throw new Error(result.error?.message ?? result.stderr.trim())
  }
  return result.stdout.trim()
}

function requireDemoRoot() {
  const root = git(['rev-parse', '--show-toplevel'], directory)
  const canonical = (path) => {
    const value = realpathSync(resolve(path))
    return process.platform === 'win32' ? value.toLowerCase() : value
  }
  if (canonical(root) !== canonical(directory) || canonical(process.cwd()) !== canonical(directory)) {
    throw new Error('Run setup first, then cd into the printed standalone demo directory. The parent repository is not a demo workspace.')
  }
}

try {
  if (command === 'setup') {
    const destination = mkdtempSync(join(tmpdir(), 'done-check-csv-'))
    for (const file of files) copyFileSync(join(directory, file), join(destination, file))
    // The exported file must not invalidate checks merely by being generated.
    writeFileSync(join(destination, '.gitignore'), 'export.csv\n')
    git(['init', '--quiet'], destination)
    console.log(`Created a standalone git demo (no install or commit needed):\n${destination}\n\ncd "${destination}"\ndsh web`)
  } else if (['fix', 'export', 'stale'].includes(command)) {
    requireDemoRoot()
    const source = join(directory, 'csv.mjs')
    if (command === 'fix') {
      const content = readFileSync(source, 'utf8')
      if (content.includes(broken)) writeFileSync(source, content.replace(broken, fixed))
      else if (!content.includes(fixed)) throw new Error('csv.mjs has your own changes; fix it yourself or create a fresh demo with setup.')
      console.log('Applied CSV quoting fix. In DSH, send /done-check to run the changed checks.')
    } else if (command === 'stale') {
      appendFileSync(source, '\n// Demo: a harmless code edit after verification.\n')
      console.log('Changed csv.mjs without changing its behaviour. In DSH, send /done-check status to inspect stale results before re-running.')
    } else {
      const { toCsv } = await import('./csv.mjs')
      const rows = [
        { id: 1, name: '张三', note: '包含逗号, 和"引号"\n下一行' },
        { id: 2, name: '未选择', note: '不应导出' },
        { id: 3, name: '李四', note: '普通备注' },
      ]
      writeFileSync(join(directory, 'export.csv'), '\uFEFF' + toCsv(rows, [1, 3]))
      console.log(`Exported ${join(directory, 'export.csv')} (UTF-8 with BOM). Open it in your spreadsheet application and follow the manual check.`)
    }
  } else {
    throw new Error('Usage: node demo.mjs setup|fix|export|stale')
  }
} catch (error) {
  console.error(error.message)
  process.exitCode = 1
}
