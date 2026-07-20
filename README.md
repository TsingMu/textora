# Textora

Textora 是一款面向 macOS 与 Windows 的桌面文本编辑器，定位类似 Notepad++ 和 UltraEdit，计划支持普通文本、代码、Markdown 和 Mermaid。

## 当前状态

项目已建立 Tauri 2、React、TypeScript、Vite、CodeMirror 6 与 Rust 可运行工程基线。当前可新建文档，也已实现受限系统对话框、本地文本读取、严格 UTF-8/CP936 识别、二进制 IPC 与前端编辑会话；文件打开已完成 macOS 验收，Windows 尚待对应环境验证，保存与原子替换尚未实现。

## 文档导航

- `docs/PRODUCT.md`：产品定位、范围与原则
- `docs/ARCHITECTURE.md`：系统边界、概念模块与架构约束
- `docs/DECISIONS.md`：已接受的重要决策
- `docs/features/TEMPLATE.md`：功能规格模板
- `docs/features/basic-text-editing.md`：已确认的基础文本编辑规格
- `docs/features/open-local-file.md`：当前本地文件打开切片规格
- `docs/tasks/current.md`：当前已承诺任务
- `docs/tasks/backlog.md`：尚未承诺的候选事项
- `AGENTS.md`：AI 协作与文档维护约定

## 开发与运行

前置条件：

- Node.js 20+ 与 npm
- Rust stable（通过 rustup 安装）
- macOS 上的 Xcode Command Line Tools，或 Windows 上的 Tauri 2 系统依赖

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

开始工作前先阅读 `AGENTS.md`，再按任务范围阅读相关产品、架构、决策、功能规格和当前任务文档。不要把 backlog 当作已承诺计划。
