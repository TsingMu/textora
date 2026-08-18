# 编辑器自动换行开关

> 状态：已完成

## 背景与目标

Textora 当前所有 CodeMirror 源码编辑区都固定开启软换行。长行适合阅读，但查看日志、表格化文本、代码或列块内容时，用户也需要保持单行并通过横向滚动检查列对齐。目标是在 macOS 原生 `View` 菜单提供一个全局自动换行开关，并在应用重启后恢复用户选择，同时保证切换只改变显示，不修改文档。

## 范围

- 在 macOS 原生 `View` 菜单增加可勾选的 `Word Wrap` 项，勾选表示开启软换行。
- 开关作用于所有 CodeMirror 源码编辑区，包括普通文本、代码、Markdown/Mermaid 源码以及 Markdown Preview 左侧源码区。
- 开启时沿用当前软换行表现；关闭时每个逻辑行保持单行，超出宽度后通过横向滚动查看。
- 偏好为应用级全局状态：切换后立即影响当前编辑器，切换标签或打开新文档时继续生效，应用重启后恢复。
- 现有用户首次获得该偏好时默认开启，以保持当前行为。

## 非范围

- 不在工具栏、状态栏或文档格式面板增加第二个开关入口。
- 不为不同标签、文件类型或 Markdown 模式分别保存换行偏好。
- 不改变 WYSIWYG、Markdown Preview 渲染区、fenced code 预览或其他非 CodeMirror 派生视图的布局。
- 不插入或删除真实换行，不修改编码、换行类型、文档内容、脏状态、撤销历史或保存结果。
- 不同时实现列标尺、光标行列显示、Tab 宽度、字体设置或其他编辑器偏好。

## 用户流程

1. 用户在 macOS 菜单栏打开 `View`。
2. 用户点击 `Word Wrap`。
3. 菜单勾选状态切换，当前源码编辑区立即在软换行与横向滚动之间切换。
4. 用户切换标签、打开其他文件或重启 Textora，选择保持一致。

## 行为规则与边界情况

- Markdown Preview 与 WYSIWYG 模式打开时仍可切换全局偏好；偏好在下次显示 CodeMirror 源码区时生效。
- 切换必须通过 CodeMirror 配置重配完成，不得销毁并重建编辑器、重置选区/滚动位置、清空撤销历史或触发 `onChange`。
- 关闭自动换行后，横向滚动只影响视图；源码到 Preview 的块级同步滚动仍按纵向源码行工作，不因水平滚动产生错误映射。
- 偏好读取失败、缺失或值无效时回退为开启；写入失败不得阻止编辑或改变文档状态，菜单与当前会话内状态仍应保持一致。
- 原生菜单事件与前端状态必须有单一同步协议，启动恢复时菜单勾选状态和实际编辑器行为不得不一致。
- 只读、加载、保存、冲突、文件缺失或关闭确认不阻止切换查看偏好；该操作不属于文档编辑。

## 菜单、状态与持久化协议

- 菜单项固定使用英文 `Word Wrap`，首期不设置快捷键，保持与现有英文原生菜单一致并避免占用编辑器常用按键。
- React 应用级 `wordWrapEnabled: boolean` 是当前运行会话中编辑器显示行为的唯一状态；它不进入单个标签、文档会话、启动文件清单或 Rust 文档核心。
- 偏好由前端使用 WebView `localStorage` 保存，不引入新的 Rust 持久化文件、第三方依赖或通用设置框架。使用稳定键 `textora.wordWrapEnabled`，只接受字符串 `"true"` / `"false"`；键缺失、值无效或读取抛错均得到 `true`。
- React 必须在首次渲染的状态初始化阶段同步读取该偏好，使首个 CodeMirror 实例直接取得正确值，不先按默认值挂载后再重建或闪切。
- Rust 创建原生 `CheckMenuItem` 时默认勾选但保持禁用。前端先注册 `textora-word-wrap-changed` 监听，再调用一个只接受布尔值的受限初始化命令；命令设置菜单勾选状态并启用菜单。监听器尚未就绪前菜单不可操作，因此启动同步期间不会丢失用户点击或产生双向覆盖竞态。
- 菜单启用后，macOS 原生 check item 在点击时先切换自身勾选状态；Rust 读取切换后的布尔值并发送 `{ enabled: boolean }` 事件。前端以事件值更新 `wordWrapEnabled` 并 best-effort 写入 `localStorage`，不自行再次取反。写入失败时当前编辑器与菜单仍使用同一事件值，只是下次启动可能回退到旧值或默认开启。
- 初始化命令只同步菜单显示，不回写前端偏好、不产生菜单事件。初始化失败时编辑器仍按前端值工作，菜单保持禁用以避免展示可操作但不可信的状态；不显示阻塞提示，下一次应用启动重新尝试。
- 菜单事件发送失败时 Rust 应把 check item 恢复到点击前状态；前端状态保持不变。除初始化命令和该单向事件外，不建立轮询、双写持久化或第二套设置状态。

