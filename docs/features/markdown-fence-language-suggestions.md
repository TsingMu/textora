# Markdown opening fence 语言候选提示

> 状态：已完成（2026-08-14）

## 背景与目标

Textora 已支持 Markdown fenced code block 自动闭合、本地预览语法着色和 fenced JSON 显式格式化，但用户仍需完整输入 opening fence 的语言标记。编写技术笔记时，`javascript`、`typescript`、`json` 等名称较长且容易拼错；错误或不一致的 info string 也会使预览退化为普通代码文本。

本功能目标是在 Markdown 源码中输入 opening fence 的首个 info token 时，提供轻量、本地、可完全由键盘操作的语言候选提示。提示只辅助插入文本，不改变 Markdown 源码权威地位；取消或无法识别上下文时继续保持普通编辑行为。

## 范围

- 仅在 Markdown 源码单栏和 Preview 左侧源码编辑器中，对有效 opening fence 行的首个 info token 提供候选。
- 用户输入前缀时按不区分大小写的前缀过滤，例如 <code>```j</code> 可匹配 `java`、`javascript`、`json`。
- 候选来自 Textora 本地支持的 fenced code 高亮语言集合，并包含 `mermaid`；不访问网络或外部服务。
- 候选窗口显示在光标附近，支持方向键移动、Enter 或 Tab 确认、Escape 关闭。
- 确认候选时只替换当前首个 info token 前缀，保留 opening fence 标记、缩进和 token 后的其余 info string。
- 继续输入可更新过滤结果；移动光标、输入空格或换行、离开有效 opening fence 上下文时关闭提示。
- 与现有 opening fence Enter 自动闭合协同，不能吞掉或破坏 closing fence 补齐行为。

## 非范围

- 不提供通用代码补全、LSP、诊断、代码执行或远程候选。
- 不作用于普通文本、独立代码文件、closing fence、fenced block 内容区或 WYSIWYG 模式。
- 不支持模糊匹配、使用频率排序、最近使用记录、用户自定义语言或跨会话偏好。
- 不扩展 Textora 的代码高亮、格式化或 Mermaid 图表能力。
- 不改变 Markdown 预览渲染、保存格式、编码、换行、Rust IPC、Tauri capability、网络或 shell 权限。

## 用户流程

1. 用户在 Markdown 源码的有效 opening fence 行输入语言前缀，例如 <code>```j</code>。
2. 光标附近出现本地候选列表，显示匹配语言。
3. 用户继续输入过滤，或用方向键选择候选。
4. 用户按 Enter 或 Tab 确认；Textora 补全当前语言 token。
5. 用户继续按 Enter 时，既有 opening fence 自动闭合行为仍会插入内容行和 closing fence。

取消流程：用户按 Escape、移动光标或离开有效上下文，候选关闭且源码不发生额外修改。

## 行为规则与边界情况

- Markdown 源码是唯一权威数据源；候选集合、过滤结果和弹层状态均为可重建派生状态。
- opening fence 识别复用既有 fenced context 规则：反引号或波浪号至少 3 个、行首最多 3 个空格，且当前行不能位于另一个未闭合 fence 内。
- 只有光标位于 opening fence 首个 info token 内或其末尾时才展示候选；第二个 token、closing fence、代码内容或普通文本中的相似字符不得触发。
- 过滤无结果时关闭候选，不显示空弹层，不得阻塞输入或改写源码。
- 候选确认必须形成普通 CodeMirror 编辑事务，正确进入撤销历史和既有 `onChange`/脏状态/保存链路；一次撤销恢复确认前的 token。
- Escape 只关闭候选，不修改文档；候选已关闭时保持 CodeMirror 既有 Escape 行为。
- 只读、加载、保存、冲突处理、关闭确认或另存为面板阻止编辑时，不展示或确认候选。
- 切换标签、关闭 Preview、进入 WYSIWYG 或活动文档变化时，旧候选立即失效，不得写入新活动标签。
- 多标签候选状态互相隔离；迟到的 UI 事件不得修改非活动文档。
- 候选 UI 或上下文识别失败时安全退化为普通文本输入，不阻止编辑、撤销、保存或关闭。

## 验收条件

- [x] Markdown 源码中输入 opening fence 语言前缀会显示正确的本地候选，并按不区分大小写的前缀过滤。
- [x] Preview 左侧源码区行为一致；WYSIWYG、非 Markdown 文档、closing fence、代码块内容区和普通文本不显示候选。
- [x] 反引号/波浪号 fence、0–3 个前导空格和“位于另一未闭合 fence 内”的边界识别正确。
- [x] 方向键可移动候选，Enter/Tab 可确认，Escape、光标移动、空格/换行和上下文失效可关闭。
- [x] 确认候选只替换首个 info token 前缀，保留 fence 标记、缩进与其余 info string，并可一次撤销。
- [x] 候选确认后，既有 Enter 自动闭合仍能补齐 closing fence；未确认候选直接按 Enter 的行为符合已确认决议。
- [x] 只读/忙碌状态、多标签切换、Preview/WYSIWYG 切换、保存、关闭保护和列块编辑不回退。
- [x] 候选为空、UI 创建失败或上下文失效时安全退化，不丢输入、不抛出阻塞错误。
- [x] 功能不新增网络、shell、远程服务、Rust IPC、Tauri capability 或宽泛文件权限。
- [x] 自动化覆盖候选过滤、上下文边界、键盘确认/取消、撤销、自动闭合协同和多标签/模式隔离；macOS release 真实应用验收覆盖主要键盘流程与弹层定位。

