# 当前任务

个人项目同时最多一个任务处于进行中。此文件只保留已承诺、可执行的近期工作，不保存候选想法。

## 进行中

### 接入已打开文件的普通保存流程

- **状态**：待实现
- **Feature Spec**：`docs/features/save-opened-file.md`
- **目标**：把已完成的 Rust 安全保存核心接入受限二进制 IPC、后端文档状态和当前单文档前端会话，使用户能把已打开文件安全保存回原路径；失败时保留内容与未保存状态。
- **范围边界**：本任务只交付已打开文件的普通保存。新建文档首次保存、另存为、编码转换、Mixed 换行选择、冲突解决、关闭保护和多标签均不在本任务范围。
- **执行顺序**：先建立后端文档 ID 到可信路径/指纹/编码/换行/只读信息的绑定及保存错误契约，再接入二进制内容请求与保存命令；随后扩展前端会话保存状态、可发现入口和成功/失败提示；最后完成 Rust/前端自动化验证、构建及 macOS 真实文件验收。
- **完成标准**：满足 Feature Spec 全部验收条件；至少执行 Rust 格式化、静态检查和测试，前端类型检查与测试、生产构建、Tauri 构建及 macOS 交互验收；Windows 未能执行的验证必须如实保留。

## 最近完成

### 实现 Rust 文档编码与安全保存核心

- **状态**：已完成
- **完成日期**：2026-07-21
- **Feature Spec**：`docs/features/safe-save-core.md`
- **结果**：在 `src-tauri/src/document/` 增加可独立验证的保存核心，未接入 IPC 与界面。`encoding.rs` 的 `encode`：UTF-8（可选加一个 BOM，文本内 U+FEFF 原样保留）、严格 CP936；可表示性用「`encoding_rs::GBK` 无替换编码 + `validate_cp936_structure` 严格帧校验」判定；GBK 普通保存还要求经现有打开流程重开后仍识别为 GBK 且内容一致，否则返回 `EncodingAmbiguous`（纯 ASCII/空也因编码身份无法保持而拒绝，见 D-006）。`line_ending.rs` 的 `normalize` 统一到 LF/CRLF，`Mixed` 返回错误。`save.rs` 的 `save_document`：先 `canonicalize` 解析符号链接到真实目标，再对真实目标做「描述符只读前置 → 规范化与编码 → 50 MiB 限制 → 初次冲突检测 → 初次只读快检 → 同目录原子替换」（`rename` 前再次校验冲突与只读/权限）；原子替换用标准库 `OpenOptions::create_new` + `fs::rename`（无新依赖），任一步失败清理临时文件、原文件不变。**冲突检测与只读/权限保护均为 best-effort**：再次校验/权限设置与 `rename` 之间残留狭窄 TOCTOU 窗口（跨平台无严格 CAS/权限原子替换），规格与代码注释据此降级。`test_support.rs` 的 `TestDir`（PID+纳秒+RAII）消除跨进程撞名。`error.rs` 含 `ReadOnly`、`MixedLineEndingNotChosen`、`UnencodableContent { character, byte_offset }`、`SaveConflict`、`EncodingAmbiguous`，`Io` 仅 OS 文本不泄露临时路径。长期规格已同步：`DECISIONS.md` D-006、`basic-text-editing.md` 行为规则；`README.md` 改为「已完成」。
- **验证**：`cargo fmt --check`、`cargo check --all-targets`、`git diff --check` 通过；`cargo test` 默认并发 **68 passed**、`--test-threads=1` 串行 68 passed、两测试二进制进程并发各 68 passed（PID 临时目录隔离）；`npm run check` 通过（25 passed，未改前端）；`npm run tauri -- build` 通过并生成 `Textora.app`。覆盖三编码往返、纯 ASCII/空以 GBK 保存时因无法保持编码身份而拒绝、「一」`EncodingAmbiguous` 拒绝且证明误读、「一 中」混排可编码重开、BOM 恰好一个、LF/CRLF/Mixed、CP936 不可表示字符位置、50 MiB 超限、缺失/外部修改冲突、best-effort 再次校验保留外部内容并清临时文件、只读前置拒绝、打开后变只读重检、`before_replace` 阶段 `chmod 0444` 最终重检拒绝、`0600` 保留、只读目录模拟创建失败、**符号链接保存链接保留且目标更新**、成功无临时残留且指纹与磁盘一致。Clippy 未运行（stable 工具链缺组件）。Windows 的 rename/符号链接/NTFS 权限行为待对应环境确认。

### 接入本地文件打开流程

- **状态**：已完成
- **完成日期**：2026-07-20
- **Feature Spec**：`docs/features/open-local-file.md`
- **结果**：打通系统文件选择、Rust 一致快照与严格解码、二进制 IPC、React 文档会话和 CodeMirror 编辑器。错误使用稳定代码映射且不泄露内部路径；读取失败前不替换原文档；加载期间编辑器只读且不可重复触发；前端未获得宽泛文件系统、shell 或网络权限。
- **验证**：`cargo fmt --check`、`cargo check --all-targets`、`cargo test`（40 passed）、`npm run check`（typecheck + vitest 25 passed）、`npm run build` 与 `npm run tauri -- build` 均通过；macOS 原生界面已验证确认与取消保护、UTF-8/ASCII/UTF-8 BOM/CP936 成功路径、继续输入与焦点，以及非法编码、GB18030 四字节和超过 50 MiB 的错误保护。读取失败、读取期间变化、加载只读与禁止重复触发由确定性自动化测试覆盖。Windows 尚未验证。

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
- 本地文件打开切片已完成实现、自动化验证与 macOS 原生界面验收：无路径参数的 Tauri `select_and_open_document` 在 Rust 侧选择并打开文件，`read_document_content` 通过原始二进制响应传输内容；前端 capability 未获得 dialog、文件系统、shell 或网络权限。
- Windows 文件打开验证仍需在对应环境执行。Rust 文档编码与安全保存核心已完成审查修复并通过 macOS 验证（fmt/check/test 68 并发+串行+跨进程/tauri build/git diff --check；Clippy 因组件缺失未运行）：`save_document` 为内部接口（未暴露为 Tauri 命令）；CP936 可表示性用「无替换编码 + 严格帧校验」判定，普通保存还要求重开后仍识别为 GBK 且内容一致，否则返回 `EncodingAmbiguous`（纯 ASCII/空因编码身份无法保持也拒绝，见 D-006）；保存先 `canonicalize` 解析符号链接到真实目标再原子替换（链接保留、目标更新）；冲突检测与只读/权限保护均为 best-effort（再次校验/权限设置与 rename 之间残留 TOCTOU，规格已如实降级）；测试临时目录 PID+纳秒+RAII。
- 下一项已承诺任务为 `save-opened-file.md`：只接入已打开文件的普通保存，后端以文档 ID 绑定可信路径与保存元数据，正文使用二进制 IPC；另存为、编码转换、Mixed 换行选择、冲突解决、关闭保护与多标签留待后续切片。
