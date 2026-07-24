# 当前任务

个人项目同时最多一个任务处于进行中。此文件只保留已承诺、可执行的近期工作，不保存候选想法。

## 进行中

暂无进行中的任务。下一个已承诺待办为「处理关联文件缺失」。

## 最近完成

### 接入内容冲突的强制覆盖

- **状态**：已完成
- **开始日期**：2026-07-24
- **完成日期**：2026-07-24
- **Feature Spec**：`docs/features/resolve-save-conflict.md`
- **结果**：后端新增异步 `force_overwrite(id)`，只使用 Rust 可信状态中的 ContentChanged 冲突快照、路径、编码和换行信息；确认后重新观测目标，以 `SaveTarget::ExistingTarget` 复用编码、大小、只读、权限、竞争复核、符号链接和原子保存保护。新增绑定文档 ID 与冲突 revision 的覆盖租约：覆盖期间取消、重新加载、重复覆盖、候选文档提升及其他可信状态更新均被拒绝；失败只释放租约并保留冲突，成功则在同一锁内复核租约和 revision、更新可信指纹与字节数并清除冲突，过期提交不能清除更新后的冲突。前端增加 Overwrite 破坏性操作并与 Cancel/Reload 共用互斥状态；成功清脏，失败保留可操作提示。测试环境补齐 jsdom 缺失的 `Range.getClientRects`，消除 CodeMirror 延迟测量产生的非确定性未处理错误。
- **验证**：`cargo fmt` 已执行，`cargo fmt --check`、`cargo check --all-targets`、`git diff --check` 通过；`cargo test` **98 passed / 0 failed**，新增覆盖租约互斥、失败释放、原子提交、过期 revision、真实文件成功覆盖及目标缺失失败保留；`npm run check` 连续两次均为 **49 passed / 0 failed**，新增覆盖成功、稳定失败提示及三操作互斥；`npm run build` 通过。既有保存核心测试继续覆盖确认后再次变化、只读、不可编码、编码歧义、Mixed、超限、符号链接和失败时原文件保护。Clippy 未运行（缺组件）；macOS 交互验收与 Windows 验证待集成验收任务执行。

### 接入内容冲突的取消与重新加载

- **状态**：已完成
- **完成日期**：2026-07-23
- **Feature Spec**：`docs/features/resolve-save-conflict.md`
- **结果**：后端新增 `cancel_conflict` 与 `reload_from_conflict`，且只接受当前活动文档的 `ContentChanged` 冲突；未知、过期、已解决或其他冲突类型明确拒绝。每次冲突具有仅存于 Rust 可信状态的内部版本：重新加载经 `open_document` 取得一致磁盘快照后，必须在同一锁内复核文档 id、类型和版本才能发布候选；`read_document_content` 提升候选时再次复核，Cancel 会同时使已发布但未取回的候选失效，避免取消/重复操作/会话变化后的旧结果覆盖编辑内容。读取失败保留冲突供重试。前端显示 Cancel/Reload 通知并用单一操作状态禁用重复或交叉操作；失败时保留稳定的具体读取错误和可操作冲突状态；Escape 复用取消流程。冲突期间编辑器锁定，打开、保存和另存为禁用。
- **验证**：`cargo fmt` 已执行；`cargo check --all-targets`、`git diff --check` 通过；`cargo test` **93 passed / 0 failed**（含内容冲突类型约束、过期版本拒绝、Cancel 使已发布候选失效、候选取回二次复核及既有读取失败保护）；`npm run check` **46 passed / 0 failed**（含重新加载成功、具体失败原因保留、Cancel/Reload 串行及 Escape 取消）；`npm run build` 通过。Clippy 未运行（缺组件）；macOS 交互验收与 Windows 验证待执行。

### 建立保存冲突分类与后端可信状态

