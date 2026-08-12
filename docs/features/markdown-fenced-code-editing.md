# Markdown fenced code block 编辑辅助

> 状态：已完成（2026-08-11）

## 背景与目标

Textora 已支持 Markdown 源码高亮、左右分栏预览、预览代码块语法着色和 WYSIWYG 模式，但在源码中编写 fenced code block 时仍需手动补齐结束 fence，并需把 JSON 复制到其他工具格式化。对于技术笔记、接口样例和配置片段，这两类操作频繁且容易打断写作。

本功能目标是在不改变 Markdown 源码权威地位的前提下，为源码编辑器提供最小、可预测、可撤销的 fenced code block 编辑辅助：输入 opening fence 后可自动补齐结构；光标位于 `json` fenced code block 内时可显式格式化该代码块。识别或格式化失败时不得改写源码。

## 范围

- 在 Markdown 源码编辑器中识别当前光标所在 fenced code block 的 opening fence、closing fence、info string 首个 token、内容范围和边界。
- 支持由至少 3 个连续反引号或波浪号组成的 fence；closing fence 必须使用相同字符且长度不短于 opening fence。
- 支持 fence 前 0–3 个空格；首版不解析引用或列表前缀中的嵌套 fence。
- 用户在源码编辑器中以单一空光标位于有效 opening fence 行末按 Enter 时，若该 opening fence 尚无匹配 closing fence，则自动插入空内容行和匹配的 closing fence，并把光标放在内容行。
- 自动生成的 closing fence 保持 opening fence 的字符、长度和行首缩进。
- Markdown 源码单栏、Preview 左侧源码编辑器、Plain Text 标签和其他源码语言标签使用同一自动闭合行为；WYSIWYG 模式不执行自动闭合或 JSON 格式化。
- Markdown 源码视图提供显式 `Format JSON` 工具栏入口。光标位于闭合的 `json` fenced code block 内容区时，格式化整个代码块内容为 2 空格缩进的标准 JSON。
- 格式化作为单次 CodeMirror 编辑事务提交，可由一次撤销恢复；保存、脏状态与关闭保护继续走现有链路。
- 无效 JSON、非 `json` fence、光标不在 fence 内容区或 fence 未闭合时，显示非阻塞提示且不修改源码、选择或撤销历史。

## 非范围

- 输入时、粘贴时或保存时自动格式化代码。
- JSONC、JSON5、JavaScript 对象字面量、注释或尾随逗号支持。
- JavaScript、TypeScript、SQL、HTML、CSS、XML、YAML、TOML 等其他语言的格式化。
- 代码补全、诊断、LSP、执行代码、运行测试或远程格式化服务。
- WYSIWYG 内代码块格式化或自动闭合；Mermaid 可视编辑。
- 引用块或列表项前缀中的嵌套 fence、跨多个选择的批量自动闭合/格式化、选区局部格式化。
- 改变 Markdown 预览渲染、高亮语言集合、编码、换行、保存核心、Rust IPC、Tauri capability、网络或 shell 权限。

## 用户流程

### 自动闭合

