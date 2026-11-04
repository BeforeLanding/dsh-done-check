import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import type { Report } from '../src/core/status.ts'
import type { Exec, ExecOutcome, ServiceEnv } from '../src/service.ts'
import { StateStore } from '../src/store/state.ts'

export interface TempRepo {
  readonly root: string
  readonly home: string
  readonly env: ServiceEnv
  write(path: string, content: string): void
  remove(path: string): void
  move(from: string, to: string): void
  git(...args: string[]): string
  cleanup(): void
}

const created: TempRepo[] = []

export function cleanupAll(): void {
  for (const r of created.splice(0)) r.cleanup()
}

export function makeRepo(files: Record<string, string> = {}): TempRepo {
  const root = mkdtempSync(join(tmpdir(), 'done-check-'))
  const home = mkdtempSync(join(tmpdir(), 'done-check-home-'))
  const git = (...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8' })
  git('init', '-q')
  git('config', 'user.email', 'test@example.com')
  git('config', 'user.name', 'test')
  git('config', 'core.autocrlf', 'false')
  const write = (path: string, content: string) => {
    const abs = join(root, path)
    mkdirSync(dirname(abs), { recursive: true })
    writeFileSync(abs, content)
  }
  for (const [p, c] of Object.entries(files)) write(p, c)
  if (Object.keys(files).length) {
    git('add', '-A')
    git('commit', '-q', '-m', 'init')
  }
  const repo: TempRepo = {
    root,
    home,
    env: { root, store: new StateStore(home) },
    write,
    remove: (path) => rmSync(join(root, path), { force: true }),
    move: (from, to) => renameSync(join(root, from), join(root, to)),
    git,
    cleanup: () => {
      rmSync(root, { recursive: true, force: true })
      rmSync(home, { recursive: true, force: true })
    },
  }
  created.push(repo)
  return repo
}

export function outcome(partial: Partial<ExecOutcome> = {}): ExecOutcome {
  return { exitCode: 0, signal: null, timedOut: false, aborted: false, infraError: null, stdout: 'ok\n', stderr: '', shell: 'fake', ...partial }
}

/** A fake executor: optionally does something to the workspace while "running". */
export function fakeExec(byCommand: Record<string, Partial<ExecOutcome>> = {}, during?: (command: string) => void | Promise<void>): Exec {
  return async (req) => {
    await during?.(req.command)
    return outcome(byCommand[req.command] ?? {})
  }
}

export const signal = () => new AbortController().signal

export function states(r: Report): Record<string, string> {
  return Object.fromEntries(r.checks.map((c) => [c.checkId, c.state]))
}

export function status(r: Report, id: string) {
  const s = r.checks.find((c) => c.checkId === id)
  if (!s) throw new Error(`no status for ${id}`)
  return s
}
