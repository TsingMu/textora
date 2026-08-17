# 启动时恢复上次打开的文件

> 状态：已完成

## 背景与目标

Textora 已支持单窗口多标签，但每次进程重新启动都会回到一个空白 `Untitled`，用户需要重新逐个选择此前正在处理的文件。目标是在下次启动时自动恢复上次仍打开的本地文件标签及其顺序，并尽量回到上次活动文件，同时继续复用现有文件安全、编码、大小限制与失败保护链路。

## 范围

- 记录当前会话中仍打开的**已关联本地文件**路径、标签顺序和活动文件标识。
- 应用进程下次启动时自动重新打开这些文件，恢复成功的文件按原顺序创建标签。
- 上次活动标签若为可恢复文件且本次恢复成功，则恢复为活动标签；否则选择最后一个成功恢复的文件。
- 没有可恢复文件或全部恢复失败时，保持现有单个空白 `Untitled` 启动行为。
- 恢复必须重新读取当前磁盘内容与元数据，并经过现有大小、编码、换行、只读和重复路径身份规则。
- 会话清单在成功打开、Save As 建立/改变文件关联、关闭文件标签、切换活动标签后及时更新，不只依赖正常退出事件。

## 非范围

- 不恢复未保存 `Untitled` 标签、未保存编辑内容、撤销/重做历史、选区、光标、滚动位置或临时错误/确认框。
- 不做自动保存、崩溃内容恢复、备份、版本历史或“最近关闭标签”。
- 不恢复 Markdown Preview、WYSIWYG、Mermaid Preview 等每标签显示模式；恢复后的文件使用现有默认模式。
- 不增加“打开上次会话”确认弹窗、最近文件列表、项目/工作区概念或多窗口会话。
- 不允许前端提交任意路径要求 Rust 读取，也不扩大 Tauri 文件系统 capability。

## 用户流程

1. 用户打开若干本地文件并按需要切换、关闭标签。
2. Textora 在文件标签集合或活动文件变化后更新应用自有的恢复清单。
3. 用户正常退出、系统结束应用或下次重新启动 Textora。
4. Textora 读取恢复清单，通过 Rust 文档核心重新打开各文件。
5. 成功项按原顺序显示；失败项不阻止其他文件和应用启动，并以非模态汇总提示说明未恢复数量与原因。

## 行为规则与边界情况

- “上次打开”指进程结束前最近一次成功持久化的文件标签集合；窗口隐藏后再次显示仍沿用内存中的当前标签，不重复执行恢复。
- 恢复清单由 Rust 在应用数据目录管理。前端只提交由后端可信文档状态产生的文档 ID、标签顺序与活动标识，Rust 从可信状态提取路径；前端不得传入新路径作为恢复读取目标。
- 清单只保存恢复所需的最小信息，不保存文件内容、编码副本、指纹、访问授权、错误详情或用户编辑。
- 清单写入应原子化；缺失、空、版本未知、字段无效、截断或无法读取时安全回退为单个 `Untitled`，不得阻止启动。
- 恢复逐项独立：文件缺失、无权限、超过 50 MiB、编码不支持或读取竞争只跳过该项，其他文件继续恢复。
- 同一路径及符号链接别名仍按现有规范化选择路径/真实路径规则去重，不得恢复成两个标签或两个后端可信文档。
- 恢复期间显示明确的加载状态并锁定会与恢复结果竞争的打开/保存/关闭操作；恢复完成后解除。首个可用界面不得长期等待单个失败项。
- 恢复失败的路径在本次启动完成后从下一份清单移除，避免每次启动重复报错；用户可通过现有 `Open` 再次选择该文件。
- 文件内容以启动时磁盘版本为准。上次会话未保存的编辑仍由既有关闭保护处理；本功能不承诺恢复被用户明确选择“不保存”的内容。
- 成功恢复后外部文件监听、保存冲突、文件缺失和只读同步与普通打开文件完全一致。

## 验收条件

