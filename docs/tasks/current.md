# 当前任务

个人项目同时最多一个任务处于进行中。此文件只保留已承诺、可执行的近期工作，不保存候选想法；“最近完成”按完成时间倒序最多保留 3 个任务，旧记录由 Git 历史承载。

## 进行中

（无）

## 已承诺待办

### 语法模式集成验收与文档收尾

- **状态**：待开始
- **Feature Spec**：`docs/features/unsaved-document-language-mode.md`
- **目标**：在 release `Textora.app` 中确认原生语法菜单、标签隔离与首次保存建议的完整组合行为，并完成该 Feature 的验证和文档收尾。
- **范围**：运行前后端完整自动化、格式检查、前端构建与 Tauri release 构建；在 macOS 真实应用中验收 `View > Syntax` 的可用/禁用与单选同步、多个 Untitled 标签隔离、Markdown/Mermaid 专属入口边界、带编号建议名、用户改名、取消/失败保留及成功后实际路径识别；按实际结果更新 Feature Spec、README、backlog 与当前任务；只处理验收阻塞所需的小修。
- **非范围**：不新增语法模式、后缀规则、格式专属能力或其他主要用户行为；若验收暴露需要大块新实现的问题，应另行拆出任务而不是扩张本任务。
- **依赖**：完成「首次保存采用语法模式建议文件名」，且临时语法模式与原生菜单实现保持可构建、可测试。
- **拆分检查**：本任务不再承担未实现的主要行为，只负责已完成切片的组合回归、release/真实平台确认、必要小修和文档状态翻转，符合较大 Feature 最后一个集成验收任务的边界。
- **实施要点**：先执行自动化与 release 构建，再部署或启动实际产物进行菜单和保存流程验收；只勾选实际验证通过的验收条件；完成时按规则清理“最近完成”至最多 3 项。
- **完成标准**：Feature Spec 验收条件全部有真实结果；`npm run check`、`npm run build`、`cargo fmt --manifest-path src-tauri/Cargo.toml --check`、`cargo test --manifest-path src-tauri/Cargo.toml`、`npm run tauri -- build` 与 `git diff --check` 通过；用户确认 macOS release 真实应用组合验收通过；Feature Spec 状态、README、backlog 和 `current.md` 同步且最近完成不超过 3 项。

## 最近完成

### 修复语法菜单锁定状态与事件回滚缺陷

- **状态**：已完成
- **开始日期**：2026-08-21
- **完成日期**：2026-08-21
- **Feature Spec**：`docs/features/unsaved-document-language-mode.md`
- **目标**：交互锁定（保存面板、冲突等待等 busy）期间原生 `View > Syntax` 禁用并清除勾选、解锁后恢复；菜单事件发送失败的回滚恢复点击前而非点击后的勾选状态；首次保存建议名在 `prepare_save_as` 失败后重新选择目录时仍保留建议后缀。
- **范围**：`App.tsx` 菜单同步改为受活动未保存标签与 busy 交互锁定共同控制；`src-tauri/src/lib.rs` 点击回滚按入口勾选与被点击索引重建点击前状态；`openSaveAsPanel` 打开时一次算好 Untitled 建议名并贯穿准备成功、准备失败与重选目录；补充对应前端与 Rust 测试。
- **非范围**：不新增用户行为、语言模式或菜单结构；不执行 release 构建与 macOS 真实应用验收（属后续「语法模式集成验收与文档收尾」）。
- **依赖**：已完成的「接入未保存标签临时语法模式与原生菜单」与「首次保存采用语法模式建议文件名」。
- **拆分检查**：本任务只修复三个已实现行为的状态缺陷，不新增主要用户行为，集成回归与真实平台验收仍留在后续任务。
- **完成标准**：新增测试覆盖保存面板/冲突期间菜单禁用与解锁恢复、事件失败下点击已选与未选项的回滚、准备失败后建议名保留；`npm run check`、`npm run build`、`cargo fmt --manifest-path src-tauri/Cargo.toml --check`、`cargo test --manifest-path src-tauri/Cargo.toml` 与 `git diff --check` 通过。
- **结果**：`App.tsx` 菜单同步 effect 移至 busy 计算之后，可用性改为“活动未保存标签且未锁定”，锁定期间禁用并清除勾选、解锁后自动恢复；`lib.rs` 新增 `syntax_pre_click_checked` 纯函数，事件发送失败的回滚按入口勾选与被点击索引重建点击前状态（修正 macOS 点击已先切换自身勾选导致的错误恢复）；`openSaveAsPanel` 打开时一次预计算建议名并用于初始与准备成功两个路径，准备失败后重选目录不再丢失建议后缀。两个既有断言（首次保存失败、替换确认等待期间菜单仍可用）按新锁定行为更新为禁用。
- **验证记录**：定向 `npm run test -- App.test.tsx -t "syntax mode menu"`（10 passed）与 `-t "suggested file name"`（8 passed）通过；`npm run check` 通过（typecheck + vitest **513 passed / 0 failed**，24 个测试文件，净增 3 个前端用例）；`npm run build` 通过（Vite 大 chunk 提示为既有）；`cargo fmt --manifest-path src-tauri/Cargo.toml --check` 通过；`cargo test --manifest-path src-tauri/Cargo.toml` 通过（**167 passed / 0 failed**，含新增 2 个回滚纯函数测试）；`git diff --check` 通过。release 构建与 macOS 真实应用验收未运行，属后续集成验收任务范围。

