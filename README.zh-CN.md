<p align="center">
  <img src="https://raw.githubusercontent.com/BeforeLanding/dsh-done-check/main/docs/images/logo.svg" width="64" height="64" alt="">
</p>

<h1 align="center">dsh-done-check</h1>

<p align="center">为 <a href="https://github.com/deepseek-ai/deepseek-harness">DeepSeek Harness</a> 提供可执行的验收检查。</p>

<p align="center">
  <a href="https://www.npmjs.com/package/dsh-done-check"><img src="https://img.shields.io/npm/v/dsh-done-check?style=flat&amp;color=0969da" alt="npm 版本"></a>
  <a href="https://github.com/BeforeLanding/dsh-done-check/actions/workflows/ci.yml"><img src="https://github.com/BeforeLanding/dsh-done-check/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="https://github.com/BeforeLanding/dsh-done-check/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-MIT-0969da?style=flat" alt="MIT 许可证"></a>
</p>

<p align="center"><a href="README.md">English</a> · 简体中文<br>
<a href="#安装">安装</a> · <a href="#操作演示">观看演示</a> · <a href="#快速开始">快速开始</a> · <a href="#试用示例">可运行示例</a></p>

把任务约定的验收项写进 `done-check.yaml`。插件通过 DSH 运行检查，记录命令和结果；关注的文件变了，旧结果就提示需要重验。清单确认和人工项结论由你决定。

## 安装

需要 **DSH `>=0.1.5-rc.1 <0.3.0`**、**Node.js `>=22.19`** 和 **git 项目**。

```bash
dsh plugin --profile web add dsh-done-check
```