- [x] 关闭并重新启动应用后，上次仍打开的已关联文件按原标签顺序恢复，磁盘内容与元数据来自本次重新读取。
- [x] 上次活动文件恢复成功时重新成为活动标签；活动文件失败或原活动标签为 `Untitled` 时，最后一个成功恢复的文件成为活动标签。
- [x] `Untitled`、未保存内容、撤销历史、选区、滚动位置和 Preview/WYSIWYG 状态不被持久化或恢复。
- [x] 成功打开、Save As、关闭标签和活动文件切换会更新恢复清单；异常结束后仍能使用最近一次成功写入的清单。
- [x] 缺失、无权限、超限、编码失败或读取竞争只跳过对应文件，其他文件继续恢复，并显示非阻塞汇总提示。
- [x] 清单缺失、损坏、未知版本或无法读取时应用正常启动并显示一个 `Untitled`。
- [x] 重复路径与符号链接别名不会产生重复标签；恢复后的文件继续使用普通保存、冲突、缺失和外部变更监听链路。
- [x] 前端不能借恢复接口读取任意路径；不新增宽泛文件系统、shell、网络或远程页面权限。
- [x] 自动化覆盖清单序列化/原子写入、可信状态投影、顺序与活动项、部分/全部失败、损坏回退、重复路径和启动竞态。
- [x] `npm run check`、`npm run build`、`cargo fmt --manifest-path src-tauri/Cargo.toml --check`、`cargo test --manifest-path src-tauri/Cargo.toml`、`npm run tauri -- build` 与 `git diff --check` 通过；macOS release 真实应用验收覆盖多文件重启恢复和单项缺失退化。

## 依赖与约束

- 依赖已完成的多标签会话、本地文件打开、Rust 多文档可信状态、外部文件变化同步和关闭保护。
- 遵守 `docs/ARCHITECTURE.md` 的 Rust 文件安全边界、二进制内容 IPC、源码权威、失败不阻塞编辑和前端最小权限不变量。
- 现有 `select_and_open_document` 明确只读取系统文件面板中由用户实际选择的路径；恢复功能应新增受应用自有清单约束的 Rust 启动恢复入口，不得把它改成前端任意路径读取接口。
- 恢复清单是应用级用户状态，不属于文档内容或 `DocumentStore` 的运行期冲突状态；格式需要版本字段，以便未来安全忽略不兼容数据。
- 应用窗口关闭在无脏文档时可能只是隐藏；恢复只在新进程启动阶段执行一次。

## 已确认决议

1. **恢复对象**：首期只恢复仍打开的已关联文件、标签顺序与活动文件。`Untitled`、未保存内容、撤销历史、选区、滚动位置及每标签显示模式均不恢复；若没有成功恢复的文件则创建现有默认 `Untitled`。
2. **失败体验**：启动逐项恢复，单项失败不阻止其他文件；完成后显示一次非模态汇总提示。失败项不创建占位标签，并从本次恢复完成后生成的下一份清单移除，避免永久重复报错；用户可通过现有 `Open` 再次选择。
3. **持久化所有权**：Rust 使用 `app.path().app_data_dir()` 下的版本化 JSON 清单，不把路径存入 WebView `localStorage`。清单结构首版为 `version: 1`、有序文件路径和可选活动项索引；未知版本或无效结构整体忽略。
4. **信任边界**：前端更新清单时只提交当前标签顺序对应的后端可信文档 ID 与可选活动文档 ID；Rust 必须从 `DocumentStore` 投影路径并验证活动 ID 属于列表。启动恢复只能读取 Rust 自有清单中的路径，不能把 `select_and_open_document` 改造成前端任意路径入口。
5. **更新时序**：成功打开、Save As、关闭文件标签或活动文件变化后提交新投影；每次调用携带当前进程单调递增的 generation，Rust 只允许较新 generation 写入，避免异步迟到请求把旧标签集合覆盖到磁盘。清单写入失败只产生非模态状态提示，不回滚标签或污染文档状态。
6. **原子写入**：清单目录按需创建；同目录唯一临时文件写入完整 JSON 并 `sync_all` 后原子替换目标，必要时同步父目录。失败只清理本次临时文件并保留上一份完整清单；不复用面向用户文件的编码、冲突或授权语义。
7. **启动协议**：新进程只执行一次恢复命令。Rust 读取并校验清单、按顺序去重后逐项调用现有 `document::open_document`，成功项进入 `DocumentStore` 并返回描述符、原清单索引和失败摘要；前端再通过既有二进制 `read_document_content` 逐项取回内容，成功采用后建立外部监听。读取正文阶段失败的条目也按单项失败清理，不阻止完成启动。