1. 用户在源码编辑器中输入 opening fence，例如 <code>```json</code>。
2. 用户在该行末按 Enter。
3. Textora 插入内容空行和匹配 closing fence，并把光标放到内容行。
4. 用户继续输入代码；整个插入可通过普通撤销恢复。

### JSON 格式化

1. 用户把光标放入闭合的 `json` fenced code block 内容区。
2. 用户点击工具栏 `Format JSON`。
3. JSON 有效时，Textora 只替换 fence 内容为 2 空格缩进的标准 JSON；opening/closing fence 与文档其他内容不变。
4. JSON 无效或上下文不匹配时，Textora 显示非阻塞提示，源码保持原样。

## 行为规则与边界情况

- Markdown 源码始终是唯一权威数据源；上下文识别结果和格式化计划均为可重建派生数据。
- info string 取去除首尾空白后的第一个 token，并按大小写不敏感匹配；只有恰好为 `json` 的 token 可格式化，`jsonc`、`application/json` 和未知 token 不匹配。
- 光标必须位于 opening 与 closing fence 之间的内容区；位于 fence 标记行上不视为可格式化上下文。
- closing fence 可长于 opening fence，不能短于 opening fence；字符类型必须一致。
- 内容中的较短同类标记、另一种 fence 字符或带非空 info string 的候选 closing 行不结束当前代码块。
- 自动闭合只在当前行确认为 opening fence 时接管单一空光标的 Enter。存在非空选区或多个选择时交给 CodeMirror 默认行为，避免改变列块编辑语义；普通代码行、非 fence 行、已有 closing fence 的 opening 行不接管。
- opening fence 已能在下方找到匹配 closing fence 时，不重复生成 closing fence，只执行普通 Enter。
- closing fence 行、已处于另一 fenced code block 内的 fence-like 行、超过 3 个行首空格的标记，以及普通文本中的反引号不触发自动闭合。
- 格式化前使用浏览器内建 `JSON.parse` 验证，使用 `JSON.stringify(value, null, 2)` 生成内容；允许对象、数组和其他合法 JSON 顶层值，不新增格式化依赖。
- 格式化会去除代码块内容原有的首尾空白行并规范内部缩进；opening fence、info string、closing fence、文档其他内容及保存格式保持不变。
- 格式化成功后光标保持在该代码块内容区并映射到有效位置；一次撤销恢复格式化前的完整内容。
- `Format JSON` 仅在 Markdown 源码编辑器可见时显示，包括 Preview 分栏的左侧源码视图；进入 WYSIWYG 时隐藏。加载、保存、冲突处理、关闭确认、另存为面板或只读状态下禁用。
- 上下文不匹配提示为“Place the cursor inside a closed JSON fenced code block.”；解析失败提示为“Invalid JSON. The document was not changed.”。提示不阻止继续编辑、保存、切换标签或关闭。
- 多标签切换时，命令只读取并修改当前活动 Markdown 标签，不得污染其他标签或预览派生状态。

## 后续发现与候选改进

- 2026-08-12 在已部署应用中发现：输入 <code>```json</code> 后按 Enter，编辑器只换到下一行，没有自动补齐匹配的 closing fence。复查确认当编辑器内容确实为 <code>```json</code> 且光标在行末时，Markdown/Plain Text 自动化路径可用；为覆盖真实标签可能被识别为 JSON/其他代码语言的场景，后续修复将自动闭合扩展为所有源码编辑器语言中“当前行是 Markdown opening fence”时生效。修复时需确认带 info string 的 opening fence、纯 <code>```</code>、波浪号 fence、Preview 左侧源码、撤销、已有 closing fence、选区和多光标边界均不回退。
- 后续可新增 opening fence 语言候选提示：用户在 Markdown 源码或 Preview 左侧源码中输入 opening fence 的 info string 前缀时，例如 <code>```j</code>，在光标附近显示本地候选窗口，推荐 `java`、`javascript`、`json` 等匹配语言。候选应来自 Textora 已支持的代码高亮/预览语言集合或显式维护的本地列表，不访问网络、不调用 LSP、不执行代码。
- 语言候选首版应只作用于 opening fence 行的 info string 位置；不得在普通文本、closing fence、已闭合代码块内容区、WYSIWYG 模式或非 Markdown 文档中弹出。用户可继续输入过滤候选，可用键盘选择/确认，也可按 Escape、继续输入空格/换行或移动光标关闭提示；未选择时不得改写源码。
- 若语言候选和自动闭合同时发生，优先保持 Enter 自动闭合语义稳定：已选择候选后按 Enter 应补齐 closing fence；未选择候选而直接按 Enter 的行为需明确，不得造成候选窗口吞掉自动闭合或插入部分候选文本。

## 验收条件

- [x] 上下文识别正确返回反引号/波浪号 fence 的标记字符、长度、缩进、语言 token、内容范围及 opening/closing 边界。
- [x] 上下文识别正确处理较长 closing fence、不同字符、较短标记、未闭合 fence、fence 行上的光标及非 fence 文本。
- [x] 源码编辑器中输入 opening fence 后按 Enter 会补齐 closing fence 并把光标放到内容行；已有 closing fence、非空选区、多选择和非 fence 行不接管默认 Enter。
- [x] 自动闭合在 Preview 左侧源码区同样有效，在 WYSIWYG 中不生效，并可一次撤销。
- [x] `Format JSON` 对闭合 `json` fence 中的有效 JSON 生成 2 空格缩进内容，只改代码块内容并可一次撤销。
- [x] 大小写形式的 `json` token 可识别；`jsonc`、未知语言、未闭合 fence、fence 行光标与代码块外光标不修改文档。
- [x] 无效 JSON 显示非阻塞提示，源码、选择、撤销历史和脏状态不变。
- [x] 保存后磁盘内容为当前 Markdown 源码，不包含预览 DOM 或其他派生产物。
- [x] 只读与忙碌状态禁用格式化；多标签、Preview/WYSIWYG 切换、保存与未保存关闭保护不回退。
- [x] 功能不新增网络、shell、远程服务、Rust IPC、Tauri capability 或宽泛文件权限。
- [x] 自动化测试覆盖上下文边界、自动闭合、JSON 成功/失败、撤销、模式与多标签隔离。
- [x] macOS release 真实验收覆盖主要用户流程（Enter 自动闭合、`Format JSON` 点击、Preview 左侧一致、WYSIWYG 不生效、只读/忙碌禁用、保存源码与多标签/关闭保护不回退）。

## 依赖与约束

- 依赖已完成的基础文本编辑、多标签会话、保存与关闭保护、Markdown 源码高亮、Preview 分栏和 WYSIWYG 模式。
- 遵守 `docs/ARCHITECTURE.md`：文本文档是权威数据源；编辑辅助失败不得阻止普通查看、编辑或保存。
- 复用 CodeMirror 事务、选择和撤销历史；不得为格式化绕过现有 `onChange`、脏状态或保存链路。
- 遵守最小权限原则和 D-004、D-007；本功能为纯前端本地能力，只要求 macOS 行为验收。

## 决议记录

- 2026-08-11 确认首版范围：自动闭合与格式化只作用于 Markdown 源码编辑器，Preview 左侧包含在内，WYSIWYG 不包含。
- 格式化必须由用户点击 `Format JSON` 显式触发，不在输入、粘贴或保存时自动运行。
- 首版只格式化严格 JSON，使用平台内建解析/序列化能力，不引入新依赖；失败时不改源码。
- 上下文契约同时支持反引号和波浪号 fence、至少 3 个标记字符及 0–3 个前导空格；引用/列表嵌套 fence 留待后续。

## 实现拆分

1. **确认 Markdown fenced code block 编辑辅助规格**（本任务）：确定上下文边界、自动闭合触发、JSON 格式化入口、失败保护和非范围；不修改生产代码。
2. **建立 Markdown fence 上下文识别契约**（下一项）：新增纯前端解析模块，识别 fence 标记、info token、内容范围和闭合边界；覆盖纯函数测试，不接入 Editor、工具栏或编辑事务。
3. **实现 Markdown opening fence 自动闭合**：在 Markdown 编辑器高优先级 Enter 命令中复用上下文契约；只处理单一空光标，保持默认编辑、列块与撤销语义。
4. **接入 fenced JSON 显式格式化**：提供 `Format JSON` 工具栏入口和 Editor 命令，完成有效 JSON 替换、无效/错位上下文提示、撤销、只读与模式边界。
5. **Markdown fenced 编辑辅助集成验收与文档收尾**：运行完整自动化、release 构建和 macOS 真实应用验收；确认保存源码、多标签与既有 Markdown 模式不回退，更新规格和 README。

## 验证记录

- 2026-08-11 完成规格确认与任务拆分；本任务仅修改规划文档，未运行实现测试或构建。
- 2026-08-11 实现与集成验收完成。自动化覆盖 `src/markdownFenceContext.test.ts`、`src/Editor.test.ts` 与 `src/App.test.tsx` 的上下文边界、Enter 自动闭合、fenced JSON 格式化、失败保护、撤销、模式和多标签隔离；`npm run check` 通过（typecheck + vitest **259 passed / 0 failed**），`npm run tauri -- build` 通过并生成 release `Textora.app`，`git diff --check` 通过。
- 2026-08-11 在 release `Textora.app` 中完成真实交互验收：确认有效 JSON 格式化与一次撤销、无效 JSON/`jsonc` 提示且源码不变、源码模式与 Preview 左侧 Enter 自动补齐及一次撤销、WYSIWYG 隐藏格式化入口、纯文本与 Markdown 多标签隔离、打开期间与只读状态禁用、保存只写 Markdown 源码、未保存关闭保护继续生效；同时确认 `Format JSON` 与现有工具栏按钮在亮色界面中使用一致样式。
- 2026-08-12 修复带 info string 的 opening fence 自动闭合体验：自动闭合现在适用于 Markdown 与 Plain Text 标签，输入 <code>```json</code> 后按 Enter 会生成匹配 closing fence；JSON、JavaScript 等代码语言标签仍不接管。`npm run test -- Editor App -t "auto-close|auto-closes|markdown fence"` 通过（相关 **16 passed / 0 failed**），`npm run check` 通过（typecheck + vitest **282 passed / 0 failed**），`npm run build` 与 `git diff --check` 通过；本次未运行 Tauri release 构建或 macOS 真实应用点击验收。
- 2026-08-12 根据重新部署后的用户反馈复查并扩大修复：真实应用确认 exact <code>```json</code> + Return 在 Plain Text 可补齐；为覆盖标签被识别为 JSON 或其他源码语言的场景，自动闭合命令改为所有源码编辑器语言中只要当前行是未闭合 Markdown opening fence 就接管 Enter。`npm run test -- Editor App -t "auto-close|auto-closes|markdown fence"` 通过（相关 **16 passed / 0 failed**），`npm run check` 通过（typecheck + vitest **282 passed / 0 failed**），`npm run tauri -- build` 通过并重新部署到 `/Applications/Textora.app`；安装后 `codesign --verify --deep --strict /Applications/Textora.app` 通过，真实应用验证 exact <code>```json</code> + Return 后编辑器内容为 <code>```json\n\n```</code>。
- 2026-08-12 根据用户补充“新建未指定格式页面可以，但 Markdown 文档中不行”继续修复：新增事务兜底，在 Markdown 语言扩展或真实 WebView 路径先产生普通 `input.newline` 时，若换行前状态位于未闭合 opening fence 行末，则改写为自动补齐 closing fence。`npm run test -- Editor -t "markdown fence auto-close"` 通过（相关 **16 passed / 0 failed**），`npm run check` 通过（typecheck + vitest **283 passed / 0 failed**），`npm run tauri -- build` 通过并重新部署到 `/Applications/Textora.app`。Computer Use 在当前输入法下不能可靠手动输入反引号，本轮真实 UI 未再次验证手动键入序列；自动化新增覆盖 Markdown 模式默认换行事务兜底。
