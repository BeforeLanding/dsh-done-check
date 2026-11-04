# dsh-done-check

English | [中文](README.zh-CN.md)

Executable acceptance checklists for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) coding tasks: every "done" is backed by a check that actually ran, and old results are flagged for re-check when the code changes.

> **What it can and cannot tell you**
>
> - A summary such as "3 checks: 2 passed, 1 awaiting manual confirmation" covers **only the agreed checks**. It does not mean the requirement is fully implemented. The plugin never shows a percentage or a "completion" score.
> - It guards against an agent casually rewriting the verdict: claiming tests passed, quietly changing a check command, deleting a failing check, or forging a confirmation. It does not stop a malicious agent with an unrestricted shell, which can edit the tests themselves or the files under DSH home.
> - Confirming a checklist does not authorize running its commands. Checks run on the shell executor of the current DSH composition; `bash-local` / `pwsh-local` provide no isolation, so compose the matching sandbox executor if you need it.
> - `watch` is a scope you declare, not a dependency graph inferred for you.

## Status

In development (v0.1 not released). The core is done and covered by tests: checklist parsing, definition and structure hashes, the workspace fingerprint, state derivation (including unstable runs and "cannot determine"), and the evidence store (per-run records, log cap, cross-process locking). The DSH plugin layer (tools, commands, and authorization for both execution entry points) is not done yet. Design: [docs/DESIGN.md](docs/DESIGN.md) (in Chinese). Status messages are currently in Chinese only.

## How it works

1. Write `done-check.yaml` at the project root (or let the agent draft it):

   ```yaml
   version: 1
   task: Add CSV export
   checks:
     - id: export-tests
       name: Export tests pass
       run: pnpm test -- export
       watch: ["src/**", "test/**"]
     - id: typecheck
       name: TypeScript type check passes
       run: pnpm tsc --noEmit
     - id: zh-filename
       name: Downloads with Chinese file names work
       manual: true
   ```

2. You confirm the checklist with `/done-check confirm`. Confirmations and manual verdicts can only come from you through commands; the agent cannot make them.
3. Checks really run through the DSH shell executor. The exit code, output, duration, and the workspace fingerprint at that moment are recorded.
4. When the workspace content changes (uncommitted edits included), results bound to the old content show as stale, with the changed files listed. If one check is edited, that check shows as "definition changed". If checks are added or removed, or the task description changes, the whole checklist shows as "structure changed, needs confirmation".
5. A result whose workspace or definition changed while it was running is marked "unstable, re-run required". Restoring the files does not bring it back.

## Development

```bash
pnpm install
pnpm test
```

Requires Node.js ≥ 22.19 and git.

## License

MIT
