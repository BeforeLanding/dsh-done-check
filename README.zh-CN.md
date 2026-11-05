# dsh-done-check

[English](https://github.com/BeforeLanding/dsh-done-check/blob/main/README.md) | 中文

[![CI](https://github.com/BeforeLanding/dsh-done-check/actions/workflows/ci.yml/badge.svg)](https://github.com/BeforeLanding/dsh-done-check/actions/workflows/ci.yml)

为 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 编码任务保存可执行的验收清单：每条"已完成"都有真实执行的检查结果，代码变化后旧结果自动标记为需要重验。

## 实机演示

字段 `a,b` 和 `c` 应该导出为 `"a,b",c`。第一次运行 `/done-check`，测试报告里却是 `a,b,c`，多出了一列。

![DSH 会话中的 CSV 验收：测试报告指出缺少引号；修复后两项自动检查通过；用户验证中文文件名后，三项全部通过。](docs/images/done-check-demo.gif)

修好 `toCsv` 后重新运行，两项自动检查都通过了。最后一项要亲自下载文件，确认中文文件名正确，再输入 `/done-check ok`。

[查看失败截图](docs/images/done-check-demo-poster.png) · [从预览清单开始看（MP4）](docs/images/done-check-demo.mp4)

> **它能说明什么，不能说明什么**
>
> - "3 项验收中，2 项通过、1 项待人工确认"只表示**约定的检查**的结果，不表示需求已完整实现。插件不显示百分比或"完成度"。
> - 防的是 Agent 随手改写结论：自己宣布测试通过、偷改检查命令、删掉失败项、伪造确认记录。不防拥有不受限 shell 的恶意 Agent，它可以改测试本身，也可以改 DSH home 下的文件。
> - 确认清单不等于授权执行其中的命令。检查命令由当前 DSH 组合的 shell 执行器运行；`bash-local`/`pwsh-local` 不做任何隔离，需要隔离请组合对应的 sandbox 执行器。
> - `watch` 是你声明的范围，不是自动分析出的依赖关系。

## 状态

v0.2.0，早期版本。v0.2 只重做了你看到和输入的这一层，验证规则没有改动。新输出已在真实的 DSH Web 宿主（0.1.5-rc.1 和 0.2.1-rc.5）上验证，检查由真实的 `pwsh` 工具在沙箱中执行。支持的 DSH 版本：`>=0.1.5-rc.1 <0.3.0`。设计见 [docs/DESIGN.md](https://github.com/BeforeLanding/dsh-done-check/blob/main/docs/DESIGN.md)。

## 安装

```bash
dsh plugin --profile <你的 profile> add dsh-done-check
```

从源码安装：先 `pnpm install && pnpm build`，再 `dsh plugin --profile <你的 profile> add /path/to/dsh-done-check`。

## 命令与工具

主路径只需要一个命令：**`/done-check` 按当前状态做下一件该做的事**——预览清单、执行检查或给出结论。

| | 谁用 | 作用 |
|---|---|---|
| `/done-check` | 你 | 清单还没确认 → 展示清单**和将要执行的命令**，不执行任何东西。已确认 → 执行"还没检查"或"代码已更新"的自动项，再给摘要。 |
| `/done-check 确认`（`confirm`） | **仅你** | 确认你刚看过的清单。只对最近一次预览的那份清单生效，否则重新展示预览。 |
| `/done-check ok [序号]` / `no [序号] [备注]` | **仅你** | 记录人工项结论。只有一个人工项在等你时可以不写序号。 |
| `/done-check 详情 [序号]`（`details`） | 你 | 命令、退出码、执行时间、输出末尾、变化的文件 |
| `/done-check 全部`（`all`） | 你 | 每一项的状态和详情（含已通过的） |
| `/done-check 技术详情 [序号]`（`tech`） | 你 | 执行器与沙箱模式、完整指纹、定义哈希、日志路径 |
| `/done-check 重新检查`（`run`） | 你 | 强制重跑全部自动检查 |
| `done_check_draft` | Agent | 校验起草的清单（由 Agent 用自己的文件工具保存） |
| `done_check_run` | Agent | 执行已确认的自动检查 |
| `done_check_status` | Agent | 读取状态（返回 `verdict` 和 `nextStep`） |

序号是摘要里的排列顺序，内部 ID 仍然可用。`show`、`pass`、`fail` 作为旧别名再保留一个版本。

输出只回答三个问题：检查了什么、还有什么问题、现在该做什么。第一行永远是一句完整结论，例如 `❌ CSV 导出还有 1 项检查未通过`。检查未通过时，会原文摘录测试自己输出的最多三行，标为"测试报告"，插件不做任何推断。**没能运行**的检查（权限拒绝、超时、执行环境出错）显示为 `⚠️ 没能运行`，既不当作失败，也绝不当作通过。

**确认不等于授权执行。** 确认之后输入 `/done-check` 就会执行已确认的命令，仍按你当前会话的权限规则。每条命令都交给你的 DSH 组合中已注册的 shell 工具（`pwsh`/`bash`）执行，所以你的审批提示都会生效；被拒绝的命令不记录证据。

## 工作方式

1. 在项目根目录写 `done-check.yaml`（或让 Agent 起草）。检查名称用你能判断的行为来写，人工项写上 `how`：

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
       watch: ["src/**", "test/**"]
     - id: zh-filename
       name: 中文文件名可以正常下载
       manual: true
       how: 在浏览器里导出一个名为“报表”的文件，确认文件名没有乱码
   ```

2. 输入 `/done-check` 预览，用 `/done-check 确认` 确认。确认和人工结论只能由你完成，Agent 做不到。
3. 检查经由 DSH 的 shell 工具真实运行，记录退出码、输出、耗时和当时的工作区指纹。
4. 工作区内容一变（包括未提交的修改），绑定旧内容的结果就显示为 `🔄 代码已更新，需要重新检查`，详情里列出变化的文件；清单里某项被改，该项显示 `✏️` 并要求你重新确认；增删检查项或改任务描述，整份清单要求重新确认。
5. 执行期间工作区或定义发生变化的结果显示为 `🔄 检查时代码正在变化，结果不可信`，把文件改回去也不能恢复。

## 开发

```bash
pnpm install
pnpm test
```

需要 Node.js ≥ 22.19 和 git。

## 许可证

MIT
