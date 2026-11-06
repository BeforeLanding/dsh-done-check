# Try a real failure, fix, pass and stale result

[English](#english) · [简体中文](#简体中文)

## English

This teaching example intentionally contains a CSV quoting bug. It uses only Node.js built-in modules, with no npm dependencies, commits or git identity setup. It is not production code.

You need Node.js ≥22.19, git, DSH with this plugin installed, and the spreadsheet application you normally use. See the [project installation instructions](https://github.com/BeforeLanding/dsh-done-check#install).

### 1. Create a standalone demo project

From the root of this repository, run:

```bash
node examples/csv-export/demo.mjs setup
```

The script copies these five files into a new system temporary directory, initializes a separate git repository, and prints the next commands. Enter that printed directory and open a DSH session there:

```bash
cd "<directory printed by the script>"
dsh web
```

**Do not run this checklist in the main dsh-done-check repository.** The plugin reads `done-check.yaml` from the session project's **git root**. It does not automatically use the checklist inside `examples/csv-export`. If DSH is already running, create a new session for the printed temporary directory and check its working directory.

### 2. See a real failure

Send these as **three separate messages** in that demo project's DSH chat:

```text
/done-check
/done-check confirm
/done-check
```

Expected: the selected-row check passes, the CSV escaping check fails with the actual versus expected strings, and the manual item awaits you. Preview and confirmation do not execute tests; the final command does.

You can inspect the bug directly in the terminal too: `node test.mjs rows` passes, while `node test.mjs escaping` fails with a nonzero exit code. The checklist names and current plugin output are in Chinese; the commands above accept English aliases.

### 3. Fix, re-check, then inspect the export yourself

In the demo directory's terminal, run:

```bash
node demo.mjs fix
node demo.mjs export
```

`fix` changes only this teaching project's `csv.mjs`. Alternatively, ask the agent to read the failure and fix the function itself. The supplied fix quotes fields containing commas, double quotes or newlines, and doubles any quotes inside the field.

Back in DSH, send `/done-check`. The changed automatic checks should run again and pass. The manual item still needs you: open `export.csv` in your spreadsheet application, selecting UTF-8 if needed. Confirm that it contains only the two selected records, **张三** and **李四**, with readable Chinese text; the comma, quotes and newline in 张三's note must remain in the same cell. **Only after actually verifying this**, send `/done-check ok 3`. If the result is wrong, send `/done-check no 3 <what went wrong>`. Without a spreadsheet application, leave the manual item pending.

The export uses UTF-8 with a BOM. The demo's `.gitignore` excludes it, so generating the file does not itself invalidate the checks.

### 4. Make the saved results stale

In the demo directory, run:

```bash
node demo.mjs stale
```

This adds a harmless comment to `csv.mjs`: its behaviour stays the same, but its contents change. In DSH, send **`/done-check status`**. Both automatic results and the recorded manual verdict should now need re-checking. Do not send the bare `/done-check` first: it immediately re-runs automatic checks that are due. If you left the manual item pending in step 3, it remains pending rather than becoming a stale verdict.

Send `/done-check` to run the automatic checks again. Inspect the manual item again before confirming it. The temporary demo does not modify the original repository; you can delete its printed directory after trying it.

### Files

- `csv.mjs`: the CSV export function with an intentional quoting bug.
- `test.mjs`: two real assertions for selected records and CSV escaping.
- `done-check.yaml`: two automatic checks and one genuine manual check.
- `demo.mjs`: copy and initialize the demo, apply the fix, export a file, or change its code.
- `README.md`: these instructions, in both languages.

The `fix`, `export` and `stale` commands require both the current directory and the script directory to be this standalone git root. They refuse to run in the main repository.

## 简体中文

一个故意保留 CSV 引号缺陷的教学示例，只使用 Node.js 内置模块。没有 npm 依赖，也不需要提交代码或设置 git 身份。请勿用于生产。

需要 Node.js ≥22.19、git、已安装本插件的 DSH，以及你实际使用的表格应用。插件安装见[项目 README](https://github.com/BeforeLanding/dsh-done-check#install)。

### 1. 创建独立体验目录

在本仓库根目录运行：

```bash
node examples/csv-export/demo.mjs setup
```

脚本把此目录的五个文件复制到系统临时目录，创建独立 git 仓库，并打印下一步命令。进入打印出的目录，再从那里打开 DSH 会话：

```bash
cd "<脚本打印的目录>"
dsh web
```

**不要直接在 dsh-done-check 主仓库里运行这份清单。** 插件从当前会话所在项目的 **git 根目录**读取 `done-check.yaml`，不会自动使用 `examples/csv-export` 里的清单。若 DSH 已在运行，务必为打印出的临时目录创建一个新会话，并核对会话工作目录。

### 2. 看到真实失败

在该体验目录的 DSH 对话里逐条发送：

```text
/done-check
/done-check confirm
/done-check
```

预期：所选记录检查通过；CSV 转义检查失败，报告显示实际字符串与期望字符串的区别；人工项等待你验证。预览和确认不执行测试，最后一条命令才真正执行。

也可以先在终端直接查看缺陷：`node test.mjs rows` 通过，`node test.mjs escaping` 以非零退出码失败。

### 3. 修复、重验，再亲自验收

在体验目录的终端运行：

```bash
node demo.mjs fix
node demo.mjs export
```

`fix` 只修复这个教学目录里的 `csv.mjs`；也可以让 Agent 阅读失败报告后自行修复。固定方案是给含逗号、双引号或换行的字段加引号，并把字段内部的双引号写成两个双引号。

回到 DSH 发送 `/done-check`，自动项应真实重跑并通过。人工项此时仍未通过：在目标表格应用中打开 `export.csv`（需要时选择 UTF-8），按清单里的说明检查中文、所选记录和多行备注。**只有你实际验证通过后**，发送 `/done-check ok 3`；若不正确，发送 `/done-check no 3 <发现的问题>`。没有表格应用时可以保留人工项待确认。

导出文件使用 UTF-8 BOM，且被体验目录的 `.gitignore` 排除，不会因为生成导出文件本身就让证据过期。

### 4. 让旧结果过期

在体验目录运行：

```bash
node demo.mjs stale
```

它给 `csv.mjs` 添加一条无害注释，行为没变，文件内容确实变了。回到 DSH 发送 **`/done-check status`**，应看到两项自动结果与人工结论都需要重验。此时不要先发裸 `/done-check`，它会立即重跑到期的自动项。如果第 3 步保留人工项待确认，它会继续等待，不会产生一条过期的人工结论。

再次 `/done-check` 可重跑自动项；人工项需要你重新检查后再确认。临时目录不影响原仓库；体验结束后可自行删除打印出的目录。

### 文件

- `csv.mjs`：故意缺少引号处理的 CSV 导出函数。
- `test.mjs`：验证所选记录与 CSV 转义的两项实际断言。
- `done-check.yaml`：两项自动检查、一项真实人工检查。
- `demo.mjs`：复制并初始化体验目录、应用修复、导出文件、制造内容变化。
- `README.md`：本说明。

脚本的 `fix`、`export`、`stale` 要求当前目录和脚本目录均为这个独立 git 根目录；在主仓库中直接执行会拒绝操作。