## 验收条件

- [x] macOS `View` 菜单显示可勾选的 `Word Wrap`，首次默认开启且菜单状态与编辑器一致。
- [x] 关闭后当前源码编辑区停止软换行并可横向滚动；再次开启后恢复软换行。
- [x] 切换不修改内容、不触发脏状态、不增加撤销步骤，并保留选区及可用滚动状态。
- [x] 普通文本、代码、Markdown/Mermaid 源码及 Preview 左侧源码区使用同一全局偏好；WYSIWYG 与预览渲染区不受影响。
- [x] 标签切换、新建/打开文档及模式切换后偏好继续生效，多标签之间不会出现不同状态。
- [x] 应用重启后恢复上次选择；缺失、无效或读取失败时安全回退为开启。
- [x] 启动时菜单在前端监听器注册和偏好同步完成前不可操作；同步完成后勾选与首个编辑器状态一致，不丢失或重复处理菜单点击。
- [x] 只读与忙碌状态下仍可切换；保存后的磁盘字节、编码和换行类型不因该偏好变化。
- [x] 偏好写入失败时当前会话继续切换且菜单一致；菜单初始化失败时编辑器可用、菜单保持禁用，事件发送失败时菜单恢复原状态。
- [x] 自动化覆盖编辑器动态重配、菜单事件、持久化恢复、模式/标签边界和不触发内容更新。
- [x] `npm run check`、`npm run build`、`cargo test --manifest-path src-tauri/Cargo.toml`、`npm run tauri -- build` 与 `git diff --check` 通过；macOS release 真实应用验收覆盖菜单勾选、长行横向滚动及重启恢复。

## 依赖与约束

- 遵守 `docs/ARCHITECTURE.md` 的源码权威、格式增强失败不阻止基础编辑及前端无宽泛权限不变量。
- 当前 `src/Editor.tsx` 无条件安装 `EditorView.lineWrapping`；实现应使用独立 `Compartment` 动态重配，避免重建编辑器。
- 当前原生菜单由 `src-tauri/src/lib.rs` 构建，`View` 只有系统全屏项；菜单项需沿用受限的 Tauri 菜单事件桥接。
- 偏好属于应用级用户状态，不应进入文档会话、Rust 文档核心或用户文件内容。
- 不为本功能引入网络、shell、远程页面或宽泛文件系统 capability。

## 开放问题

暂无阻止首版实现的问题。首版已确认英文 `Word Wrap`、无快捷键、默认开启、应用级全局状态、WebView `localStorage` 持久化，以及“禁用菜单启动门禁 + 受限初始化命令 + 携带明确布尔值的单向菜单事件”同步协议。

## 任务拆分

1. **确认自动换行规格与状态协议**（已完成）：确认菜单文案/快捷键、默认值、持久化所有权、原生菜单与前端同步协议；只修改规划文档。
2. **建立 CodeMirror 自动换行动态重配契约**：为 `Editor` 增加显式偏好输入和独立 `Compartment`，验证切换不重建编辑器、不改内容/撤销/选区；不接原生菜单或持久化。
3. **接入全局偏好、持久化与原生 View 菜单**：完成一个最小垂直切片，使菜单、当前编辑器、标签/模式切换和重启恢复一致；不新增其他设置。
4. **自动换行集成验收与文档收尾**：执行完整自动化、Rust/前端/release 构建、macOS 长行与重启真实验收并同步文档；只做必要小修。

## 验证记录