### 首次保存采用语法模式建议文件名

- **状态**：已完成
- **开始日期**：2026-08-21
- **完成日期**：2026-08-21
- **Feature Spec**：`docs/features/unsaved-document-language-mode.md`
- **目标**：选择了非 `Plain Text` 临时语法模式的 Untitled 标签首次保存时，目标面板按该模式预填带首选后缀的建议文件名，同时始终以用户最终输入和实际保存路径为准。
- **范围**：建立与现有 `LanguageMode` 显式一致的首选后缀映射；仅在无路径标签打开首次保存目标面板时基于完整显示名生成建议；允许用户删除、替换或改用未知后缀；保存成功后清除临时选择并按可信描述符的实际路径重新识别语言；覆盖面板取消、目录选择取消、目标冲突等待及保存失败时保留临时选择。
- **非范围**：不改变已保存文档 Save As 的初始文件名；不强制追加、修正或校验后缀；不新增语言包、内容识别、格式专属入口、持久化、Rust 文件读写或 capability 权限；不在本任务执行 release 构建、完整回归或 macOS 真实应用验收。
- **依赖**：已完成的「接入未保存标签临时语法模式与原生菜单」；已完成的首次保存/另存为内嵌目标面板；已确认的未保存文档语法模式规格。
- **拆分检查**：本任务只交付一个可独立观察的主要行为——临时语法模式影响 Untitled 首次保存的初始建议名及保存结果状态；菜单/高亮入口已由前置任务完成，组合回归、release 构建、真实应用验收和文档收尾留给后续任务。
- **实施要点**：建议值只在首次保存面板完成准备时设置一次，后续预览冲突、重试或错误恢复不得覆盖用户已编辑的文件名；以后缀映射的纯函数测试固定 15 种模式边界；仅成功取得带路径的可信 `DocumentDescriptor` 后重置该标签临时模式，取消、冲突等待或失败不得提前清除；继续保持文件身份语言与临时高亮语言分离。
- **完成标准**：自动化覆盖全部模式/后缀映射、`Untitled 2` 等完整显示名、用户删除或替换后缀、实际路径重新识别、成功清除、取消/失败保留、目标冲突等待及已保存文档 Save As 不受影响；`npm run check`、`npm run build` 与 `git diff --check` 通过。
- **结果**：`src/languageRecognition.ts` 新增 14 个非普通文本模式的首选后缀映射与 `suggestedSaveFileName` 纯函数（完整显示名直接追加后缀，`Plain Text` 保持显示名原样、不丢编号）；`src/tabSession.ts` 新增 `clearTabSyntaxMode`；`App.tsx` 首次保存面板在准备完成时对无路径活动标签一次设置建议名，已保存文档 Save As 继续使用 Rust 草稿名，预览冲突、重试与错误恢复不覆盖用户已编辑的文件名；`performSaveAs` 成功取得带路径可信描述符后清除该标签临时模式，语言、高亮与原生菜单随实际路径重识别，取消、目录取消、冲突等待与失败均保留临时选择。
- **验证记录**：定向 `npm run test -- languageRecognition tabSession`（49 passed / 0 failed）与 `npm run test -- App.test.tsx -t "first-save suggested file name"`（7 passed / 0 failed）通过；`npm run check` 通过（typecheck + vitest **510 passed / 0 failed**，24 个测试文件）；`npm run build` 通过（Vite 大 chunk 提示为既有）；`git diff --check` 通过。