- **状态**：已完成
- **完成日期**：2026-07-23
- **Feature Spec**：`docs/features/resolve-save-conflict.md`
- **结果**：在 `ipc.rs` 增加 `ConflictKind { ContentChanged, TargetMissing }` 与 `ConflictState { kind, snapshot, trusted }`。`DocumentStore` 通过 `record_conflict` 把活动文档 id、完整编辑快照和可信描述绑定到待解决状态；首次冲突不更新指纹、字节数或描述信息。候选打开只有在内容成功取回并提升为活动文档后才清除旧冲突；查询冲突不提前消费，后续解决命令须在成功或明确取消后才清除。`classify_conflict(path)` 只把 `NotFound` 归为目标缺失，其他 `metadata` 错误保留为安全的 I/O 失败。`save_document` 返回稳定代码 `save-conflict-content-changed` / `save-conflict-target-missing`（`save_document_as` 的冲突仍用 `save-conflict`）。前端已同步错误代码，但在操作界面交付前只显示安全拒绝说明，不宣传尚不可用的重新加载、覆盖、保留或放弃操作。
- **验证**：`cargo fmt` 已执行；`cargo check --all-targets`、`git diff --check` 通过；`cargo test` **87 passed / 0 failed**（新增并修正冲突分类、非 `NotFound` I/O、可信状态记录与非消费读取、过期 id、候选打开提交边界、会话成功切换清理及错误映射测试）；`npm run check` **41 passed / 0 failed**（含新增错误代码识别与未完成操作不提前展示测试）。Clippy 未运行（缺组件）。

## 已承诺待办

### 处理关联文件缺失

- **状态**：待开始
- **Feature Spec**：`docs/features/resolve-save-conflict.md`
- **目标**：应用重新聚焦或普通保存发现关联文件缺失时，让用户明确选择保留当前内容并解除路径关联，或放弃内容并关闭文档。
- **范围**：交付聚焦检查的去重和过期保护、普通保存缺失路由、保留/关闭提示、安全默认语义、保留后的首次保存路径，以及关闭后的空白文档状态。
- **非范围**：不持续监听文件，不自动重建原路径，不接入通用未保存关闭保护。
- **依赖**：完成“建立保存冲突分类与后端可信状态”；内容冲突界面的公共互斥能力可复用但不能混淆两类提示。
- **完成标准**：自动化测试覆盖聚焦去重、忙碌与 Untitled 跳过、过期结果、保留、关闭、Escape/关闭提示、再次失焦及普通保存发现缺失；相关前后端检查通过并记录。

### 完成保存冲突解决集成验收

- **状态**：待开始
- **Feature Spec**：`docs/features/resolve-save-conflict.md`
- **目标**：验证内容变化与文件缺失所有子流程可以共同工作，并完成保存冲突解决 Feature 的回归、平台验收和文档收尾。
- **范围**：检查打开、普通保存、另存为、冲突提示和聚焦检查之间的互斥与组合状态；覆盖符号链接、安全默认操作、重复点击及成功/失败/取消后的会话一致性；执行完整自动化、构建和 macOS 真实文件交互验收。
- **非范围**：不扩展到未保存关闭保护、多标签、持续监听、差异合并或 Windows 环境之外的替代验证。
- **依赖**：以上四个实现任务全部完成。
- **完成标准**：满足 `resolve-save-conflict.md` 全部验收条件；运行并记录适当的 Rust/前端测试、格式化、静态检查和构建；完成 macOS 交互验收，明确记录 Windows 待验证项；同步 Feature Spec 验证记录、README 状态和本文件最终状态。

## 最近完成

### 实现另存为与新建文档首次保存

