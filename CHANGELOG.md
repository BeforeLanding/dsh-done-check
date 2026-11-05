# Changelog

## 0.2.0 — 2026-11-04

Redesigns the user-facing layer only. The verification rules are unchanged (user-only confirmation and manual verdicts, definition/structure hashes, content fingerprint, unstable runs never revived, shell dispatch through the permission pipeline), and every 0.1 test still passes unmodified. Existing confirmations and evidence stay valid; nothing to migrate.

- Output answers three questions — what was checked, what is still wrong, what to do now — and its first line is always a complete conclusion (DSH uses it as the collapsed row title). Status symbols lead lines only. The default layer shows no internal ids, hashes, paths or millisecond timings.
- "Found a problem" (`❌`) and "could not run" (`⚠️`: permission denied, timeout, executor error) are worded differently; the latter says it is neither a failure nor a pass. "Stale" is now "code changed, needs re-checking" (internal state names are unchanged).
- A failed check quotes up to three lines of the test's own output as "测试报告" (ANSI codes and known runtime warnings removed). The excerpt is display data stored on the run record (`failureExcerpt`, optional); the full output is still kept.
- `/done-check` is now one command that does the next due thing: preview an unconfirmed or changed checklist (with the commands it will run, executing nothing), run checks that were never run or whose code changed, or show the summary. `/done-check 确认` only confirms the checklist from the most recent preview.
- `ok [n]` / `no [n] [note]` record manual verdicts; with a single manual check waiting no number is needed. `详情`, `全部`, `技术详情` expose the run and technical layers. Numbers are the position in the checklist; ids still work. English spellings are equivalent. `show`, `pass`, `fail` remain as aliases for one more version.
- Manual checks take an optional `how` (how to verify), shown in the preview and while waiting; it is part of the definition hash. Checks without it hash exactly as before.
- Agent tools: `done_check_status` / `done_check_run` return `verdict` and `nextStep`; `done_check_draft` carries drafting rules (name checks by user-judgeable behaviour, no check without a real verification behind it) and returns non-blocking warnings for generic names such as "测试通过".
- Real-host fixes: a command that never started is now classified by its real cause (permission denial, sandbox failure, no shell tool, otherwise the tool's own message) instead of always reading "denied by permission settings". The attempt is remembered per check (display only, never evidence; cleared by the next completed run or a definition change), so `详情` and later `/done-check` keep saying ⚠️ with the reason. Details no longer show a run of an earlier definition as the current check's run. Checks that never ran get "输入 /done-check 开始检查", not "重新检查". Deleted checks are listed by name (names are stored with the confirmation, display only). The first line after confirming says it was confirmed and what is left; waiting-for-you headlines count what already passed; a manual check that needs re-confirming shows its `how`. PowerShell startup noise is hidden from output tails.
- Verified on real DSH web hosts (0.1.5 and 0.2.1-rc.5) with commands only: every collapsed title reads as a complete conclusion, and the status symbols render correctly. The README demo GIF is re-recorded on v0.2 in a real DSH session. Not in this release: the DSH system-prompt section for the Agent guidance (guidance currently lives in the tool descriptions), and the v0.3 interactive panel.

## 0.1.1 — 2026-11-04

- `/done-check` command output is now plain text laid out per check, instead of a Markdown table. DSH web shows command output as preformatted text, and its font does not give CJK characters an exact double width, so only the ASCII check id is padded. `show` evidence and run summaries are plain text too. Agent tool output stays Markdown.
- README: demo screenshots from a real DSH web session, with absolute image links so they show on npmjs.com.

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
