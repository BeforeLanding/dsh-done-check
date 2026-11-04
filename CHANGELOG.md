# Changelog

## Unreleased

- `/done-check` command output is now plain text laid out per check, instead of a Markdown table. DSH web shows command output as preformatted text, and its font does not give CJK characters an exact double width, so only the ASCII check id is padded. `show` evidence and run summaries are plain text too. Agent tool output stays Markdown.

## 0.1.0 — 2026-11-04

First release.

- `done-check.yaml`: per-task acceptance checklist with automatic (`run`) and manual checks, optional `timeout`, `cwd` and `watch` globs.
- Confirmation is user-only (`/done-check confirm`). It records a hash of each check's definition and of the checklist structure (task + check ids). Edited checks show "definition changed"; added/removed checks or a reworded task show "structure changed".
- Results are bound to a content fingerprint of the git working tree (tracked + untracked-not-ignored files, uncommitted edits included) and go stale when it changes. Reverting restores validity; committing never changes it.
- A run during which the workspace or the definition changed is marked unstable and is never revived by restoring files.
- Evidence lives under DSH home, outside the project: one record per run, 1 MiB log cap, 20 runs kept per check, cross-process lock. Unreadable evidence or workspace reads as "cannot determine", never as passed.
- Agent tools `done_check_draft` (validate only), `done_check_run`, `done_check_status`; user command `/done-check` with `status`, `confirm`, `run`, `pass`, `fail`, `show`.
- Every check command is dispatched to the registered `pwsh`/`bash` tool, so session permission rules and approvals apply. Denied or unavailable means "not executed" with no evidence; there is no fallback to running commands directly.
- Verified on DSH 0.1.5-rc.1 and 0.2.1-rc.5 web hosts. On 0.2+ the session's current working directory is followed.
