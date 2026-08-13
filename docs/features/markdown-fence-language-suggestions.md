# Markdown opening fence 语言候选提示

> 状态：草案

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
- 过滤无结果时关闭候选或显示空结果均可在规格确认时决定，但不得阻塞输入或改写源码。
- 候选确认必须形成普通 CodeMirror 编辑事务，正确进入撤销历史和既有 `onChange`/脏状态/保存链路；一次撤销恢复确认前的 token。
- Escape 只关闭候选，不修改文档；候选已关闭时保持 CodeMirror 既有 Escape 行为。
- 只读、加载、保存、冲突处理、关闭确认或另存为面板阻止编辑时，不展示或确认候选。
- 切换标签、关闭 Preview、进入 WYSIWYG 或活动文档变化时，旧候选立即失效，不得写入新活动标签。
- 多标签候选状态互相隔离；迟到的 UI 事件不得修改非活动文档。
- 候选 UI 或上下文识别失败时安全退化为普通文本输入，不阻止编辑、撤销、保存或关闭。

## 验收条件

- [ ] Markdown 源码中输入 opening fence 语言前缀会显示正确的本地候选，并按不区分大小写的前缀过滤。
- [ ] Preview 左侧源码区行为一致；WYSIWYG、非 Markdown 文档、closing fence、代码块内容区和普通文本不显示候选。
- [ ] 反引号/波浪号 fence、0–3 个前导空格和“位于另一未闭合 fence 内”的边界识别正确。
- [ ] 方向键可移动候选，Enter/Tab 可确认，Escape、光标移动、空格/换行和上下文失效可关闭。
- [ ] 确认候选只替换首个 info token 前缀，保留 fence 标记、缩进与其余 info string，并可一次撤销。
- [ ] 候选确认后，既有 Enter 自动闭合仍能补齐 closing fence；未确认候选直接按 Enter 的行为符合已确认决议。
- [ ] 只读/忙碌状态、多标签切换、Preview/WYSIWYG 切换、保存、关闭保护和列块编辑不回退。
- [ ] 候选为空、UI 创建失败或上下文失效时安全退化，不丢输入、不抛出阻塞错误。
- [ ] 功能不新增网络、shell、远程服务、Rust IPC、Tauri capability 或宽泛文件权限。
- [ ] 自动化覆盖候选过滤、上下文边界、键盘确认/取消、撤销、自动闭合协同和多标签/模式隔离；macOS release 真实应用验收覆盖主要键盘流程与弹层定位。

## 依赖与约束

- 依赖已完成的 `docs/features/markdown-fenced-code-editing.md`、`docs/features/markdown-code-block-highlighting.md`、`docs/features/markdown-split-preview.md` 与 `docs/features/markdown-wysiwyg-mode.md`。
- 候选词表应与 `src/markdownCodeHighlight.ts` 实际支持的 info token/语言集合保持单一契约，避免 UI 推荐预览无法识别的语言。
- 遵守 `docs/ARCHITECTURE.md`：文本文档是权威数据源，格式增强失败不得阻止普通编辑或保存。
- 本功能应复用 CodeMirror 编辑事务和本地 UI 能力；是否引入 CodeMirror 官方 autocomplete 包需在规格确认时基于现有依赖与实现复杂度决定，不因草案自动新增依赖。

## 开放问题

- 候选列表只展示稳定的 canonical 名称（如 `javascript`、`typescript`、`shell`），还是同时展示 `js`、`ts`、`bash` 等当前预览已接受的别名？首版建议只插入 canonical 名称，但别名前缀可用于检索对应 canonical 候选。
- 候选打开且有选中项时，Enter 应立即确认候选，还是优先执行既有 fence 自动闭合？首版建议 Enter 确认候选、随后再次 Enter 自动闭合；Tab 始终确认，Escape 后 Enter 始终执行自动闭合。
- 使用现有 CodeMirror 依赖自建最小候选弹层，还是引入官方 `@codemirror/autocomplete`？确认时应比较 macOS WebKit 定位、键盘事件优先级、无障碍语义与新增依赖成本。

## 建议实现拆分

1. **确认语言候选规格与交互决议**：确定词表/别名策略、Enter/Tab/Escape 语义和 CodeMirror 接入方式；不修改生产代码。
2. **建立 opening fence 候选上下文与词表契约**：形成可测试的 opening fence token 范围、过滤和插入计划；不渲染弹层。
3. **接入候选弹层与键盘交互**：在 Markdown 源码编辑器接入显示、过滤、选择、确认、取消和撤销；处理 Preview/WYSIWYG、只读/忙碌与标签切换边界。
4. **语言候选集成验收与文档收尾**：执行完整自动化、构建、macOS release 真实应用验收和文档状态更新；只做必要小修，不新增主要行为。

## 验证记录

- 2026-08-13 形成草案并完成与现有 fenced 编辑、高亮语言集合、Markdown 模式边界和任务颗粒度的文档核对；本轮仅规划，未修改实现代码，未运行实现测试或构建。
