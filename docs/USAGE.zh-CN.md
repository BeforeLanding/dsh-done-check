# 使用指南

[← README](../README.zh-CN.md) · [English](USAGE.md)

`dsh-done-check` 通过 DeepSeek Harness 执行约定的验收检查，并记录实际发生的结果。只有用户能确认清单、决定人工项结论。

## 安装

v0.2.1 新功能目前通过源码安装使用，npm 待发布。打包 CI 会安装官方 DSH `0.1.5-rc.3` 和 `0.2.1-rc.5` 运行时，并用测试专用 shell 工具执行真实进程；不覆盖桌面界面或模型供应商。包的 peer 范围明确列入 RC5，避免 npm 排除宽泛范围里的其他预发布版本。

需要 DSH `>=0.1.5-rc.1 <0.3.0`、Node.js `>=22.19` 和 git。在 git 项目里打开 DSH 会话，清单放在 git 根目录。

```bash
dsh plugin --profile web add dsh-done-check
```

如使用其他 profile，替换 `web`。从本地源码安装：

```bash
pnpm install
pnpm build
dsh plugin --profile <your-profile> add /absolute/path/to/dsh-done-check
```

## 初始化与输出语言

在项目的 DSH 对话里输入 `/done-check init` 创建草稿。初始化会识别 `package.json` 中真实存在的 `test`、`typecheck`、`lint` 脚本，并添加人工验收项；没有适用脚本时，只生成人工项。确认前请按实际任务改写名称、人工操作步骤和预期结果。项目脚本是基础检查，不会被当成具体功能已验收。

初始化不会运行命令、确认检查或覆盖已有文件。默认输出中文，`/done-check lang en` 或 `/done-check lang zh` 只切换当前会话的语言，重建会话后恢复默认值；管理员也可通过插件的 `language` 选项设置默认语言。预览、状态、结果、详情和帮助支持英文；任务名称、人工说明、测试输出与原始诊断保持原文。

主要子命令同时支持中英文别名。

## 编写清单

让 Agent 起草 `done-check.yaml`，或自己编写。下面是录屏里的 CSV 示例，请把命令和路径换成项目里真实存在的测试。

```yaml
version: 1
task: CSV 导出
checks:
  - id: export-tests
    name: 导出内容与所选数据一致
    run: node test/export.test.mjs
    watch: ["src/**", "test/**"]
  - id: escape-tests
    name: 含逗号和换行的数据能正确导出
    run: node test/escape.test.mjs
    timeout: 120
    watch: ["src/**", "test/**"]
  - id: zh-filename
    name: 中文文件名可以正常下载
    manual: true
    how: 在浏览器里导出一个名为“报表”的文件，确认文件名没有乱码
```

每项需要唯一的 `id`（1–64 个小写字母、数字或连字符，以字母或数字开头）、描述可验证行为的 `name`，以及 `run` 命令或 `manual: true`。人工项应提供人能照着操作的 `how`。通用测试和类型检查可以作为基础检查，不能只靠改个名称，就算作某项功能已经验证。

自动项可设置 `timeout`（整数秒，默认 300，最大 1800）和 `cwd`（相对 git 根目录的工作目录，默认 `.`）。`watch` 模式始终相对 git 根目录，不相对 `cwd`。

## 预览、确认、执行

每条命令单独发送：

1. `/done-check` 预览清单和每条命令，不执行任何东西。
2. `/done-check 确认` 确认刚预览过的那份清单。如果清单变了，需要重新预览。
3. `/done-check` 执行已确认、尚未运行或结果已过期的自动项，然后给出结论。

失败时，用 `/done-check 详情 [序号]` 查看报告，修复问题后再检查。未变更的失败结果不会被裸命令自动重跑；`/done-check 重新检查` 可以强制重跑全部已确认的自动项。

