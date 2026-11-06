import { execFile } from 'node:child_process'
import { lstat, readlink } from 'node:fs/promises'
import { createReadStream } from 'node:fs'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { promisify } from 'node:util'
import picomatch from 'picomatch'
import { CHECKLIST_FILE } from './checklist.ts'
import { sha256 } from './hash.ts'

const execFileAsync = promisify(execFile)

/** Content hash of every relevant workspace file, keyed by POSIX path relative to the root. */
export type WorkspaceSnapshot = ReadonlyMap<string, string>

export interface Fingerprint {
  readonly digest: string
  readonly files: Readonly<Record<string, string>>
}

export type ListFiles = (root: string) => Promise<readonly string[]>

/**
 * Tracked files plus untracked files that are not ignored, as git sees the
 * working tree — not HEAD, so uncommitted edits count.
 */
export const gitListFiles: ListFiles = async (root) => {
  try {
    const { stdout } = await execFileAsync(
      'git',
      ['-c', 'core.quotepath=false', 'ls-files', '-z', '--cached', '--others', '--exclude-standard', '--deduplicate'],
      { cwd: root, maxBuffer: 256 * 1024 * 1024 },
    )
    return stdout.split('\0').filter(Boolean)
  } catch (err) {
    throw new Error(`无法列出工作区文件（v0.1 要求项目是 git 仓库）：${(err as Error).message}`)
  }
}

export async function snapshotWorkspace(root: string, listFiles: ListFiles = gitListFiles, watches?: readonly (readonly string[])[]): Promise<WorkspaceSnapshot> {
  const wholeWorkspace = watches === undefined || watches.some((scope) => scope.length === 0)
  const match = wholeWorkspace ? () => true : picomatch(watches.flatMap((scope) => [...scope]), { dot: true })
  const paths = (await listFiles(root))
    .map((p) => p.replaceAll('\\', '/'))
    .filter((p) => p !== CHECKLIST_FILE && match(p))
  const present: [string, string][] = []
  let next = 0
  // Bound open files and stream their content instead of buffering entire files.
  await Promise.all(Array.from({ length: Math.min(8, paths.length) }, async () => {
    for (;;) {
      const path = paths[next++]
      if (path === undefined) return
      const digest = await hashFile(join(root, path))
      if (digest !== null) present.push([path, digest])
    }
  }))
  return new Map(present.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
}

/**
 * Only files that exist are encoded. A tracked file deleted from the working
 * tree is simply absent — exactly as it is after the deletion is committed —
 * so committing never changes the fingerprint. Directories (e.g. submodule
 * gitlinks) are skipped. Any other read error propagates: the caller must
 * report "cannot determine", never a fingerprint built from partial data.
 */
async function hashFile(abs: string): Promise<string | null> {
  try {
    const st = await lstat(abs)
    if (st.isSymbolicLink()) return sha256(`symlink:${await readlink(abs)}`)
    if (!st.isFile()) return null
    const digest = createHash('sha256')
    for await (const chunk of createReadStream(abs)) digest.update(chunk)
    return digest.digest('hex')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw err
  }
}

/** Restrict a snapshot to a check's watch patterns (empty = everything) and digest it. */
export function fingerprintFor(snapshot: WorkspaceSnapshot, watch: readonly string[]): Fingerprint {
  const match = watch.length ? picomatch([...watch], { dot: true }) : () => true
  const files: Record<string, string> = {}
  let canonical = ''
  for (const [path, hash] of snapshot) {
    if (!match(path)) continue
    files[path] = hash
    canonical += `${path}\0${hash}\n`
  }
  return { digest: sha256(canonical), files }
}

export interface FileChanges {
  readonly modified: readonly string[]
  readonly added: readonly string[]
  readonly removed: readonly string[]
}

/** What differs between the files a result was bound to and the current ones. */
export function diffFingerprints(before: Readonly<Record<string, string>>, after: Readonly<Record<string, string>>): FileChanges {
  const modified: string[] = []
  const added: string[] = []
  const removed: string[] = []
  for (const [path, hash] of Object.entries(after)) {
    const old = before[path]
    if (old === undefined) added.push(path)
    else if (old !== hash) modified.push(path)
  }
  for (const path of Object.keys(before)) {
    if (!(path in after)) removed.push(path)
  }
  return { modified: modified.sort(), added: added.sort(), removed: removed.sort() }
}

export function hasChanges(c: FileChanges): boolean {
  return c.modified.length + c.added.length + c.removed.length > 0
}

/**
 * An explicit `watch` that matches nothing would yield a constant empty
 * fingerprint — a result that could never go stale. Refuse it at confirm and
 * run time. (A watch that matched files when the result was recorded and
 * matches none now is ordinary staleness: those files were removed.)
 */
export function watchCoverageError(watch: readonly string[], fingerprint: Fingerprint): string | null {
  if (watch.length && Object.keys(fingerprint.files).length === 0) {
    return `watch 没有匹配任何文件：${watch.join(', ')}`
  }
  return null
}
