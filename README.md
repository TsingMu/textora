# Textora

Textora 是一款 macOS 个人文本工作台，把 Windows 内网工作中常用的普通文本、列块编辑和 Markdown 工作流整合到一个本地应用，并兼容 UTF-8、GBK/CP936、LF 与 CRLF 等常见文件格式。

## 当前状态

项目已建立 Tauri 2、React、TypeScript、Vite、CodeMirror 6 与 Rust 可运行工程基线。当前可新建、打开、普通保存和另存为文档；首次保存与另存为使用应用内目标面板直接选择文件名和位置，编码与换行由主界面右下角设置决定。文件打开、普通保存、首次保存、另存为、保存冲突解决、未保存关闭保护（窗口关闭与应用退出）、另存为内嵌目标面板、多标签会话以及列块编辑均已完成自动化及 macOS 交互验收。代码语法高亮已完成语言识别、CodeMirror 高亮接入与既有编辑能力回归等自动化实现切片（含状态栏语言显示）；当前下一步是代码高亮的集成验收与文档收尾，完成后再同步为已完成。Markdown 模式仍在 Backlog。

## 文档导航

- `docs/PRODUCT.md`：产品定位、范围与原则
- `docs/ARCHITECTURE.md`：系统边界、概念模块与架构约束
- `docs/DECISIONS.md`：已接受的重要决策
- `docs/features/TEMPLATE.md`：功能规格模板
- `docs/features/basic-text-editing.md`：已确认的基础文本编辑规格
- `docs/features/open-local-file.md`：已完成的本地文件打开切片规格
- `docs/features/safe-save-core.md`：已完成的 Rust 文档编码与安全保存核心规格
- `docs/features/save-opened-file.md`：已完成的已打开文件普通保存规格
- `docs/features/save-as-and-first-save.md`：已完成的另存为与新建文档首次保存规格
- `docs/features/save-as-target-selection.md`：已确认的另存为目标路径与文件名选择规格
- `docs/features/save-as-inline-target-panel.md`：已完成的另存为内嵌目标面板规格
- `docs/features/resolve-save-conflict.md`：已完成的保存冲突解决规格
- `docs/features/unsaved-close-protection.md`：已完成的未保存关闭保护规格
- `docs/features/multi-tab-session.md`：已完成的多标签会话规格
- `docs/features/column-block-editing.md`：已完成的列块编辑规格
- `docs/features/code-syntax-highlighting.md`：已确认的代码文本识别与最小语法高亮规格
- `docs/tasks/current.md`：当前已承诺任务
- `docs/tasks/TEMPLATE.md`：当前任务条目与颗粒度模板
- `docs/tasks/backlog.md`：尚未承诺的候选事项
- `AGENTS.md`：AI 协作与文档维护约定

## 开发与运行

前置条件：

- Node.js 20+ 与 npm
- Rust stable（通过 rustup 安装）
- macOS 上的 Xcode Command Line Tools

首次安装前端依赖：

```bash
npm install
```

使用项目统一入口构建并启动 macOS 应用：

```bash
./script/build_and_run.sh
```

Codex 桌面端的 `Run` 动作也指向该脚本。可用 `--verify`、`--debug`、`--logs` 或 `--telemetry` 执行对应模式。

常用验证命令：

```bash
npm run check
npm run build
cargo fmt --manifest-path src-tauri/Cargo.toml --check
cargo test --manifest-path src-tauri/Cargo.toml
npm run tauri -- build
```

`npm run tauri -- build` 在 macOS 生成 `Textora.app`。签名、DMG/MSI/NSIS 等分发产物不属于当前工程基线。

## 协作

开始工作前先阅读 `AGENTS.md`，再按任务范围阅读相关产品、架构、决策、功能规格和当前任务文档。不要把 backlog 当作已承诺计划；开始任何功能实现前，必须先在 `docs/tasks/current.md` 将唯一目标任务更新为“进行中”并记录开始日期与当前进度。