人工项按 `how` 操作，再用 `/done-check ok [序号]` 或 `/done-check no [序号] [备注]` 记录结论。只有一个人工项在等待时，可省略序号。序号是清单里的排列位置，内部 ID 也可以使用。

## 关注正确的文件

不写 `watch` 时，指纹包含已跟踪文件和未被忽略的未跟踪文件，`done-check.yaml` 本身除外。未提交的修改也算变化，单纯提交代码不会改变指纹。已经被 git 跟踪的文件，即使名称匹配 gitignore 规则，也会纳入。

写了 `watch`，则只对上述集合中匹配模式的文件计算指纹。除源码和测试外，也应包含相关配置、依赖声明和锁文件。显式范围没有匹配任何文件时会被拒绝。`watch` 是你声明的范围，不是自动推断的依赖图。

当前指纹和记录不一致时，结果需要重验。普通过期结果在文件内容完全恢复后可以重新有效；这不同于下文所说的“不可信运行结果”。

## 命令参考

- `/done-check init`（`初始化`）：创建草稿，不覆盖、不运行。
- `/done-check lang en|zh`（`语言`）：切换当前会话语言。
- `/done-check`：预览、执行需要检查的项目，或展示结论。
- `/done-check 确认`（`confirm`）：**仅用户**能确认最近一次预览。
- `/done-check ok [序号]` / `/done-check no [序号] [备注]`：**仅用户**能记录人工结论。
- `/done-check 状态`（`status`）：只读状态，不运行检查。
- `/done-check 详情 [序号]`（`details`）：命令、退出码、执行时间、输出末尾、变化的文件。
- `/done-check 全部`（`all`）：所有项目，含已通过项。
- `/done-check 技术详情 [序号]`（`tech`）：执行器、沙箱、完整指纹、定义哈希与日志路径。
- `/done-check 重新检查`（`run`）：强制重跑全部已确认的自动项。
- `/done-check 帮助`（`help`）：命令帮助。

v0.2.0 中，`show`、`pass`、`fail` 旧别名再保留一个版本。

Agent 工具：

- `done_check_draft`：校验 YAML 草稿，返回规范内容；Agent 再用自己的文件工具保存。
- `done_check_run`：执行已确认的自动项，记录证据。
- `done_check_status`：读取当前结论与下一步。

这些工具都不能确认清单，也不能决定人工项。清单结构或检查定义变更后，所有入口都会阻止自动运行和人工结论写入，直到用户重新确认。

## 信任与边界

**通过证明了什么。** 只证明约定的检查通过，不证明需求里的每一项都已实现。插件不提供“完成度”百分比。失败时原文引用测试自己输出的最多三行，不据此推断原因。没能运行的命令，既不算通过，也不算失败。

**确认和执行分开。** 确认绑定到最近一次预览的精确内容，不绕过执行权限。每条命令经过已注册的 DSH `pwsh`/`bash` 工具，拒绝执行的命令不产生证据。`bash-local` 和 `pwsh-local` 不提供隔离；需要隔离时，应组合对应的沙箱执行器。

**定义不能悄悄变。** 修改某项，需要重新确认；增删检查项或改写任务，需要重新确认整份清单。Agent 的工具不能记录这次确认，也不能记录你的人工结论。

**不可信的运行结果不会恢复。** 若一次检查开始和结束时，相关文件指纹或该项定义不一致，该次运行会标记为不可信。之后恢复文件也不能让它重新有效。两次快照之间改动又完全恢复的变化无法检测。

**shell 仍是信任边界。** 插件防的是随手改动检查或结论。有不受限 shell 的恶意 Agent 可以改测试、改 DSH home，插件无法阻止。

## 开发

```bash
pnpm install
pnpm typecheck
pnpm build
pnpm test
pnpm test:example
npm run smoke:package -- 0.1.5-rc.3
npm run smoke:package -- 0.2.1-rc.5
```

参见[设计文档](DESIGN.md)、[更新日志](../CHANGELOG.md)与[素材制作指南](video/README.md)。
