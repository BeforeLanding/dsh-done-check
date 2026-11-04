# dsh-done-check

为 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 编码任务保存可执行的验收清单：每条"已完成"都有真实执行的检查结果，代码变化后旧结果自动标记为需要重验。

> **它能说明什么，不能说明什么**
>
> - "3 项验收中，2 项通过、1 项待人工确认"只表示**约定的检查**的结果，不表示需求已完整实现。插件不显示百分比或"完成度"。
> - 防的是 Agent 随手改写结论：自己宣布测试通过、偷改检查命令、删掉失败项、伪造确认记录。不防拥有不受限 shell 的恶意 Agent，它可以改测试本身，也可以改 DSH home 下的文件。
> - 确认清单不等于授权执行其中的命令。检查命令由当前 DSH 组合的 shell 执行器运行；`bash-local`/`pwsh-local` 不做任何隔离，需要隔离请组合对应的 sandbox 执行器。
> - `watch` 是你声明的范围，不是自动分析出的依赖关系。

## 状态

开发中（v0.1 未发布）。核心逻辑已完成并有测试覆盖：清单解析，定义哈希与结构哈希，工作区指纹，状态推导（含执行不稳定、无法判定），以及证据存储（独立运行记录、日志上限、跨进程加锁）。DSH 插件层（工具、命令、两个执行入口的授权）尚未完成。设计见 [docs/DESIGN.md](docs/DESIGN.md)。

## 工作方式

1. 在项目根目录写 `done-check.yaml`（或让 Agent 起草）：

   ```yaml
   version: 1
   task: 新增 CSV 导出功能
   checks:
     - id: export-tests
       name: 导出相关测试通过
       run: pnpm test -- export
       watch: ["src/**", "test/**"]
     - id: typecheck
       name: TypeScript 类型检查通过
       run: pnpm tsc --noEmit
     - id: zh-filename
       name: 中文文件名下载正常
       manual: true
   ```

2. 你用 `/done-check confirm` 确认清单。确认和人工结论只能由你通过命令完成，Agent 做不到。
3. 检查经由 DSH 的 shell 执行器真实运行，记录退出码、输出、耗时和当时的工作区指纹。
4. 工作区内容一变（包括未提交的修改），绑定旧内容的结果就显示为"已过期"，并列出变化的文件；清单里某项被改，该项显示为"清单已改动"；增删检查项或改任务描述，整份清单显示为"结构已变，待确认"。
5. 执行期间工作区或定义发生变化的结果标记为"执行不稳定（须重跑）"，把文件改回去也不能恢复。

## 开发

```bash
pnpm install
pnpm test
```

需要 Node.js ≥ 22.19 和 git。

## 许可证

MIT
