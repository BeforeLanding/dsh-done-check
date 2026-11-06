# User guide

[← README](../README.md) · [简体中文](USAGE.zh-CN.md)

`dsh-done-check` runs agreed acceptance checks through DeepSeek Harness and records what actually happened. Only the human user can confirm the checklist and decide manual items.

## Install

Requires DSH `>=0.1.5-rc.1 <0.3.0`, Node.js `>=22.19`, and git. Open a DSH session in a git project; the checklist belongs at its git root.

```bash
dsh plugin --profile web add dsh-done-check
```

Replace `web` with your active profile. For a local checkout:

```bash
pnpm install
pnpm build
dsh plugin --profile <your-profile> add /absolute/path/to/dsh-done-check
```

Plugin output is currently Chinese. All primary subcommands also have English aliases.

## Write a checklist

Ask the agent to draft `done-check.yaml`, or write it yourself. The following CSV example illustrates the recorded demo; replace commands and paths with real tests in your project.

```yaml
version: 1
task: CSV export
checks:
  - id: export-tests
    name: Exported rows match the selected data
    run: node test/export.test.mjs
    watch: ["src/**", "test/**"]
  - id: escape-tests
    name: Values with commas and newlines are escaped correctly
    run: node test/escape.test.mjs
    timeout: 120
    watch: ["src/**", "test/**"]
  - id: zh-filename
    name: A Chinese filename downloads correctly
    manual: true
    how: Export a file named 报表 in the browser and check that its filename is intact
```

Each item needs a unique `id` (1–64 lowercase letters, digits or hyphens, starting with a letter or digit), a behaviour-oriented `name`, and either a `run` command or `manual: true`. Give manual items a `how` that a person can follow. General tests and typechecks are useful baseline checks; they do not prove a specific feature works just because the item's name says so.

Automatic items may set `timeout` (integer seconds, default 300, maximum 1800) and `cwd` (a directory relative to the git root, default `.`). `watch` globs are relative to the git root, not `cwd`.

## Preview, confirm, run

Send each command as a separate chat message:

1. `/done-check` previews the checklist and every command; nothing runs.
2. `/done-check confirm` confirms the exact list from that preview. If it changed, preview again.
3. `/done-check` runs confirmed automatic checks that have not run or whose results are stale, then shows the verdict.

For a failure, read `/done-check details [n]`, fix the underlying problem and check again. An unchanged failed result is not automatically re-run by the bare command; `/done-check run` forces all confirmed automatic checks to run again.

For a manual item, follow `how` and record `/done-check ok [n]` or `/done-check no [n] [note]`. Omit `n` only when exactly one manual item is waiting. `n` is the item's position in the checklist; its internal ID also works.

## Watch the right files

Without `watch`, the fingerprint contains tracked files and non-ignored untracked files, excluding `done-check.yaml` itself. Uncommitted edits count; committing alone does not change a fingerprint. A tracked file remains included even if a gitignore rule matches its name.

With `watch`, only matching files from that same set are fingerprinted. Include relevant configuration, dependency manifests and lockfiles as well as source and tests. An explicit scope matching no files is rejected. `watch` is a scope you declare, not an inferred dependency graph.

When the current fingerprint differs from the recorded one, the result needs a re-check. An ordinary stale result can become current again if the exact file contents are restored; this is different from a run marked unstable, described below.

## Command reference

- `/done-check` — preview, run checks that are due, or show the verdict.
- `/done-check confirm` (`确认`) — **human only**: confirm the latest preview.
- `/done-check ok [n]` / `/done-check no [n] [note]` — **human only**: record a manual verdict.
- `/done-check status` (`状态`) — read status without running anything.
- `/done-check details [n]` (`详情`) — command, exit code, time, output tail and changed files.
- `/done-check all` (`全部`) — all items, including passing ones.
- `/done-check tech [n]` (`技术详情`) — executor and sandbox, full fingerprint, definition hash and log path.
- `/done-check run` (`重新检查`) — force-run all confirmed automatic checks.
- `/done-check help` (`帮助`) — command help.

`show`, `pass` and `fail` remain compatibility aliases for one more version in v0.2.0.

Agent tools:

- `done_check_draft` validates draft YAML and returns normalized content; the agent saves it using its file tool.
- `done_check_run` executes confirmed automatic checks and records evidence.
- `done_check_status` reads the current verdict and next step.

None can confirm a checklist or decide a manual item.

## Trust and limits

**What a pass proves.** Only the agreed checks passed. This does not prove that every requirement was implemented. There is no completion percentage. Failed tests quote up to three lines of their own report; the plugin does not infer a diagnosis from the excerpt. A command that could not run is not a pass or a failure.

**Confirmation and execution are separate.** Confirmation binds you to the last preview's exact content. It does not bypass execution permissions. Every command goes through the registered DSH `pwsh`/`bash` tool. Refused commands produce no evidence. `bash-local` and `pwsh-local` provide no isolation; compose the matching sandbox executor when isolation is needed.

**Definitions cannot quietly change.** Editing a check requires confirming it again. Adding or deleting checks, or rewording the task, requires confirming the whole list again. The agent cannot record that confirmation or your manual verdict through its tools.

**Unstable runs stay untrustworthy.** If the relevant file fingerprint or check definition differs between the start and end of a run, that run is marked unstable. Restoring files later does not revive it. Changes made and fully reverted between those snapshots cannot be detected.

**The shell remains a trust boundary.** This guards against casual changes to checks or verdicts. A malicious agent with an unrestricted shell can edit tests or DSH home; the plugin cannot prevent that.

## Development

```bash
pnpm install
pnpm typecheck
pnpm build
pnpm test
```

See [DESIGN.md](DESIGN.md), the [changelog](../CHANGELOG.md) and [media build guide](video/README.md).
