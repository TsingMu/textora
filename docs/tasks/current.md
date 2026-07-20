# 当前任务

个人项目同时最多一个任务处于进行中。此文件只保留已承诺、可执行的近期工作，不保存候选想法。

## 进行中

### 接入本地文件打开流程

- **状态**：实现与自动化验证完成；交互式 macOS 界面验证部分完成
- **Feature Spec**：`docs/features/open-local-file.md`
- **目标**：打通系统文件选择 → Rust 一致快照与严格解码 → 二进制 IPC → React 文档会话 → CodeMirror 编辑器的最小端到端流程。
- **范围**：单文件打开、加载与错误状态、未保存内容保护、文档描述信息同步；不包含保存、多标签、拖放、快捷键或外部修改持续监听。
- **结果**：Rust 侧新增 `src-tauri/src/ipc.rs`，定义稳定错误代码 `DocumentErrorCode`（kebab-case 序列化）与 `DocumentOpenError`，映射核心 `DocumentError` 且不泄露内部路径；无路径参数的 `select_and_open_document` 在 Rust 侧显示系统对话框，只读取用户实际选择的文件，并在 `OpenBuffer` 暂存解码后字节；`read_document_content` 仅在文档 ID 匹配时取出内容并以 `tauri::ipc::Response` 返回原始二进制。新增 Rust `tauri-plugin-dialog`，前端 capability 未新增 dialog、文件系统、shell 或网络权限。前端 `platform.ts` 增加描述符/编码/换行类型、二进制取回 API 与错误守卫；`documentSession.ts` 扩展为含 `path`/真实编码与换行/`openStatus`/`openErrorCode` 的状态机；`App.tsx` 接入“打开”入口、加载与错误通知、未保存放弃确认覆盖层，加载期间将 CodeMirror 动态设为只读，成功后经既有事务路径原子替换内容并恢复焦点。
- **验证**：`cargo fmt --check`、`cargo check --all-targets`、`cargo test`（35 passed）、`npm run check`（typecheck + vitest 22 passed）、`npm run build` 与 `npm run tauri -- build` 均通过；`./script/build_and_run.sh --verify` 成功启动应用，macOS 界面已验证未保存确认的取消/确认分支、系统对话框取消保护，以及打开 UTF-8/LF 的 `README.md` 后描述信息、未修改状态和焦点正确。其余编码/错误样本与 Windows 验证尚未执行，详见 Feature Spec 验证记录。

## 最近完成

### 修复编辑器输入后失焦

- **状态**：已完成
- **完成日期**：2026-07-20
- **结果**：CodeMirror `EditorView` 仅在组件挂载时创建，不再因每次受控内容更新而销毁重建；外部内容变化通过事务同步，并避免被误报为用户编辑。连续输入时编辑器实例、焦点、内容同步与脏状态均保持正常。
- **验证**：`npm run check` 通过（3 passed / 0 failed，包含受控内容更新后编辑节点及焦点保持的 DOM 回归测试）；`npm run build`、`cargo fmt --manifest-path src-tauri/Cargo.toml --check`、`cargo test --manifest-path src-tauri/Cargo.toml`（32 passed / 0 failed）及 `npm run tauri -- build` 通过；`./script/build_and_run.sh --verify` 成功启动 macOS 应用，界面验证两轮连续输入得到 `abc123XYZ`，焦点始终位于编辑器且脏状态正确更新。Windows 尚未验证。

### 实现 Rust 文档读取与识别核心