### 接入未保存标签临时语法模式与原生菜单

- **状态**：已完成
- **开始日期**：2026-08-21
- **完成日期**：2026-08-21
- **Feature Spec**：`docs/features/unsaved-document-language-mode.md`
- **目标**：用户可通过 macOS `View > Syntax` 为当前未保存标签选择临时语法模式，源码高亮、状态栏与原生菜单立即一致，不影响其他标签或文档状态。
- **范围**：为 `DocumentTab` 建立默认 `Plain Text` 的临时模式状态；复用现有语言清单与 CodeMirror 扩展；接入受限原生 `Syntax` 子菜单、明确模式事件、活动标签同步与失败保护；覆盖新建/切换/关闭标签、已保存标签禁用及 Markdown/Mermaid 专属入口边界。
- **非范围**：不修改首次保存建议文件名，不持久化选择，不新增语言包、格式专属预览、内容识别、格式化或已保存文件覆盖。
- **依赖**：已确认的未保存文档语法模式规格；已完成的代码语法高亮、多标签会话、CodeMirror 动态重配和原生 View 菜单桥接。
- **拆分检查**：本任务只交付一个可独立观察的主要行为——当前未保存标签选择临时高亮模式；首次保存后缀建议与最终 release/真实应用验收分别留给后续任务。
- **实施要点**：区分“有效源码高亮语言”和“实际文件身份语言”，避免临时 Markdown/Mermaid 模式开放专属入口；前端标签状态是运行期事实源，原生菜单只通过固定模式 ID 与明确载荷同步。
- **完成标准**：自动化覆盖模式映射、标签隔离、编辑器不重建/不改内容和撤销、原生菜单初始化/切换/失败、已保存标签禁用及 Markdown/Mermaid 边界；`cargo fmt --manifest-path src-tauri/Cargo.toml --check`、`cargo test --manifest-path src-tauri/Cargo.toml`、`npm run check`、`npm run build` 与 `git diff --check` 通过。
- **结果**：原生 `View > Syntax` 固定 15 模式单选子菜单落地（`src-tauri/src/lib.rs` 的 `SYNTAX_MODES` 清单、初始禁用门禁、`update_syntax_menu` 受限同步命令、点击单选修复与事件失败回滚）；`DocumentTab` 新增 `syntaxMode` 会话状态，新建/打开/恢复默认 `plain-text`，`setTabSyntaxMode` 仅作用于未保存标签且不改脏状态；前端以 `activeHighlightLanguage` 驱动 CodeMirror 动态重配与状态栏文案，文件身份语言继续独立门控 Preview/WYSIWYG；监听注册武装后才启用菜单同步，busy/会话恢复期间忽略菜单事件，同步失败不阻塞编辑。另修复 vitest 下并发动态导入绕过 `@tauri-apps/api/event` mock 的问题（收敛为共享导入 Promise）。
- **验证记录**：`cargo fmt --manifest-path src-tauri/Cargo.toml --check` 通过；`cargo test --manifest-path src-tauri/Cargo.toml` 通过（**165 passed / 0 failed**，含新增菜单清单与载荷校验测试）；`npm run check` 通过（typecheck + vitest **500 passed / 0 failed**，24 个测试文件，含新增 tabSession/languageRecognition/App 共 20 余个用例）；`npm run build` 通过（Vite 大 chunk 提示为既有）；`git diff --check` 通过。`npm run tauri -- build` 与 macOS 真实应用验收未运行，属后续集成验收任务范围。