- 2026-08-14 规划检查：确认 `src/Editor.tsx` 当前无条件安装 `EditorView.lineWrapping`，具备现成的 `Compartment` 重配模式；`src-tauri/src/lib.rs` 已集中构建 macOS 原生菜单并通过事件桥接前端，但 `View` 目前只有全屏；仓库尚无通用偏好存储模块。基于保持现状和最小实现原则，草案建议默认开启、全局持久化、英文 `Word Wrap`、无快捷键，并拆为动态重配、全局菜单接入和集成验收三个实现切片。本轮未修改实现代码，未运行测试或构建。
- 2026-08-18 完成规格确认：菜单确定为英文 `Word Wrap` 且无快捷键；偏好是应用级 React 状态并由 WebView `localStorage` 键 `textora.wordWrapEnabled` 持久化，缺失、无效或读取失败默认开启。启动同步采用禁用的原生 check item 作为门禁：前端同步初始化偏好、注册事件监听后，以受限命令设置勾选并启用；运行期 Rust 发送切换后的明确布尔值，前端采用并 best-effort 持久化，避免双向取反和启动事件竞态。复核当前锁定依赖 `tauri 2.11.5` / `muda 0.19.3`：macOS check item 点击会先原生切换状态再产生菜单事件，可由 Rust 读取结果；`CheckMenuItem` 支持显式 `is_checked` / `set_checked`。本轮只修改规划文档，未修改生产代码、实现性测试、依赖或构建配置，未运行测试或构建。
- 2026-08-18「建立 CodeMirror 自动换行动态重配契约」：`Editor` 新增 `wordWrapEnabled?: boolean`（默认开启）与独立 `wordWrapCompartmentRef`；首挂载按输入安装 `EditorView.lineWrapping` 或空扩展，属性变化只经 compartment reconfigure，`wordWrapAppliedRef` 使同值（含挂载后首跑）零事务。切换不重建编辑器、不改内容/撤销/选区、不触发 `onChange`。验证：`npm run test -- Editor`（**80 passed / 0 failed**，新增默认挂载、禁用首挂、切换往返保实例与内容、选区/撤销保留、同值不重配 5 用例）、`npm run check`（typecheck + vitest **444 passed / 0 failed**）、`npm run build` 与 `git diff --check` 通过。
- 2026-08-18「接入全局偏好、持久化与原生 View 菜单」：前端 `wordWrapPreference.ts` 同步读取/best-effort 写入 `localStorage` 键 `textora.wordWrapEnabled`（只认 `"true"`/`"false"`，异常回退开启）；App 以 `useState` 惰性初始化同步取得偏好传入 `Editor`，启动按“先监听 `textora-word-wrap-changed`、再受限命令 `initialize_word_wrap_menu`”门禁同步菜单，运行期事件携带点击后勾选值直接采用并持久化。Rust View 菜单新增默认勾选但禁用的 `Word Wrap` check item；初始化命令只设勾选并启用；菜单事件读取切换后 `is_checked` 发单向事件，emit 失败恢复原勾选。验证：`cargo fmt --manifest-path src-tauri/Cargo.toml --check`、`cargo test --manifest-path src-tauri/Cargo.toml`（**163 passed / 0 failed**）、`npm run check`（typecheck + vitest **454 passed / 0 failed**，含偏好存取、菜单初始化、事件切换持久化与模式/标签边界用例）、`npm run build` 与 `git diff --check` 通过。
- 2026-08-18「自动换行集成验收与文档收尾」：完整回归与 release 构建通过，bundle 标识 `com.tsingmu.textora` / `textora`，`src-tauri/capabilities/` 无改动；release 应用可启动并正常退出（验证实例已清理）。新增 App 用例：只读文档下菜单切换软换行仍生效且内容/只读徽标不变；菜单初始化命令失败时无阻塞提示、编辑器按前端偏好继续可编辑。8 条可由自动化/代码确认的验收条件已勾选；macOS 真实应用菜单勾选、长行横向滚动与重启恢复 3 条待人工执行——当前自动化环境无辅助访问权限（osascript -1719），无法驱动原生菜单，视觉与持久化恢复留待真实验收。验证：`cargo fmt --manifest-path src-tauri/Cargo.toml --check`、`cargo test --manifest-path src-tauri/Cargo.toml`（**163 passed / 0 failed**）、`npm run check`（typecheck + vitest **456 passed / 0 failed**）、`npm run build`、`npm run tauri -- build` 与 `git diff --check` 通过。
- 2026-08-18「自动换行 macOS 真实应用菜单与重启验收」：用户确认 release `Textora.app` 中 `View > Word Wrap` 菜单勾选与编辑器状态一致；关闭后长行保持单行并可横向滚动，再次开启后恢复软换行；应用重启后恢复上次选择。至此全部验收条件通过，Feature 状态改为已完成。