- **状态**：已完成
- **完成日期**：2026-07-20
- **结果**：在 `src-tauri/src/document/` 建立内部 Rust 文档核心，未暴露为 Tauri 命令。`error.rs` 定义大小超限、无效编码、读取期间变更与 I/O 错误。`encoding.rs` 按 UTF-8 BOM → 严格 UTF-8 → 严格 CP936 顺序识别；GBK 分支先按 Unicode Consortium 发布的 Microsoft CP936 v2.01 映射范围拒绝 GB18030 四字节与超集专有双字节位置，再由 `encoding_rs` 完成映射，不外泄替换字符。`line_ending.rs` 识别 `Lf`/`Crlf`/`Mixed`；`fingerprint.rs` 生成原始字节的 SHA-256 指纹。`open_document` 使用单一文件句柄与 `MAX + 1` 有界读取，比较读取前后元数据并检测路径原子替换；描述符内部保留原始 `PathBuf`，不再有损转换。
- **验证**：`cargo fmt --manifest-path src-tauri/Cargo.toml --check`、`cargo check --manifest-path src-tauri/Cargo.toml --all-targets` 通过；`cargo test --manifest-path src-tauri/Cargo.toml` 通过（32 passed / 0 failed，覆盖空输入、ASCII、UTF-8 多字节、BOM 剥离、合法 CP936、CP936 单字节欧元与双字节边界/官方映射表签名、GB18030 四字节与超集双字节拒绝、LF/CRLF/Mixed、指纹、50 MiB 边界、有界读取、`open_document` 读取与缺失文件）；`npm run check` 与 `npm run tauri -- build` 通过。Windows 尚未验证。

### 建立可运行工程基线

- **状态**：已完成
- **完成日期**：2026-07-20
- **结果**：建立 Tauri 2 + React + TypeScript + Vite + CodeMirror 6 工程，实现可编辑的新建文档、文档核心健康检查 IPC、最小 capability/CSP，并配置统一构建运行脚本与 Codex Run 动作。
- **验证**：`npm run check`、`npm run build`、`cargo fmt --manifest-path src-tauri/Cargo.toml --check`、`cargo test --manifest-path src-tauri/Cargo.toml` 与 `npm run tauri -- build` 通过；`./script/build_and_run.sh --verify` 确认 macOS 进程启动；UI 冒烟确认窗口、IPC 状态、编辑输入与脏状态。Windows 尚未验证。

### 建立最小项目文档

- **状态**：已完成
- **完成日期**：2026-07-14
- **结果**：建立项目入口、产品、架构、决策、功能规格模板和任务文档；未确定的产品与技术选择保留为开放问题。
- **验证**：确认所请求文档均存在，并检查文档之间的职责与链接。

### 确认跨平台技术方案

- **状态**：已完成
- **完成日期**：2026-07-14
- **结果**：确认 macOS/Windows 产品范围、Tauri/React/CodeMirror/Rust 技术栈、50 MiB 文件上限和 UTF-8/GBK 无损编码规则，并形成基础文本编辑 Feature Spec。
- **验证**：检查产品、架构、决策、Feature Spec、当前任务与 backlog 的范围和术语一致性。

## 会话交接

- 已确认 macOS 13+ 与 Windows 10 22H2+ 双平台范围、Tauri 技术栈、50 MiB 上限和 UTF-8/GBK 编码边界。
- 可运行工程基线已完成并通过 macOS 验证；Windows 构建与启动仍需在对应环境执行。
- 基础文本编辑 Feature Spec 已确认。Rust 文档读取与识别核心已完成并通过 macOS 的 fmt/test/check/tauri build 验证：`analyze(&[u8])` 为纯字节分析，内部 `open_document(&Path)` 继续负责一致快照与严格解码。
- 当前本地文件打开切片已完成实现与自动化验证：无路径参数的 Tauri `select_and_open_document` 在 Rust 侧选择并打开文件，`read_document_content` 通过原始二进制响应传输内容；前端 capability 未获得 dialog、文件系统、shell 或网络权限。
- 交互式 macOS 已验证未保存确认、系统对话框取消和 UTF-8/LF 文件成功打开；ASCII、UTF-8 BOM、CP936、各类错误拒绝及 Windows 验证待执行。保存、原子替换、多标签和外部修改持续监听不在本次范围。