使用其他由 CLI 管理的 profile 时，把 `web` 换成对应名称。安装后按宿主提示重新加载或重启。参见[源码安装](https://github.com/BeforeLanding/dsh-done-check/blob/main/docs/USAGE.zh-CN.md#安装)。

## 操作演示

按实际命令走一遍：预览清单、确认、查看 CSV 失败报告、验证修复、记录人工项，以及代码变化后的重新验收。

<p align="center">
  <a href="https://youtu.be/CJw7eL7v4bw"><img src="https://raw.githubusercontent.com/BeforeLanding/dsh-done-check/main/docs/images/demo-cover.jpg" width="760" alt="播放 72 秒 CSV 导出验收操作演示，含中文旁白与双语字幕。"></a>
</p>

<p align="center"><a href="https://youtu.be/CJw7eL7v4bw"><strong>▶ 在 YouTube 观看 · 1:12 · 1080p</strong></a><br>
中文旁白 · 中英双语字幕<br>
<a href="https://raw.githubusercontent.com/BeforeLanding/dsh-done-check/main/docs/video/walkthrough.mp4">下载 MP4</a> · <a href="https://github.com/BeforeLanding/dsh-done-check/blob/main/docs/video/README.md">章节、字幕与原始素材</a></p>

<details>
<summary>18 秒快速预览（GIF）</summary>

<p align="center">
  <img src="https://raw.githubusercontent.com/BeforeLanding/dsh-done-check/main/docs/images/hero.gif" width="900" alt="真实 DSH 会话：预览 CSV 验收清单、确认、运行失败的测试、查看证据、记录人工结论，再查看代码变更后的过期结果。">
</p>
<p align="center"><sub>18 秒真实 DSH 会话剪辑，中文界面、双语步骤标签。<br><a href="https://youtu.be/CJw7eL7v4bw">在 YouTube 观看完整视频</a> · <a href="https://raw.githubusercontent.com/BeforeLanding/dsh-done-check/main/docs/images/hero-poster.png">查看静态图</a></sub></p>

</details>

## 快速开始

**1. 在 git 根目录添加清单。** 可以让 Agent 起草：

> 为当前任务起草并保存 done-check.yaml。使用项目里真实存在的测试命令，写清每项能验证什么；需要我亲自检查的内容写成人工项，并附上操作说明。

也可以[自己编写 YAML](https://github.com/BeforeLanding/dsh-done-check/blob/main/docs/USAGE.zh-CN.md#编写清单)。

**2. 预览、确认、执行。** 在项目的 DSH 对话里，分三次发送：

```text
/done-check
/done-check 确认
/done-check
```

第一条展示清单和命令，不执行任何东西。“确认”记录你接受刚预览的这份内容；再输入 `/done-check` 才执行自动检查。

**3. 根据结果处理。** 失败时查看测试原文，让 Agent 修复问题，再运行 `/done-check`。人工项按说明自行验证，用 `/done-check ok [序号]` 或 `/done-check no [序号] [备注]` 记录结论；只有一项待人工确认时，可以省略序号。

插件目前输出中文，命令同时接受中英文别名，例如 `确认` / `confirm`、`详情` / `details`。

## 试用示例

[CSV 导出示例](https://github.com/BeforeLanding/dsh-done-check/tree/main/examples/csv-export)包含一个故意留有缺陷的导出函数、两项自动检查、一项人工检查和现成修复。运行其中的测试只需要 Node.js 和 git，不需要安装依赖或配置 API key。

<details>
<summary>克隆仓库并创建独立演示项目</summary>

```bash
git clone https://github.com/BeforeLanding/dsh-done-check.git
cd dsh-done-check
node examples/csv-export/demo.mjs setup
```

</details>

初始化命令会打印一个新的独立 git 目录及后续命令。在那里打开 DSH 会话，按示例 README 复现 **失败 → 修复 → 通过 → 过期**。已有本仓库时，只需执行最后一条初始化命令。示例用于复现录屏里的 CSV 场景，视频素材来自原始会话。

## 结果说明了什么

- **通过或失败：** 命令实际执行，退出码、输出、耗时和文件内容指纹一起记录。
- **没能运行：** 权限拒绝、超时或执行器问题导致没有可用结果，既不算通过，也不算失败。
- **等待你确认：** 人工项需要你给出结论，Agent 不能确认清单或记录人工决定。
- **需要重新检查：** 关注的文件已不同于旧结果对应的版本；修改检查定义或清单结构则需要重新确认。

> 通过只代表**约定的检查通过了**，不代表需求的每一部分都被覆盖。插件不提供“完成度”百分比。

不写 `watch` 时，指纹覆盖已跟踪和未被忽略的未跟踪文件，清单本身除外；写了 `watch`，就只覆盖匹配的文件。请纳入相关配置和锁文件，插件不会自动推断依赖。参见[文件范围与信任边界](https://github.com/BeforeLanding/dsh-done-check/blob/main/docs/USAGE.zh-CN.md#关注正确的文件)。

## 命令与文档

- `/done-check 状态`：只读当前状态，不运行检查。
- `/done-check 详情 [序号]`：查看命令、输出和变化的文件。
- `/done-check 重新检查`：强制重跑全部已确认的自动项，包括内容未变的失败项。
- [全部命令和 Agent 工具](https://github.com/BeforeLanding/dsh-done-check/blob/main/docs/USAGE.zh-CN.md#命令参考) · [清单格式](https://github.com/BeforeLanding/dsh-done-check/blob/main/docs/USAGE.zh-CN.md#编写清单) · [English guide](https://github.com/BeforeLanding/dsh-done-check/blob/main/docs/USAGE.md)

确认清单不会绕过 DSH 命令权限。检查经由已注册的 shell 工具运行，本地执行器不提供隔离。插件防的是随手修改检查和结论，不防拥有不受限 shell 的 Agent。参见[信任模型](https://github.com/BeforeLanding/dsh-done-check/blob/main/docs/USAGE.zh-CN.md#信任与边界)。

## 开发

```bash
pnpm install
pnpm typecheck
pnpm build
pnpm test
```

**v0.2.0，早期版本。** 已在真实 DSH Web `0.1.5-rc.1` 和 `0.2.1-rc.5` 上验证，由真实 `pwsh` 工具在沙箱中执行。参见[更新日志](CHANGELOG.md)、[设计文档](https://github.com/BeforeLanding/dsh-done-check/blob/main/docs/DESIGN.md)和[素材构建说明](https://github.com/BeforeLanding/dsh-done-check/blob/main/docs/video/README.md)。

## 许可证

[MIT](LICENSE)