## 任务拆分

1. **确认启动文件恢复规格与安全协议**（已完成）：确认恢复对象、活动标签、失败退化、清单所有权与前后端信任边界；只修改规划文档。
2. **建立 Rust 恢复清单与可信投影契约**：实现版本化清单、原子写入、损坏回退，以及从 `DocumentStore` 可信文档 ID 生成有序路径清单；不接 React 启动流程。
3. **接入启动批量恢复与前端标签采用**：启动时逐项恢复，按顺序建立标签和活动项，处理重复/部分失败/加载锁定，并在标签集合变化后更新清单。
4. **启动文件恢复集成验收与文档收尾**：完整自动化、前端/Rust/release 构建、macOS 重启与缺失文件真实验收及文档同步；只做必要小修。

## 验证记录

- 2026-08-14 规划检查：现有 `docs/features/multi-tab-session.md` 明确把“启动时恢复上次会话”列为非范围；`src/tabSession.ts` 每次固定创建单个 `Untitled`；`select_and_open_document` 刻意只接受系统文件面板真实选择，不允许前端传入任意路径。为保持安全边界，草案采用 Rust 应用数据目录中的版本化最小清单，并只从后端可信文档 ID 投影路径；首期恢复文件标签顺序与活动文件，不恢复内容快照、Untitled、撤销或显示模式。本轮未修改实现代码，未运行测试或构建。
- 2026-08-14 规格确认：核对本地 `tauri 2.11.5` 的 `app.path().app_data_dir()`、现有 `DocumentStore` 可信路径与 `read_document_content` 建立外部监听的时序，以及用户文件原子保存模式。确认 Rust 版本化 JSON 清单、可信 ID 投影、generation 拒绝迟到写、同目录临时文件原子替换、启动逐项 `open_document` + 二进制内容取回、失败非模态汇总并从下一清单移除。规格已无影响实现的开放问题；本任务只修改规划文档，未修改生产代码、实现性测试或依赖，未运行测试或构建；`git diff --check` 通过。
- 2026-08-14「建立 Rust 启动恢复清单与可信投影契约」：新增 `src-tauri/src/session_restore.rs`，交付 `version: 1` JSON 清单、绝对路径/数量/重复/活动索引校验、缺失/空/损坏/未知版本安全分类、`app_data_dir` 路径入口、同目录唯一临时文件完整写入与 `sync_all` 后原子替换、失败清理和 generation 迟到写门禁。`DocumentStore::project_restore_manifest` 在一次锁内把有序可信文档 ID 投影为路径与活动索引，拒绝未知、重复或未列出的活动 ID；未新增 IPC、前端启动逻辑或应用行为。`serde_json` 作为直接 Rust 依赖声明（此前仅为传递依赖）。验证：定向清单测试 **5 passed / 0 failed**、可信投影测试 **2 passed / 0 failed**；`cargo fmt --manifest-path src-tauri/Cargo.toml --check` 通过；`cargo test --manifest-path src-tauri/Cargo.toml` 通过（**155 passed / 0 failed**）；`npm run check` 通过（typecheck + vitest **414 passed / 0 failed**）；`git diff --check` 通过。
- 2026-08-17「接入启动批量恢复与前端标签采用」：清单 store 接入 Tauri managed state 并新增一次性恢复门禁。新增 `restore_session_documents`（只读 Rust 自有清单、按 `same_path_identity` 顺序去重、逐项 `open_document` 进候选缓冲，返回描述符/清单索引/失败摘要/建议活动索引）与 `update_open_files_manifest`（锁内可信 ID 投影 + generation 门禁原子写入；迟到/过期投影静默拒绝，写入失败返回 `session-manifest-write-failed`）；两命令的文件 I/O 均在 `spawn_blocking`。前端挂载一次性恢复：逐项二进制取回、`adoptRestoredTabs` 按序建标签并按建议索引定活动项（回落最后成功项）、正文取回失败单项 `close_document` 清理、恢复期间锁定编辑与打开/保存/关闭/切换、失败显示一次可关闭非模态汇总、失败项随下一份只含成功项的投影移除；恢复完成后标签集合/活动标签变化提交递增 generation 投影，写入失败仅非模态提示。验证：`cargo fmt --manifest-path src-tauri/Cargo.toml --check` 通过；`cargo test --manifest-path src-tauri/Cargo.toml` 通过（**161 passed / 0 failed**，新增 6 项恢复/更新契约用例）；`npm run check` 通过（typecheck + vitest **425 passed / 0 failed**，新增 `adoptRestoredTabs`、IPC 封装与 App 恢复/锁定/投影/提示 11 用例）；`npm run build` 通过；`git diff --check` 通过。未运行 release 构建与 macOS 真实应用重启验收（留给集成验收任务）。
- 2026-08-17「启动文件恢复集成验收与文档收尾」：完整回归与 release 构建通过。macOS release `Textora.app` 真实验收使用临时 `alpha.txt`、`beta.txt`：首次重启按 alpha→beta 顺序恢复且 beta 保持活动，退出后修改 beta 再启动显示新磁盘内容；删除 alpha 后再次启动仅恢复 beta，并显示一次可关闭的单项失败非模态汇总；下一次重启不再重复提示 alpha，确认失败项已从清单移除。恢复后的 beta 能实时采用外部内容变化，编辑后普通保存成功写回磁盘。关闭最后一个文件标签后清单回到空集合，应用与临时文件均已清理。验证：`cargo fmt --manifest-path src-tauri/Cargo.toml --check`、`cargo test --manifest-path src-tauri/Cargo.toml`（**161 passed / 0 failed**）、`npm run check`（**425 passed / 0 failed**）、`npm run build`、`npm run tauri -- build` 与 `git diff --check` 通过；release bundle `CFBundleIdentifier=com.tsingmu.textora`、`CFBundleExecutable=textora`，`src-tauri/capabilities/` 无变更。Vite 大 chunk 提示为既有，不影响本功能。
- 2026-08-17「修复启动恢复批量缓冲与外部变化竞态」：审查修复两项缺陷。(1) 资源边界：批量恢复命令重构为逐项推进的 `restore_next_session_document`（managed `SessionRestoreCursor`；每次至多打开一个清单文件，确定要打开下一个文件时先释放上一条未取回的候选缓冲——无论前端行为如何，后端同时至多缓冲一个恢复文件，清单耗尽时最后一条保留供取回），消除合法大清单一次性缓冲全部文件造成的内存占用与启动锁定。(2) 外部变化竞态：前端恢复改为逐项「推进→二进制取回→立即采用为标签」，恢复期间到达的外部变化事件即可找到归属标签走既有处理链路；恢复完成后新增一次与聚焦兜底共用的可信复核 `refreshAllExternalDocuments`，补上采用前到达的被丢事件。验证：`cargo fmt --manifest-path src-tauri/Cargo.toml --check`、`cargo test --manifest-path src-tauri/Cargo.toml`（**161 passed / 0 failed**，含 3×512 KiB 连续推进不取回时仅最后一条缓冲保留的资源边界测试）、`npm run check`（typecheck + vitest **426 passed / 0 failed**，含「第二个文件读取被延迟时第一个文件发生外部修改」用例：事件未被丢弃、第一文件内容刷新为外部版本、完成后逐文件复核）、`npm run build`、`npm run tauri -- build` 与 `git diff --check` 通过；capability 无变更。
- 2026-08-17「修复恢复中断处理」：恢复状态增加 `interrupted`，只有明确收到 `done` 才进入完成态并放行清单投影；推进命令 reject 时保留已采用标签、不写任何投影（磁盘清单保持启动时版本，未处理文件留给下次启动），显示非模态错误并提供经同一后端游标续跑的 Retry（清单活动索引与索引→标签映射跨运行保留，成功后才写完整投影）。验证：`cargo fmt --manifest-path src-tauri/Cargo.toml --check`、`cargo test --manifest-path src-tauri/Cargo.toml`（**161 passed / 0 failed**）、`npm run check`（typecheck + vitest **429 passed / 0 failed**，含「首个推进 reject 不写空清单」「采用第一项后推进 reject 不写部分清单」与重试续跑用例）、`npm run build`、`npm run tauri -- build` 与 `git diff --check` 通过。
- 2026-08-17「修复恢复重试时用户未保存标签被静默丢弃」：`finalizeRestoredTabs` 显式接收初始占位标签 ID，只在该标签仍干净、为空、未变脏且不处于打开/保存流程时移除；中断期间用户编辑的初始 Untitled 与新建的其他无路径标签在重试成功后一律保留（`nextUntitledNumber` 不重置防编号冲突），活动标签建议未命中时保留仍存在的当前活动标签、最后回落最后文件标签。验证：`npm run check`（typecheck + vitest **433 passed / 0 failed**，含编辑初始 Untitled 后重试、新建并编辑 Untitled 后重试、未触碰占位正常移除用例）、`npm run build`、`cargo fmt --manifest-path src-tauri/Cargo.toml --check`、`cargo test --manifest-path src-tauri/Cargo.toml`（**161 passed / 0 failed**）、`npm run tauri -- build` 与 `git diff --check` 通过。
- 2026-08-17「修复恢复中断后手动打开文件的重复恢复」：`DocumentStore::active_document_for_path` 在锁内快照活动文档 (id, path)、锁外按既有路径身份规则比较；恢复推进在打开文件前检查，目标已打开（中断期间经 Open/Save As）时返回 `already-open` 步（文档 id + 清单索引，不重复读取或建第二个后端文档），前端把清单索引映射到现有标签，活动项建议与回落覆盖它。验证：`cargo fmt --manifest-path src-tauri/Cargo.toml --check`、`cargo test --manifest-path src-tauri/Cargo.toml`（**163 passed / 0 failed**，含 Open 后 Retry 无重复、符号链接别名识别、双文档投影不 rejected）、`npm run check`（typecheck + vitest **434 passed / 0 failed**，含中断后手动打开再 Retry 的映射/活动标签/无重复标签/投影用例）、`npm run build`、`npm run tauri -- build` 与 `git diff --check` 通过。
- 2026-08-17「恢复失败摘要跨中断与重试累积」：单项失败摘要改为进程内累积 ref，中断提示与最终完成提示覆盖本次启动期间（含多次 Retry）的全部失败文件；最终清单投影仍只含成功文件。验证：`npm run test -- App -t "session restore"`（**15 passed / 0 failed**，含 failed 后 reject、Retry 成功 done 后提示仍含先前失败文件且投影只含成功文件）、`npm run check`（typecheck + vitest **435 passed / 0 failed**）与 `git diff --check` 通过。
- 2026-08-17「恢复失败摘要与清单写入失败同时展示」：单提示槽拆为 `sessionRestoreNotice`（恢复失败汇总/中断信息，附 Retry）与 `manifestNotice`（清单写入失败）两个独立非模态块，各自可关闭、互不覆盖。验证：`npm run test -- App -t "session restore"`（**16 passed / 0 failed**，含 failed+done 且清单写入 reject 时两提示并存并可分别关闭）、`npm run check`（typecheck + vitest **436 passed / 0 failed**）与 `git diff --check` 通过。
- 2026-08-17「清单写入提示按最新 generation 门禁」：清单投影回调绑定请求 generation——仅最新失败设置 `manifestNotice`、最新成功（含 written/stale/rejected 正常返回）清除旧提示、迟到旧请求无论成败不改变提示状态。验证：`npm run test -- App -t "session restore"`（**18 passed / 0 failed**，含失败后第二次成功写入清除提示、旧请求迟到失败不覆盖较新成功）、`npm run check`（typecheck + vitest **438 passed / 0 failed**）与 `git diff --check` 通过。