- **状态**：已完成；Windows 验证待对应环境执行
- **完成日期**：2026-07-22
- **Feature Spec**：`docs/features/save-as-and-first-save.md`
- **结果**：通过 Rust 侧 `blocking_save_file` 取得可信目标，交付 Untitled 首次保存与已有文档另存为，并支持 UTF-8/UTF-8 BOM/GBK 与 LF/CRLF 显式选择。保存核心新增 `SaveTarget { InPlace, ExistingTarget, NewTarget }`：`InPlace` 由核心校验源只读（遵守 `safe-save-core`），另存为跳过该检查；`NewTarget` 用同目录临时文件 + `sync_all` + `std::fs::hard_link` 原子且不覆盖提交（不直接对目标 `create_new`），异常仅清理唯一命名临时文件。新增异步 `save_document_as`：对话框返回后首次观测目标并路由（选当前原路径→`InPlace` 不绕过冲突保护；已存在不同目标→`ExistingTarget{observed}`；不存在→`NewTarget`），成功后更新或建立可信关联（首次保存生成新 id）。格式/id 经 header、内容经 Raw body。前端：应用内格式选择 UI、Save（Untitled→首次保存/已开→普通保存）、Save As 入口、忙碌互斥、成功关联/失败保留/取消恢复。`capability` 仍仅 `core:app:default`。竞争保护从对话框返回后首次观测开始，best-effort，OS 确认到首次观测之间窗口不可关闭（已在规格记录）。
- **验证**：`cargo fmt --check`、`cargo check --all-targets`、`git diff --check` 通过；`cargo test` 默认并发 **78 passed**、`--test-threads=1` 串行 78 passed、两测试进程并发各 78 passed；`npm run check` **40 passed**，`npm run build` 与 `npm run tauri -- build` 通过并生成 `Textora.app`；`./script/build_and_run.sh --verify` 成功启动应用。macOS 原生交互已验收空白首次保存、连续保存、UTF-8 BOM/GBK 与 LF/CRLF、取消、Mixed 转换、不可编码/歧义后改选 UTF-8、只读源与目标、已有目标覆盖确认、当前原路径冲突保护及符号链接连续保存，并核对磁盘字节与原文件保护；目标竞争和 50 MiB/通用 I/O 失败由确定性自动化覆盖。Clippy 未运行（缺组件）；Windows 验证待对应环境执行，详见 Feature Spec。

### 接入已打开文件的普通保存流程

- **状态**：已完成
- **完成日期**：2026-07-22
- **Feature Spec**：`docs/features/save-opened-file.md`
- **结果**：把 Rust 安全保存核心接入受限二进制 IPC、后端文档状态与单文档前端会话。`DocumentStore` 将新选择的文件保持为候选，只有内容按正确 id 成功取回时才替换当前可信文档，避免读取失败后旧文档无法保存；异步 `save_document` 经 Raw body + `textora-document-id` 接收请求，并用 `spawn_blocking` 执行编码、文件 I/O 与同步。打开/保存错误分别映射，保存新增 `save-failed`；前端会话保留完整 `saveError`，使用保存专用文案并展示不可编码字符的码点与偏移。`App.tsx` 提供 Save 入口、忙碌互斥、成功清脏与失败保留；`capability` 仍仅 `core:app:default`。
- **验证**：`cargo fmt --check`、`cargo check --all-targets`、`git diff --check` 通过；`cargo test` **71 passed**；`npm run check` **35 passed**；`npm run tauri -- build` 通过并生成 `Textora.app`，打开 `.app` 后进程启动。用户于 2026-07-22 确认完成规格所列 macOS 真实文件交互验收，包括 UTF-8、UTF-8 BOM、可无损重开的 CP936 成功路径及冲突、只读、超限、不可编码与编码歧义等失败保护。Clippy 未运行（缺组件）；Windows 验证待对应环境执行。

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
- `save-opened-file.md` 已完成实现、自动化验证与 macOS 真实文件交互验收：后端候选打开不会提前覆盖当前可信文档，异步 `save_document` 经 Raw body + header 接收内容并在阻塞线程复用安全保存核心，前端保留完整保存错误并使用保存专用提示；capability 未新增宽泛权限。Windows 验证待对应环境执行。
- 「另存为与新建文档首次保存」已完成实现、自动化验证与 macOS 原生交互验收（cargo test 78 并发+串行+跨进程 / npm check 40 / build / tauri build / 启动验证）：Rust 侧系统保存对话框取得可信目标，`SaveTarget` 区分普通保存/另存已存在/新建（`NewTarget` 用临时文件+`hard_link` 原子不覆盖提交），源只读校验仅 `InPlace` 在核心执行；过期 id 写盘前拒绝，符号链接选择路径在会话中保留；前端含应用内格式选择 UI 与空白 Untitled Save/已有文件 Save As 入口。竞争保护从对话框返回后首次观测开始、best-effort；Windows 验证待对应环境执行。
- 「保存冲突解决」规格已确认并于 2026-07-23 进入实现，已按任务颗粒度规则拆为五个顺序任务：后端冲突分类与可信状态、取消与重新加载、强制覆盖、关联文件缺失处理、集成验收。当前仅第一个任务进行中，尚未修改实现代码或执行功能验证；后四个是已承诺待办，须按依赖逐个进入进行中。关闭未保存保护和多标签仍在 Backlog，尚未承诺。