## 依赖与约束

- 依赖已完成的 `docs/features/markdown-fenced-code-editing.md`、`docs/features/markdown-code-block-highlighting.md`、`docs/features/markdown-split-preview.md` 与 `docs/features/markdown-wysiwyg-mode.md`。
- 候选词表应与 `src/markdownCodeHighlight.ts` 实际支持的 info token/语言集合保持单一契约，避免 UI 推荐预览无法识别的语言。
- 遵守 `docs/ARCHITECTURE.md`：文本文档是权威数据源，格式增强失败不得阻止普通编辑或保存。
- 本功能复用 CodeMirror 编辑事务与官方 `@codemirror/autocomplete` 能力；实现切片应把当前已被现有语言包间接安装的同版本包声明为直接依赖，不自建候选弹层基础设施。

## 决议记录

- 2026-08-13 确认首版词表：候选只展示并插入 canonical 名称 `javascript`、`typescript`、`json`、`html`、`css`、`rust`、`python`、`java`、`shell`、`sql`、`toml`、`yaml`、`markdown`、`mermaid`。`js`、`jsx`、`ts`、`tsx`、`bash`、`py`、`rs`、`yml`、`md` 等既有预览别名只参与检索并指向相应 canonical 候选，不作为重复列表项；词表与预览语言解析共用单一导出契约。
- 2026-08-13 确认键盘优先级：候选打开且存在选中项时，Enter 或 Tab 只确认候选；用户再次按 Enter 时执行既有 opening fence 自动闭合。Escape 只关闭候选，随后 Enter 直接自动闭合当前已输入前缀；候选未打开或无匹配项时，Enter 保持既有自动闭合/普通换行行为。
- 2026-08-13 确认接入方式：使用官方 `@codemirror/autocomplete`，由其负责光标附近定位、选择状态、键盘导航和可访问性基础语义；实现时将当前依赖树已有的兼容版本声明为项目直接依赖。Textora 只提供受限 Markdown opening fence completion source、候选目录和必要主题，不自建通用弹层状态机。
- 2026-08-13 确认空结果行为：前缀无匹配项时关闭候选并退化为普通输入，不显示空弹层。

## 建议实现拆分

1. **确认语言候选规格与交互决议**（已完成）：确定词表/别名策略、Enter/Tab/Escape 语义和 CodeMirror 接入方式；不修改生产代码。
2. **建立 opening fence 候选上下文与词表契约**：形成可测试的 opening fence token 范围、过滤和插入计划；不渲染弹层。
3. **接入候选弹层与键盘交互**：在 Markdown 源码编辑器接入显示、过滤、选择、确认、取消和撤销；处理 Preview/WYSIWYG、只读/忙碌与标签切换边界。
4. **语言候选集成验收与文档收尾**：执行完整自动化、构建、macOS release 真实应用验收和文档状态更新；只做必要小修，不新增主要行为。

## 验证记录

- 2026-08-13 形成草案并完成与现有 fenced 编辑、高亮语言集合、Markdown 模式边界和任务颗粒度的文档核对；本轮仅规划，未修改实现代码，未运行实现测试或构建。
- 2026-08-13 确认规格。核对 `src/markdownCodeHighlight.ts` 的既有 info token 映射、`src/languageRecognition.ts` 的语言集合、`src/Editor.tsx` 的高优先级 Enter 自动闭合 keymap，以及依赖树中由多个现有 CodeMirror 包共同使用的 `@codemirror/autocomplete@6.20.3`。据此确认 canonical 展示/别名检索、候选优先确认后再次 Enter 自动闭合、官方 autocomplete 接入和无结果关闭四项决议；本任务只修改规划文档，未修改生产代码、实现性测试或依赖，未运行测试或构建。
- 2026-08-14 实现完成并通过组合自动化与 release 构建。9 条可由自动化/代码/权限确认的验收条件已勾选：候选过滤/上下文边界/键盘确认·取消/撤销/自动闭合协调/只读·忙碌·多标签·模式隔离/安全退化由 vitest 覆盖（含真实 `input.type` 事务 + 自动激活 + Enter 的裸 fence 自动闭合与 `j` 前缀确认候选、20,000 行文档下 completion 热路径只做常数次行读取），未新增网络/shell/Rust IPC/capability 经 `src-tauri/capabilities` 自基线无改动确认；`npm run tauri -- build` 通过并生成 release `Textora.app`（`CFBundleIdentifier`=`com.tsingmu.textora`、`CFBundleExecutable`=`textora`、`CFBundleIconFile`=`icon.icns`）。最后一条「macOS release 真实应用验收覆盖主要键盘流程与弹层定位」与「已完成」状态待人工执行后落实——当前自动化环境无法可靠驱动真实 macOS 应用的键盘输入（尤其反引号）与弹层定位视觉判定。
- 2026-08-14 用户确认 macOS release 真实应用 opening fence 键盘验收完成，主要键盘流程与候选弹层定位通过；据此勾选最后一条验收条件并将规格状态更新为已完成。本次状态收尾未重新运行自动化或构建，沿用前置集成任务已通过的 `npm run check`（373 tests）与 `npm run tauri -- build` 记录。
