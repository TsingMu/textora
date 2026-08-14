# 当前任务

个人项目同时最多一个任务处于进行中。此文件只保留已承诺、可执行的近期工作，不保存候选想法。

> 平台范围说明：D-007 已于 2026-07-27 取代原双平台决策。以下历史任务中的双平台范围只保留为当时的决策背景，不再构成当前待办、平台债务或功能完成条件。

## 进行中

暂无进行中任务。

## 已承诺待办

暂无已承诺待办。

## 最近完成

### Markdown WYSIWYG 长文本软换行 macOS 窄窗口视觉验收

- **状态**：已完成
- **开始日期**：2026-08-14
- **完成日期**：2026-08-14
- **Feature Spec**：`docs/features/markdown-wysiwyg-mode.md`
- **结果**：用户在 release `Textora.app`（含首次 `ResizeObserver` 通知重测与自动测高边框补正修复）中打开 `samples/markdown-wysiwyg-wrap-smoke.md` → 切到 `WYSIWYG` → 把窗口缩到最小宽度 720px，确认标题（H2/H3）、段落、无序/有序/任务列表项、引用、fenced code（JSON/Python）、代码语言标记与表格源码岛均在窄窗口内自动软换行且完整可见可编辑；marker 与任务复选框与首行顶部对齐；长文本高度自动扩展；保存后磁盘 Markdown 源码无额外换行、块结构不变。用户确认验收通过。`docs/features/markdown-wysiwyg-mode.md` 最后一条验收条件已勾选、状态改为已完成，README 文档导航同步。未修改实现代码或依赖。
- **验证记录**：本次记录用户完成的 macOS release 真实应用窄窗口视觉验收；未重新运行自动化或构建，沿用前置修复任务已通过的 `npm run check`（386 tests）与 `npm run tauri -- build` 结果。

### 修复 AutoGrowTextarea 自动测高边框误差

- **状态**：已完成
- **开始日期**：2026-08-14
- **完成日期**：2026-08-14
- **Feature Spec**：`docs/features/markdown-wysiwyg-mode.md`
- **结果**：修复 `AutoGrowTextarea` 在项目全局 `box-sizing: border-box` 下直接把 `scrollHeight` 当作最终 CSS 高度导致的边框误差。`scrollHeight` 不含边框，而 border-box 的 CSS `height` 须含边框，直接用 `scrollHeight` 会使带边框的控件高度偏小、内容可能被裁切。`resize()` 改为 `scrollHeight + (offsetHeight - clientHeight)`（即加上上下边框总宽度）。仅改 `src/MarkdownWysiwygEditor.tsx`，未改 CSS 的 `box-sizing`、其他控件、解析/序列化、Rust/capability。
- **验证记录**：`npm run check` 通过（typecheck + vitest **386 passed / 0 failed**，新增 `MarkdownWysiwygEditor` 用例：mock `scrollHeight=40`/`offsetHeight=50`/`clientHeight=48`（1px 上下边框）时最终高度为 42px（含额外 2px）；首次 ResizeObserver 重测、宽度变化重测、宽度不变无循环用例不回退）；`npm run build` 通过；`git diff --check` 通过。macOS 视觉验收仍为独立待办，未随本任务执行。

### 修复 AutoGrowTextarea 忽略首次 ResizeObserver 通知

- **状态**：已完成
- **开始日期**：2026-08-14
- **完成日期**：2026-08-14
- **Feature Spec**：`docs/features/markdown-wysiwyg-mode.md`
- **结果**：修复 `AutoGrowTextarea` 在首次 `ResizeObserver` 通知时只记录宽度而跳过重测的问题。多个控件挂载后父容器滚动条可能缩小可用宽度，首次通知携带最终宽度，此前跳过重测会使长文本在最终宽度下仍按挂载时宽度测量而被裁切。改为：首次通知在设置 `widthRef` 后执行一次 `resize()`（按最终宽度重读 `scrollHeight`），后续仅在宽度变化时重测；`resize()` 只改高度不改宽度，不会触发宽度变化的循环回调。仅改 `src/MarkdownWysiwygEditor.tsx`，未触及 CSS、解析/序列化、Rust/capability。
- **验证记录**：`npm run check` 通过（typecheck + vitest **385 passed / 0 failed**，新增 `MarkdownWysiwygEditor` 用例：首次 `ResizeObserver` 通知按最终宽度重测（40px→70px），相同宽度后续通知不重复测量（不变成 250px）；既有尺寸/重渲染用例不回退）；`npm run build` 通过；`git diff --check` 通过。macOS 视觉验收仍为独立待办，未随本任务执行。

### 修复 Markdown WYSIWYG 长文本无法完整查看

- **状态**：实现完成（代码、自动化回归、`npm run build`、`npm run tauri -- build` 通过）；macOS 窄窗口真实视觉验收拆为独立待办（见「已承诺待办」），未随本任务标记完成
- **开始日期**：2026-08-14
- **完成日期**：2026-08-14
- **Feature Spec**：`docs/features/markdown-wysiwyg-mode.md`
- **结果**：把 WYSIWYG 标题、列表项文本、代码语言标记由单行 `<input>` 改为自动增高的 `<textarea>`（新增内部 `AutoGrowTextarea`：按 `scrollHeight` 自动扩展高度、`wrap="soft"` 视觉软换行、`singleLine` 模式拦截 Enter 并在 `onChange` 清洗 `\r`/`\n` 保持源码单行，IME 组合态期间不拦截 Enter 以保证中日韩输入法提交候选），段落、引用、fenced code、源码岛与空文档统一改用该组件。按审查强化高度测量：`useLayoutEffect` 依赖纳入 `className`（标题级别/控件样式变化时重测），以 `ResizeObserver` 监听控件宽度变化（容器/窗口宽度变化时重测，替代窗口 resize 监听），首次回调只记录宽度避免循环；文本相同而级别/样式/宽度变化时不再保留过期高度，且不为大量文本框在每次渲染制造重复布局（仅值/类名/宽度变化时重测）。`App.css` 把编辑器内 textarea 设为 `resize:none`，为 `markdown-wysiwyg-list-text`/`code-language`/`empty` 补 `display:block`，`list-text` 设 `width:100%` 填充网格单元在窄窗口随宽软换行，`list-item` 改 `align-items:start` 并给 marker/任务复选框顶部偏移。软换行只影响派生显示，不向源码注入额外换行或改变块结构；编辑、脏状态、撤销、模式切换、保存与只读/忙碌锁定行为不变。未新增网络、shell、远程页面、Rust IPC、Tauri capability 或文件权限。
- **验证记录**：`npm run check` 通过（typecheck + vitest **384 passed / 0 failed**，含 `MarkdownWysiwygEditor` 13 用例：单行控件渲染为 textarea 且换行清洗为单行源码、Enter 拦截、IME 组合态不拦截、多行段落允许换行、长中文/英文无空格列表项保持单行、jsdom 无 `scrollHeight` 不抛错，以及 AutoGrowTextarea 尺寸行为（mount 按 `scrollHeight` 测高、值变化重测、className 即标题级别变化在文本相同时重测、ResizeObserver 宽度变化重测、宽度不变不重测无循环）；既有 heading/source island 用例改为 textarea setter，App 集成用例 heading 操作同步改为 textarea）；`npm run build` 通过；`npm run tauri -- build` 通过并生成 release `Textora.app`（bundle `CFBundleIdentifier`=`com.tsingmu.textora`、`CFBundleExecutable`=`textora`、`CFBundleIconFile`=`icon.icns`）；`src-tauri/capabilities/` 无改动；`git diff --check` 通过。macOS release 窄窗口真实视觉验收**未执行**——`osascript` 无辅助访问权限（错误 -1719）无法驱动应用 UI，且 app 无 `RunEvent::Open`/文件关联、Untitled 为纯文本，无法自动加载长内容 Markdown 到 WYSIWYG；该视觉验收已拆为独立待办「Markdown WYSIWYG 长文本软换行 macOS 窄窗口视觉验收」。Feature Spec 最后一条验收条件因此仍为未勾选。

### Markdown opening fence 语言候选 macOS 真实应用键盘验收

- **状态**：已完成
- **开始日期**：2026-08-14
- **完成日期**：2026-08-14
- **Feature Spec**：`docs/features/markdown-fence-language-suggestions.md`
- **结果**：用户确认 macOS release 真实应用 opening fence 键盘验收完成，主要键盘流程与候选弹层定位通过。Feature Spec 最后一条验收条件已勾选、状态改为已完成，README 当前状态与文档导航同步收尾；未修改实现代码或依赖。
- **验证记录**：本次记录用户完成的 macOS release 真实应用键盘验收；未重新运行自动化或构建，沿用前置集成任务已通过的 `npm run check`（373 tests）与 `npm run tauri -- build` 结果；`git diff --check` 通过。

### Markdown opening fence 语言候选集成验收与文档收尾

- **状态**：自动化、release 构建、bundle 与权限校验、文档收尾完成；macOS 真实键盘/弹层验收待执行
- **开始日期**：2026-08-13
- **完成日期**：2026-08-14
- **Feature Spec**：`docs/features/markdown-fence-language-suggestions.md`
- **结果**：完成组合自动化回归、release 构建、bundle 与权限校验和文档收尾。审查问题已修复：completion 热路径在 Markdown 语法树未覆盖当前行时安全退化为不显示候选，不再回退无界逐行扫描（`openingFenceTokenContextFromState` 在树判定返回 `null` 时按拒绝处理）；`openingFenceTokenContextFromLineSource` 增加可选 `nestingOracle`；新增真实未强制解析的 20,000 行文档回归测试确认热路径只做常数次行读取。`@codemirror/autocomplete@^6.20.3` 与 `@lezer/common@^1.5.2` 声明为直接依赖并更新 lockfile。`docs/features/markdown-fence-language-suggestions.md` 状态改为「实现完成，macOS 真实应用键盘/弹层验收待执行」，9 条可由自动化/代码/权限确认的验收条件已勾选，最后一条 macOS 真实应用键盘/弹层验收条件与「已完成」状态待人工执行；README 当前状态与文档导航同步。未新增用户可见行为、网络/shell/Rust IPC/capability/文件权限。
- **验证记录**：`npm run check` 通过（typecheck + vitest **373 passed / 0 failed**，含 20,000 行文档 completion 热路径常数次行读取回归，既有候选过滤/上下文边界/键盘确认·取消/撤销/自动闭合协调/只读·忙碌·多标签·模式隔离/安全退化用例不回退）；`npm run tauri -- build` 通过并生成 release `Textora.app`；bundle 校验 `CFBundleIdentifier`=`com.tsingmu.textora`、`CFBundleExecutable`=`textora`、`CFBundleIconFile`=`icon.icns`；`src-tauri/capabilities/` 自基线无改动，确认未新增网络、shell、远程页面、Rust IPC、Tauri capability 或宽泛文件权限；`git diff --check` 通过。macOS release 真实应用键盘流程（输入 opening fence 语言前缀、方向键移动、Enter/Tab 确认、Escape/光标移动/空格·换行关闭、撤销、与自动闭合协调）与弹层定位视觉判定待人工执行——当前自动化环境无法可靠驱动真实 macOS 应用键盘输入（尤其反引号）与 WebView 弹层视觉判定，逻辑层由自动化确定性覆盖。

### 接入 Markdown opening fence 语言候选弹层与键盘交互

- **状态**：已完成
- **开始日期**：2026-08-13
- **完成日期**：2026-08-13
- **Feature Spec**：`docs/features/markdown-fence-language-suggestions.md`
- **结果**：把前置切片的纯函数契约接入官方 `@codemirror/autocomplete`，交付 Markdown opening fence 语言候选弹层与键盘交互。新增 `@codemirror/autocomplete@^6.20.3` 为项目直接依赖（与依赖树既有 `6.20.3` 对齐）。新增 `src/markdownFenceLanguageCompletion.ts`：completion source 复用 `openingFenceTokenContext`/`suggestFenceLanguages`/`buildFenceLanguageInsertion`，仅在单空光标位于有效非嵌套 opening fence 首个 token 时返回候选；以 `filter: false` 提交保证大小写不敏感前缀、目录顺序与去重，别名只检索不出现；只读/多选/非空选/非 fence 上下文/无匹配均返回 `null`（不显示空弹层）；每个 option 的 `apply` 按当前光标重新确认 token 范围并用 `buildFenceLanguageInsertion` 把 canonical 写回（光标在 token 中部仍替换整个 token），经普通事务进入撤销/脏状态/保存链路。`Editor.tsx` 新增 `editorExtensionsForLanguage`：Markdown 时挂候选 completion 与 `Tab→acceptCompletion`（`Prec.high`）keymap，非 Markdown 不挂。键盘协调复用依赖树既有优先级链——`basicSetup` 内置 `completionKeymapExt` 位于 `Prec.highest`（Enter→acceptCompletion、Escape→closeCompletion、方向键→moveCompletionSelection），高于既有 `Prec.high` opening fence Enter 自动闭合：候选打开且有选中项时 Enter/Tab 只确认候选；候选关闭（确认/Escape/无匹配/上下文失效）后 Enter 落到自动闭合→普通换行。WYSIWYG 用独立编辑器组件、多标签各自 Editor 实例，天然隔离。修复两个问题：(1) 裸 opening fence 的空前缀在输入自动激活（非显式）时返回 `null`，避免弹层吞掉既有 Enter 自动闭合；显式 `Ctrl-Space` 仍展示完整目录；(2) 上下文识别重构为行源核心 `openingFenceTokenContextFromLineSource`，completion source 改用 CodeMirror `Text` 行 API（`doc.line(n)`），不再调用 `state.doc.toString()`；核心先只读当前行做 fence 词法快速判定，普通段落与非 token 位置直接返回 `null` 不扫描上方，避免普通 Markdown 输入触发全文 O(行数) 扫描。再修复两个问题：(3) `Editor.tsx` 在 `disabled` 转 `true` 时调用 `closeCompletion` 关闭活动候选，`apply` 起始复核 `view.state.readOnly`，防止候选打开后进入只读/忙碌仍可经鼠标确认写入；(4) 嵌套判定优先用 Markdown 语法树（新增 `fenceOpeningNestingFromTree`/`openingFenceTokenContextFromState`，按 `FencedCode` 节点 O(树深) 判断光标行是否处于上方未闭合 fence 内），`openingFenceTokenContextFromLineSource` 增加可选 `nestingOracle`，仅当树未覆盖到光标（`tree.length < line.to`）或 oracle 未提供时才回退到逐行扫描，避免大文档 fence 输入时的 O(行数) 上方扫描。
- **验证记录**：`npm run check` 通过（typecheck + vitest **372 passed / 0 failed**，新增 `markdownFenceLanguageCompletion` 用例含：前缀过滤/大小写/中部 token/无匹配 null、非 fence·closing·content·嵌套·第二 token null、只读/多选·非空选 null、裸 fence 非显式 null 而显式给完整目录、普通段落不调用 `toString()`、确认替换·光标位置·一次撤销·确认后下一 Enter 自动闭合、候选打开后转只读确认不写入，以及真实 `input.type` 事务 + 自动激活 + Enter 的裸 fence 自动闭合与 `j` 前缀确认候选，和 `fenceOpeningNestingFromTree` 树判定（无外层放行/未闭合内拒绝/闭合后放行/`openingFenceTokenContextFromState` 嵌套拒绝）；新增 `openingFenceTokenContextFromLineSource` 用例含：普通段落仅读当前行、非 token 位置仅读当前行、fence 行才向上扫描、嵌套拒绝，以及大文档（2000/500/1000 行）`nestingOracle` 命中只读当前行、回退逐行扫描、嵌套直接拒绝的调用计数；新增 Editor 用例：Markdown 给候选、plain-text 与只读不给、弹层打开后切 `disabled` 关闭候选且文档不可修改；既有 Editor/高亮/fence 契约测试不回退）；`npm run build` 通过（Vite 大 chunk 提示为既有，不影响本切片）；`git diff --check` 通过。前端切片，未运行 release 构建或 macOS 真实应用键盘/弹层定位人工验收，留给集成验收切片。

### 建立 Markdown opening fence 候选上下文与词表契约

- **状态**：已完成
- **开始日期**：2026-08-13
- **完成日期**：2026-08-13
- **Feature Spec**：`docs/features/markdown-fence-language-suggestions.md`
- **结果**：交付可由后续 CodeMirror completion source 直接消费的纯函数契约，未接入 UI。`src/markdownCodeHighlight.ts` 把既有 info token 映射整理为单一导出目录 `FENCE_LANGUAGE_DIRECTORY`（每项含 canonical 名称、可检索别名与预览解析目标 `previewTarget`），`INFO_TOKEN_TO_LANGUAGE` 改为目录派生，`resolveMarkdownCodeBlockLanguage` 既有解析结果不变（`mermaid` 进入目录但高亮仍返回 `null`）。`src/markdownFenceContext.ts` 新增 `openingFenceTokenContext(text, offset)`：复用既有 `classifyFenceLine`/`isClosingFor` 与上方未闭合 fence 扫描，识别有效非嵌套 opening fence 首个 info token，返回 `{ marker, prefix, from, to }`；首个 token 位置与 `fenceContextAt` 的 `infoToken` 归一化一致（跳过标记后前导空白），空 token 时 `from === to`，不要求 opening 在下方已闭合。`src/markdownFenceLanguageSuggestions.ts` 新增 `suggestFenceLanguages(prefix)`（按目录顺序、大小写不敏感前缀过滤 canonical 与别名，去重只返回 canonical，别名只检索不出现，无匹配返回空）与 `buildFenceLanguageInsertion(context, canonical)`（用 canonical 替换首个 token 范围，光标在 token 中部时仍替换整个 token，canonical 为空返回 `null`）。本切片不接入 `@codemirror/autocomplete`、不渲染弹层、不处理键盘导航/Enter/Tab/Escape 优先级、不触及 React 状态/Preview/WYSIWYG/Rust/capability。
- **验证记录**：`npm run check` 通过（typecheck + vitest **341 passed / 0 failed**，新增 `markdownFenceLanguageSuggestions` 12 用例、`openingFenceTokenContext` 16 用例、`FENCE_LANGUAGE_DIRECTORY` 3 用例；既有 `markdownCodeHighlight`/`markdownFenceContext`/Markdown 高亮与 Mermaid 测试不回退）；`npm run build` 通过（Vite 大 chunk 提示为既有，不影响本切片）；`git diff --check` 通过。纯前端契约切片，未运行 release 构建、macOS 真实交互或依赖变更。

### 确认 Markdown opening fence 语言候选提示规格

- **状态**：已完成
- **开始日期**：2026-08-13
- **完成日期**：2026-08-13
- **Feature Spec**：`docs/features/markdown-fence-language-suggestions.md`
- **结果**：确认首版只展示/插入 canonical 语言名称，既有别名只参与检索；候选打开时 Enter/Tab 先确认、再次 Enter 执行 opening fence 自动闭合，Escape 关闭后 Enter 直接走既有行为；无匹配关闭候选；采用官方 `@codemirror/autocomplete`，后续实现声明直接依赖并提供受限 completion source。Feature 拆为纯上下文/词表契约、候选 UI/键盘接入、集成验收三个后续任务，首个实现切片已进入待办。
- **验证记录**：核对 `src/markdownCodeHighlight.ts`、`src/languageRecognition.ts`、`src/Editor.tsx` 与 `npm ls @codemirror/autocomplete --depth=2`；确认依赖树当前统一使用 `@codemirror/autocomplete@6.20.3`。本任务仅修改规划文档，未修改实现代码、实现性测试或依赖，未运行测试或构建；`git diff --check` 通过。

### Markdown Preview 同步滚动 macOS 真实应用验收

- **状态**：已完成
- **开始日期**：2026-08-12
- **完成日期**：2026-08-13
- **Feature Spec**：`docs/features/markdown-preview-sync-scroll.md`
- **结果**：在 release `Textora.app` 中完成长 Markdown 文档真实交互验收：源码→预览、预览→源码、编辑后重新同步、Mermaid 异步渲染后定位均工作；关闭 Preview、进入 WYSIWYG、切到 Plain Text 标签后同步停止；未观察到明显抖动或循环。Feature Spec 状态改为已完成，README 与 backlog 同步收尾。
- **验证记录**：真实 release app 使用标题、段落、列表、表格、JSON fence 与 Mermaid fence 的临时文档执行 Page Down/Page Up 双向滚动；截图观察左右对应区域共同变化，Mermaid 完成本地渲染；编辑触发预览重渲染后再次滚动仍同步；Preview/WYSIWYG/非 Markdown 边界通过。临时验收文件未保存并已清理。本轮未重跑自动化或构建，沿用前置任务已通过的 `npm run check`（310 tests）和 `npm run tauri -- build` 记录。

### 修复 Markdown Preview 同步滚动审查问题

- **状态**：已完成
- **开始日期**：2026-08-12
- **完成日期**：2026-08-12
- **Feature Spec**：`docs/features/markdown-preview-sync-scroll.md`
- **结果**：修复代码审查发现的两个问题。`App` 在预览→源码程序滚动后新增下一动画帧兜底复位 `editorProgrammaticScrollRef`，避免目标已在当前位置、滚动被夹住或未产生源码 scroll 事件时，下一次用户主动滚动源码被误吞；对应 App 回归测试覆盖预览→源码请求后，后续源码滚动仍能带动预览。README 合并 `docs/features/markdown-preview-sync-scroll.md` 重复入口，只保留「实现完成、macOS 真实应用验收待执行」这一当前真实状态。
- **验证记录**：`npm run test -- App -t "scrolls the editor to the source line"` 通过（1 passed / 0 failed）；`npm run check` 通过（typecheck + vitest **310 passed / 0 failed**）；`git diff --check` 通过。未运行 release 构建或 macOS 真实应用人工验收，后者仍为下一项已承诺待办。

### Markdown Preview 同步滚动集成验收与文档收尾

- **状态**：自动化、release 构建与启动确认完成；macOS 真实滚动交互验收待执行
- **开始日期**：2026-08-12
- **完成日期**：2026-08-12
- **Feature Spec**：`docs/features/markdown-preview-sync-scroll.md`
- **结果**：完成双向同步滚动的组合自动化、release 构建、bundle 与权限校验、release 启动确认与文档收尾。`docs/features/markdown-preview-sync-scroll.md` 状态改为「实现完成，macOS 真实应用验收待执行」，9 条可由自动化/代码/权限确认的验收条件已勾选，最后一条 macOS 真实应用验收条件与「已完成」状态待人工执行后落实；README 文档导航新增本规格条目（同状态）。功能为纯前端本地能力：双向块级锚点映射 + rAF 节流 + 双向程序滚动标记抑制循环；Preview 关闭/WYSIWYG/非 Markdown 经可见性与监听生命周期停止同步。未改保存链路、Rust/capability。
- **验证记录**：`npm run check` 通过（typecheck + vitest **310 passed / 0 failed**）；`npm run tauri -- build` 通过并生成 release `Textora.app`；bundle 校验 `CFBundleIdentifier`=`com.tsingmu.textora`、`CFBundleExecutable`=`textora`、`CFBundleIconFile`=`icon.icns`；`src-tauri/capabilities/` 自 `63800c3` 起无改动，确认未新增网络、shell、远程页面、Rust IPC、Tauri capability 或宽泛文件权限；release app 可启动；`git diff --check` 通过。macOS 真实 WebView 内双向滚动、抖动/循环视觉判定与 Mermaid 异步高度等真实交互待人工执行（当前自动化环境无法可靠观察 WebView 滚动），逻辑层由自动化确定性覆盖。

### 接入 Markdown 预览到源码同步滚动与边界恢复

- **状态**：已完成
- **开始日期**：2026-08-12
- **完成日期**：2026-08-12
- **Feature Spec**：`docs/features/markdown-preview-sync-scroll.md`
- **结果**：交付预览→源码方向的同步滚动与双向循环抑制。`src/markdownPreviewSync.ts` 新增 `topPreviewBlockIndex(relativeTops)`（视口顶部块 = 相对偏移 `<= 0` 的最后一个块）与 `previewBlockRelativeTops(pane, content)`（按 live `getBoundingClientRect` 计算，预览重渲染/Mermaid 异步高度变化后的新结构在下次滚动自动反映）。`Editor` 的 `EditorHandle` 新增 `scrollToSourceLine(line)`：把 0-based 行映射到 1-based 并经 `EditorView.scrollIntoView(pos, {y:"start"})` 程序滚动。`App` 新增 `previewPaneRef`、`editorProgrammaticScrollRef` 与 `handlePreviewScroll`（rAF 节流→`topPreviewBlockIndex`→`editorRef.scrollToSourceLine`）；`useEffect` 在预览可见时挂载、关闭/切走时卸载预览滚动监听；`handleEditorScroll` 顶部检查 `editorProgrammaticScrollRef`，`handlePreviewScroll` 顶部检查 `previewProgrammaticScrollRef`，任一方向程序滚动产生的反向事件被复位并跳过，抑制双向循环。Preview 关闭/WYSIWYG/非 Markdown 经 `markdownPreviewVisibleRef` 与监听生命周期停止同步。
- **验证记录**：`npm run check` 通过（typecheck + vitest **310 passed / 0 failed**，新增 `markdownPreviewSync` 4 用例：`previewBlockRelativeTops` 相对偏移、`topPreviewBlockIndex` 各边界；新增 1 个 App 用例：Markdown Preview 滚动请求源码编辑区滚动到对应源码块；既有双向/映射/Editor 测试不回退）；`npm run build` 通过；`git diff --check` 通过。前端切片，未运行 release 构建或 macOS 真实交互（留给集成验收切片）。

### 接入 Markdown 源码到预览同步滚动

- **状态**：已完成
- **开始日期**：2026-08-12
- **完成日期**：2026-08-12
- **Feature Spec**：`docs/features/markdown-preview-sync-scroll.md`
- **结果**：交付源码→预览方向的同步滚动。新增 `src/markdownPreviewSync.ts`：`previewBlockIndexForSourceLine(blockMap, sourceLine)` 按 0-based 源码行返回对应预览块序号（首块前回落首块、末块后回落末块）；`scrollPreviewToBlock(container, blockIndex, programmaticRef)` 把容器第 N 个顶层元素 `scrollIntoView({block:"start"})`，并在滚动前置位程序标记、下一动画帧复位（供切片 4 抑制反向循环）。`Editor` 新增可选 `onScroll(topLine)` prop：挂载时在 `view.scrollDOM` 上注册 `scroll` 监听（卸载时移除），按 `lineBlockAtHeight(scrollTop)` 计算顶部可见源码行（0-based，失败回 `null`）回调。`App` 在 Markdown Preview 可见时用 `useMemo` 派生 `markdownBlockMap`；`handleEditorScroll` 经 `requestAnimationFrame` 节流、用 `previewBlockIndexForSourceLine` + `scrollPreviewToBlock` 把预览对应块滚到顶部；Preview 关闭/WYSIWYG/非 Markdown 时通过 `markdownPreviewVisibleRef` 提前返回不滚动；预览重渲染后基于新 `session.content` 的映射重建。程序滚动标记写入 `previewProgrammaticScrollRef`。
- **验证记录**：`npm run check` 通过（typecheck + vitest **305 passed / 0 failed**，新增 `src/markdownPreviewSync.test.ts` 8 用例：行→块映射各边界、scrollIntoView 调用与 rAF 复位标记、无效序号；新增 2 个 App 用例：Markdown Preview 可见时源码滚动跟随到预览块、非 Markdown 不触发；既有 `markdownBlockMap`/`markdownPreview`/Editor 测试不回退）；`npm run build` 通过；`git diff --check` 通过。前端切片，未运行 release 构建或 macOS 真实交互（双向与边界恢复留给切片 4，集成验收留给切片 5）。

### 建立 Markdown Preview 源码块与预览块映射契约

- **状态**：已完成
- **开始日期**：2026-08-12
- **完成日期**：2026-08-12
- **Feature Spec**：`docs/features/markdown-preview-sync-scroll.md`
- **结果**：在 `src/markdownPreview.ts` 建立块级映射契约。`renderMarkdownToSafeHtml` 重构为返回 `{ html, blockMap }`：在原 push 点经 `pushBlock(kind, startLine, html)` 并行记录每个块的 `{ index, kind, startLine, endLine }`（序号 = push 前 `blocks.length`，endLine = 当前 `index`），HTML 字符串与渲染顺序完全不变（既有预览测试不回退）。新增导出 `MarkdownBlockKind`（heading/paragraph/fence/list/table/blockquote/hr/mermaid）、`MarkdownBlock` 类型，以及纯函数 `collectMarkdownBlockMap(source)`（= `renderMarkdownToSafeHtml(source).blockMap`，不依赖 Mermaid 异步预览内容即可识别 mermaid 块的源码行范围）。每个块都渲染为单一根元素，序号 ↔ 预览容器顶层元素一一对应，作为后续同步滚动的稳定 DOM 锚点，无需 `data-*` 属性、不改渲染结果。未接入滚动事件、DOM 监听或 Mermaid 安全清洗。
- **验证记录**：`npm run check` 通过（typecheck + vitest **295 passed / 0 failed**，新增 `src/markdownBlockMap.test.ts` 12 用例：空/纯空白、多行段落、标题+段落、围栏、Mermaid 围栏、无序/任务列表、有序列表、表格、引用、分隔线、混合连续块与序号、相邻围栏；既有 `markdownPreview` 7 用例不回退）；`npm run build` 通过；`git diff --check` 通过。纯前端契约切片，未运行 release 构建或 macOS 真实交互。

### 确认 Markdown Preview 同步滚动规格

- **状态**：已完成
- **开始日期**：2026-08-12
- **完成日期**：2026-08-12
- **Feature Spec**：`docs/features/markdown-preview-sync-scroll.md`
- **结果**：把同步滚动规格从草案改为已确认。两个开放问题决议为：采用块级锚点映射作为首版主路径——核对 `src/markdownPreview.ts` 的 `renderMarkdownToSafeHtml` 已按行扫描源码并按块（fenced code、标题、分隔线、表格、引用、列表、段落）消费连续源码行，能为每个预览块记录源码行范围并以稳定 DOM 锚点标记，无需退化为纯滚动比例同步；首版不提供禁用同步滚动的 UI 开关。规格以「决议记录」替换「开放问题」，补验证记录。首个实现切片「建立 Markdown Preview 源码块与预览块映射契约」进入已承诺待办。
- **验证记录**：文档审查与 `git diff --check` 通过；本任务仅修改规划文档，未运行实现测试或构建。

### 修复 Markdown 文档中 opening fence 自动闭合仍失效

- **状态**：已完成
- **开始日期**：2026-08-12
- **完成日期**：2026-08-12
- **Feature Spec**：`docs/features/markdown-fenced-code-editing.md`
- **结果**：修复用户确认的 Plain Text 可用但 Markdown 文档仍不可用问题。保留高优先级 Enter keymap，同时新增 `markdownFenceAutoCloseFallbackExtension` 事务兜底：当真实 WebView 或 Markdown 语言扩展路径先产生普通 `input.newline` 事务时，若换行前状态位于未闭合 opening fence 行末，则在提交前改写为自动补齐 closing fence 的同一事务语义。该兜底只在当前行确认为 opening fence 时生效，非 fence 行、已有 closing fence、选区/多光标仍走默认编辑。未实现 <code>```j</code> 语言候选提示，未处理 Preview 同步滚动，未新增格式化器、LSP、网络、Rust IPC 或 WYSIWYG 行为。
- **验证记录**：`npm run test -- Editor -t "markdown fence auto-close"` 通过（相关 **16 passed / 0 failed**）；`npm run check` 通过（typecheck + vitest **283 passed / 0 failed**）；`npm run tauri -- build` 通过并生成 release `Textora.app`；已覆盖部署到 `/Applications/Textora.app` 并执行本机 ad-hoc 重签名。新增测试覆盖 Markdown 模式中默认换行事务被兜底改写为 <code>```json\n\n```</code>；本轮未完成新的手动键入反引号真实验收，因为 Computer Use 在当前输入法下不能可靠输入反引号，只能验证 exact 文本与自动化默认换行路径。

### 复查并修复已部署应用中 opening fence 自动闭合仍失效

- **状态**：已完成
- **开始日期**：2026-08-12
- **完成日期**：2026-08-12
- **Feature Spec**：`docs/features/markdown-fenced-code-editing.md`
- **结果**：复查用户反馈的已部署应用仍不自动补齐问题。真实应用确认当编辑器内容确实为 <code>```json</code> 且光标在行末时，上一轮 Markdown/Plain Text 路径可补齐；为覆盖真实标签可能被识别为 JSON 或其他源码语言的场景，自动闭合命令改为不按语言提前退出，而是仅由“当前行是否为未闭合 Markdown opening fence”决定是否接管 Enter。WYSIWYG 仍使用独立编辑器，不受影响；未实现 <code>```j</code> 语言候选提示，未处理 Preview 同步滚动，未新增格式化器、LSP、网络、Rust IPC 或保存链路。
- **验证记录**：`npm run test -- Editor App -t "auto-close|auto-closes|markdown fence"` 通过（相关 **16 passed / 0 failed**）；`npm run check` 通过（typecheck + vitest **282 passed / 0 failed**）；`npm run tauri -- build` 通过并生成 release `Textora.app`；已覆盖部署到 `/Applications/Textora.app` 并执行本机 ad-hoc 重签名；`codesign --verify --deep --strict /Applications/Textora.app` 通过；部署后真实应用用 Computer Use 验证 exact <code>```json</code> + Return，编辑器内容变为 <code>```json\n\n```</code>；`pgrep -x textora` 返回进程 PID `7681`；`git diff --check` 通过。

### 修复 Markdown opening fence 带 info string 时的自动闭合（需复查）

- **状态**：已完成
- **开始日期**：2026-08-12
- **完成日期**：2026-08-12
- **Feature Spec**：`docs/features/markdown-fenced-code-editing.md`
- **结果**：修复输入 <code>```json</code> 后按 Enter 未按用户预期补齐 closing fence 的问题。确认 Markdown 模式原有命令链路可用，并将自动闭合扩展到 Plain Text 标签，以覆盖新建/普通文本写作时输入 Markdown fence 的场景；JSON、JavaScript 等代码语言标签仍不接管 Markdown fence Enter。未实现 <code>```j</code> 语言候选提示，未新增语言、格式化器、LSP、网络、Rust IPC、保存链路或 WYSIWYG 行为。
- **验证记录**：`npm run test -- Editor App -t "auto-close|auto-closes|markdown fence"` 通过（相关 **16 passed / 0 failed**）；`npm run check` 通过（typecheck + vitest **282 passed / 0 failed**）；`npm run build` 通过（Vite 大 chunk 提示仍存在，不影响本修复）；`git diff --check` 通过。新增覆盖真实 App 编辑器中 Markdown info string opening fence 的 Enter 行为、Plain Text 标签自动闭合、代码语言标签不接管，以及既有撤销/选区/多光标边界的回归测试；本任务未运行 Tauri release 构建或 macOS 真实应用点击验收。

### 外部文件变更实时同步集成验收与文档收尾

- **状态**：已完成
- **开始日期**：2026-08-12
- **完成日期**：2026-08-12
- **Feature Spec**：`docs/features/external-file-change-sync.md`
- **结果**：完成外部文件变更实时同步首版组合验收、release 构建和文档收尾。release `Textora.app` 真实交互确认：干净活动标签在外部直接写入后自动展示新内容，临时文件原子替换能收敛到最终版本；后台标签外部变化后切回显示最新内容；脏标签外部变化进入绑定当前文件的 Reload / Overwrite / Cancel 冲突提示且保留本地编辑；文件被删除后进入 Keep content / Discard；无效 UTF-8 外部版本保留当前内容并显示 Retry，磁盘恢复为合法文本后刷新；只读权限变化更新 Read-only 状态但不替换正文；隐藏/离开应用期间外部变化在重新聚焦时显示最新内容。未新增文本合并、移动跟随、轮询、备份、版本历史、网络/目录树监听、新编码或权限扩大。
- **验证记录**：`cargo fmt --manifest-path src-tauri/Cargo.toml -- --check`、`cargo check --manifest-path src-tauri/Cargo.toml --all-targets`、`cargo test --manifest-path src-tauri/Cargo.toml`（**148 passed / 0 failed**）、`npm run check`（**279 passed / 0 failed**）、`npm run build`、`npm run tauri -- build` 与 `git diff --check` 通过，并生成 release bundle `/Users/mouqing/codexProjects/textora/src-tauri/target/release/bundle/macos/Textora.app`。macOS release 真实文件交互使用 `/private/tmp/textora-external-sync.Q0b7tj` 临时文件完成上述场景；自身保存抑制、编码/换行描述同步、多标签生命周期、Save As/关闭/过期异步结果、文本相同但字节变化、超限与 I/O 错误路径由 Rust/前端自动化覆盖。

### 接入聚焦恢复兜底复核

- **状态**：已完成
- **开始日期**：2026-08-12
- **完成日期**：2026-08-12
- **Feature Spec**：`docs/features/external-file-change-sync.md`
- **结果**：新增受限 `refresh_external_document(id)` IPC，聚焦/恢复时以可信文档 ID 对所有已关联且非忙碌标签逐一复核，返回与实时监听相同的安全变化信号；Rust 监听线程也改为复用同一个 `external_change_signal` 映射，避免实时与兜底路径分叉。React 将实时监听处理抽成 `handleExternalDocumentChange`，聚焦复核只负责去重、过期校验和投递信号；内容变化、脏标签冲突、缺失、重载失败和只读 metadata 均复用既有实时路径。重复 focus 事件会按文档去重；标签关闭/另存为/路径变化后的迟到结果会被丢弃。额外修复 missing 二次确认失败时的未处理 rejection，保留内容并允许后续事件或 focus 再试。未运行 release 真实交互，未新增轮询、移动跟随或最终文档收尾。
- **验证记录**：`cargo fmt --manifest-path src-tauri/Cargo.toml -- --check`、`cargo check --manifest-path src-tauri/Cargo.toml --all-targets`、`cargo test --manifest-path src-tauri/Cargo.toml`（**148 passed / 0 failed**）、`npm run test -- App platform`（**126 passed / 0 failed**）、`npm run typecheck`、`npm run check`（**279 passed / 0 failed**）、`npm run build` 与 `git diff --check` 通过。新增覆盖 refresh IPC 只传文档 ID、聚焦复核全标签、后台干净标签刷新、后台脏标签冲突、重复 focus 去重，以及 missing 二次确认失败可重试的测试；未运行 release 构建或 macOS 真实文件交互。

### 接入实时只读变化同步

- **状态**：已完成
- **开始日期**：2026-08-11
- **完成日期**：2026-08-11
- **Feature Spec**：`docs/features/external-file-change-sync.md`
- **结果**：将“只读变化与聚焦恢复兜底复核”拆为实时只读变化同步与聚焦恢复兜底复核两项，本切片只交付实时 metadata 路径。React 对 `metadata` 事件改走轻量元数据采用流程：调用既有 `prepare_external_reload(id)` 后只在返回 `metadata` 候选时提交 `commitExternalMetadata`，不进入 loading、不读取正文、不替换文本、不清除脏状态；活动和后台标签都按文档 ID/路径绑定更新。脏标签可同步只读 badge 与保存禁用状态，同时保留本地编辑内容和 Modified；忙碌、过期、路径变化或候选不再是 metadata 时不污染会话。未处理聚焦/睡眠兜底复核、监听失效复核、release 真实交互或最终文档收尾。
- **验证记录**：`cargo fmt --manifest-path src-tauri/Cargo.toml -- --check`、`cargo check --manifest-path src-tauri/Cargo.toml --all-targets`、`cargo test --manifest-path src-tauri/Cargo.toml`（**148 passed / 0 failed**）、`npm run test -- App documentSession platform`（**141 passed / 0 failed**）、`npm run typecheck`、`npm run check`（**276 passed / 0 failed**）、`npm run build` 与 `git diff --check` 通过。新增覆盖活动标签只读 metadata 不读正文/不进 loading、脏标签同步只读但保留本地内容与 Modified、后台标签只读变化归属的测试；未运行 release 构建或 macOS 真实文件交互。

### 接入实时重载失败保护

- **状态**：已完成
- **开始日期**：2026-08-11
- **完成日期**：2026-08-11
- **Feature Spec**：`docs/features/external-file-change-sync.md`
- **结果**：监听复核到 `ReloadFailed` 时，Rust 现在以 `reloadFailed` 事件向前端发送稳定 `DocumentCommandError`，不暴露路径、指纹或内部 I/O 文本；新增 `retry_external_reload(id)` 受限 IPC，Retry 会重新复核可信目标，结果收敛为 ready/missing/failed/unchanged。React 将外部重载失败按 `documentId` 记录，提示只在对应标签活动且仍为同一路径、干净且空闲时显示；后台标签失败不会污染当前标签。用户点击 Retry 后目标标签进入 loading，成功则复用既有二进制内容通道采用 content/metadata 候选，仍失败则更新安全错误，目标缺失则转入绑定的缺失 Keep/Discard 流程，过期、变脏、忙碌或路径变化会清理提示且不替换内容。未处理只读变化、聚焦/睡眠兜底、release 真实交互或最终文档收尾。
- **验证记录**：`cargo fmt --manifest-path src-tauri/Cargo.toml -- --check`、`cargo check --manifest-path src-tauri/Cargo.toml --all-targets`、`cargo test --manifest-path src-tauri/Cargo.toml`（**148 passed / 0 failed**）、`npm run test -- App platform`（**120 passed / 0 failed**）、`npm run typecheck`、`npm run check`（**273 passed / 0 failed**）、`npm run build` 通过。新增覆盖 Retry 仍失败错误码、Retry 修复后采用内容、IPC 只传文档 ID、活动标签失败提示/Retry、后台标签失败归属的测试；未运行 release 构建或 macOS 真实文件交互。

### 接入实时缺失保护

- **状态**：已完成
- **开始日期**：2026-08-11
- **完成日期**：2026-08-11
- **Feature Spec**：`docs/features/external-file-change-sync.md`
- **结果**：将“实时缺失与重载失败保护”继续拆为实时缺失与重载失败重试两项，本切片只交付稳定缺失事件。Rust 监听线程现在会把 `ExternalChange::Missing` 作为 `missing` 事件通知前端；React 收到后先用既有 `check_target_exists(documentId)` 复核当前可信目标，过滤 Save As、关闭或路径恢复后的迟到事件。缺失提示改为绑定 `tabId`/`documentId`/`path`/`displayName`，活动与后台标签均可进入同一 Keep / Discard 流程；Keep 只解除目标标签路径并保留内容为 Modified，Discard 只关闭目标标签，当前活动标签不会被误改。普通保存、关闭前保存和 Save As 中遇到 target missing 也改用同一绑定提示。未处理超限、编码无效、读取期间再次变化、权限或一般 I/O 重载失败；未处理只读变化、聚焦/睡眠兜底或 release 真实交互。
- **验证记录**：`cargo fmt --manifest-path src-tauri/Cargo.toml -- --check`、`cargo check --manifest-path src-tauri/Cargo.toml --all-targets`、`cargo test --manifest-path src-tauri/Cargo.toml`（**146 passed / 0 failed**）、`npm run test -- App`（**102 passed / 0 failed**）、`npm run typecheck`、`npm run check`（**270 passed / 0 failed**）、`npm run build` 与 `git diff --check` 通过。新增覆盖活动标签实时缺失、后台标签缺失归属、Keep/Discard 只作用于目标标签、当前目标恢复后忽略迟到 missing 事件的测试；未运行 release 构建或 macOS 真实文件交互。

### 接入脏标签的主动内容冲突

- **状态**：已完成
- **开始日期**：2026-08-11
- **完成日期**：2026-08-11
- **Feature Spec**：`docs/features/external-file-change-sync.md`
- **结果**：将原“脏标签冲突与缺失/失败保护”按用户行为拆为三个连续小任务，本切片只交付主动内容冲突。新增 `prepare_external_conflict` 受限 IPC：前端以 Raw UTF-8 body 提交事件到达时锁定的完整编辑快照，仅携带后端文档 ID；Rust 对对应内容候选做活动基线、世代与最新磁盘快照复核，在同一临界区消费候选并建立既有版本化 `ContentChanged` 冲突。IPC 往返期间出现更新世代时会追上最新候选，重复请求幂等且不替换首次快照；过期、回退、关闭、Save As 或其他冲突不会建立伪状态。React 在活动或后台脏标签上同步进入互斥保存态，建立成功后复用现有 Reload / Overwrite / Cancel 界面与动作，失败或候选过期则恢复编辑；干净标签自动刷新不回退。未处理路径缺失、重载失败提示、仅只读变化、聚焦/睡眠兜底或 release 真实交互。
- **验证记录**：`cargo fmt --manifest-path src-tauri/Cargo.toml -- --check`、`cargo check --manifest-path src-tauri/Cargo.toml --all-targets`、`cargo test --manifest-path src-tauri/Cargo.toml`（**146 passed / 0 failed**）、`npm run check`（**267 passed / 0 failed**）、`npm run build` 与 `git diff --check` 通过。新增覆盖活动脏标签、后台脏标签、Raw IPC、冲突快照、候选再次变化、过期解锁、重复幂等及既有取消动作复用的测试；既有重新加载/强制覆盖全套回归通过。

### 接入干净标签的实时监听与自动刷新

- **状态**：已完成
- **开始日期**：2026-08-11
- **完成日期**：2026-08-11
- **Feature Spec**：`docs/features/external-file-change-sync.md`
- **结果**：新增基于 `notify` 的 Rust 文件监听服务，按后端文档 ID 管理用户路径与符号链接真实目标的父目录，支持共享目录引用计数、关闭释放、Save As 迁移，并把事件风暴以 120 ms 窗口合并后交回 `DocumentStore` 做可信复核。新增受限 `prepare_external_reload(id)` IPC：内容变化只经 JSON 返回描述符，完整正文继续走既有二进制读取通道，且在正文成功取回前不推进活动可信基线；元数据变化不替换文本。React 按文档 ID 更新活动或后台干净标签，处理中同步加租约，脏/忙标签不被覆盖，关闭、身份变化和过期结果不能污染其他会话；自身保存事件由保存后的最终指纹复核为 unchanged。此切片未交付脏标签冲突、缺失/失败提示、聚焦/睡眠兜底或 release 真实交互。
- **验证记录**：`cargo fmt --manifest-path src-tauri/Cargo.toml -- --check`、`cargo check --manifest-path src-tauri/Cargo.toml --all-targets`、`cargo test --manifest-path src-tauri/Cargo.toml`（**143 passed / 0 failed**）、`npm run check`（**263 passed / 0 failed**）、`npm run build` 与 `git diff --check` 通过。新增覆盖二进制候选分阶段原子提升、干净活动标签刷新、脏标签不采用、后台标签归属及 IPC 参数的测试；未运行 release 构建或 macOS 真实文件交互。

### 修复外部重载候选生命周期与竞态

- **状态**：已完成
- **开始日期**：2026-08-11
- **完成日期**：2026-08-11
- **Feature Spec**：`docs/features/external-file-change-sync.md`
- **结果**：修复审查发现的四项问题。`DocumentEntry` 新增单调外部复核世代，较早开始、较晚完成的观察不能覆盖较新的候选；每次有效复核先替换整个候选槽，`Unchanged`、`Missing` 与 `ReloadFailed` 会清除旧快照；普通保存、另存为、打开/重载提升和保存冲突等活动状态转换都会使候选失效，已有冲突时分类与提升均拒绝；`take_external_reload` 在提交前再次从后端可信路径建立一致快照，候选之后磁盘再次变化时不推进旧内容或旧指纹。合并了重复的「最近完成」章节。未接入文件监听、前端自动刷新或异常 UI。
- **验证记录**：新增 4 组确定性回归测试，覆盖 changed→unchanged/missing/failure 连续分类、候选后发生保存冲突、候选后磁盘再次变化和复核乱序完成；`cargo fmt --manifest-path src-tauri/Cargo.toml --check`、`cargo check --manifest-path src-tauri/Cargo.toml --all-targets`、`cargo test --manifest-path src-tauri/Cargo.toml`（**141 passed / 0 failed**）、`npm run check`（**259 passed / 0 failed**）、`npm run build` 与 `git diff --check` 通过。

### 建立已关联文档磁盘变化分类契约

- **状态**：已完成
- **开始日期**：2026-08-11
- **完成日期**：2026-08-11
- **Feature Spec**：`docs/features/external-file-change-sync.md`
- **结果**：在 `src-tauri/src/ipc.rs` 的 `DocumentStore` 上新增外部文件变化分类与原子重载契约。`ExternalChange` 枚举分类为 `Unchanged`/`ContentChanged`/`MetadataChanged`/`Missing`/`ReloadFailed(DocumentError)`；`classify_external_change(id)` 锁内取可信基线、锁外复用 `crate::document::open_document` 的一致快照（指纹、严格编码、50 MiB 上限、读取期间变化与原子替换保护）、再锁内重新校验基线未被改动后分类并按需挂起 `ExternalReloadCandidate`（绑定基线指纹/路径供过期校验）；`take_external_reload(id)` 在候选仍匹配活动状态与最新磁盘快照且不存在冲突时原子推进活动可信状态并清空候选，返回 `ExternalReload::Content { descriptor, content }` 或 `ExternalReload::Metadata { descriptor }`，过期、冲突、候选缺失或强制覆盖中返回 `None` 不改状态。字节变化但解码文本相同（如追加 BOM）仍判为 `ContentChanged`；只读变化但内容相同判为 `MetadataChanged`；NotFound 映射为 `Missing`，其余读错误进 `ReloadFailed`。未知/过期文档 id、多文档隔离、失败保护（不替换活动状态）均覆盖。未接入持续监听、IPC 命令或前端。
- **验证记录**：`cargo fmt --manifest-path src-tauri/Cargo.toml --check`、`cargo check --manifest-path src-tauri/Cargo.toml --all-targets`、`cargo test --manifest-path src-tauri/Cargo.toml`（**137 passed / 0 failed**，新增 11 个分类契约用例：unchanged、内容变化不替换活动、字节变文本同、只读元数据变化、缺失、无效编码 ReloadFailed、未知/无候选 id、多文档隔离、内容候选原子提升、元数据候选提升、基线变化过期返回 None；既有保存冲突/打开/多标签测试不回退）；`npm run check` 通过（typecheck + vitest **259 passed / 0 failed**，前端未改）；`git diff --check` 通过。纯后端切片，未运行 release 构建或 macOS 真实交互。

### 确认外部文件变更实时同步规格

- **状态**：已完成
- **开始日期**：2026-08-11
- **完成日期**：2026-08-11
- **Feature Spec**：`docs/features/external-file-change-sync.md`
- **结果**：确认已保存标签在其他应用修改或原子替换文件后主动安全重读并自动展示最新版本；脏标签绝不静默覆盖，复用现有重新加载、强制覆盖和取消流程；删除、重命名或移走按原路径缺失处理；重载失败保留当前内容并可重试。规格同时明确自身保存事件抑制、事件合并、一致快照、多标签监听生命周期、后台标签、过期结果、符号链接、只读变化及聚焦/睡眠恢复兜底，并拆为磁盘变化分类、干净标签自动刷新、脏标签与异常保护、集成验收四个后续任务。
- **验证记录**：文档审查；`git diff --check` 通过。本任务未修改生产代码，未运行实现测试、构建或 macOS 交互验收。

### 部署当前 release 到系统应用目录

- **状态**：已完成
- **开始日期**：2026-08-11
- **完成日期**：2026-08-11
- **结果**：停止现有 Textora 测试进程，使用 `/usr/bin/ditto` 将当前 release bundle 覆盖部署到 `/Applications/Textora.app`，并对安装后的应用执行本机 ad-hoc 重签名。未创建 DMG/安装器，未做 Developer ID 签名、公证、发布上传或版本号变更。
- **验证记录**：`codesign --verify --deep --strict /Applications/Textora.app` 通过；安装后 `CFBundleIdentifier` 为 `com.tsingmu.textora`、`CFBundleExecutable` 为 `textora`；安装产物与 release bundle 的 `icon.icns` SHA-256 一致；`open -n /Applications/Textora.app` 启动成功，`pgrep -x textora` 返回进程 PID `77157`；`git diff --check` 通过。

### Markdown fenced 编辑辅助集成验收与文档收尾

- **状态**：已完成
- **开始日期**：2026-08-11
- **完成日期**：2026-08-11
- **Feature Spec**：`docs/features/markdown-fenced-code-editing.md`
- **结果**：在 release `Textora.app` 中完成 Markdown fenced 编辑辅助真实交互验收，并将 `Format JSON` 纳入现有工具栏按钮的亮色、暗色、hover 与 disabled 共用样式。真实应用确认 Enter 自动补齐 closing fence 且一次撤销恢复；Preview 左侧源码行为一致；WYSIWYG 隐藏格式化入口；有效 JSON 格式化、无效 JSON 与 `jsonc` 非阻塞提示符合规格；纯文本标签不显示入口，多标签内容互不污染；打开期间与只读文件禁用格式化；保存写回 Markdown 源码，未保存关闭仍弹出确认。未新增语言、依赖、保存链路、Rust IPC 或 capability。
- **验证记录**：`npm run check` 通过（typecheck + vitest **259 passed / 0 failed**）；`npm run tauri -- build` 通过并生成 release `Textora.app`；macOS release 真实 UI 验收覆盖格式化与撤销、无效/不支持上下文、Preview/WYSIWYG、自动闭合与撤销、纯文本/Markdown 多标签隔离、打开忙碌态、只读态、保存源码和未保存关闭保护；视觉截图确认 `Format JSON` 与 `Preview`、`WYSIWYG`、`Save As...` 使用一致按钮样式；`git diff --check` 通过。

### 修复文档末行 fence 语法树判定

- **状态**：已完成
- **开始日期**：2026-08-11
- **完成日期**：2026-08-11
- **Feature Spec**：`docs/features/markdown-fenced-code-editing.md`
- **结果**：`fenceAutoCloseDecisionFromTree` 改为在行末向左解析语法树节点，正确命中 EOF 处的 `CodeInfo`/`CodeMark` 并上溯到 `FencedCode`；不再要求树覆盖不存在的 `doc.length + 1`。只有语法树覆盖到文档末尾时，才根据单个 `CodeMark` 确认 opening 未闭合；已闭合或位于外层 fence 内仍不触发。大文档测试改用真实 `EditorView` + `forceParsing`，直接断言 EOF 语法树决策，并覆盖大文档末尾刚输入 opening fence 后立即判定。同时保留 `formatJsonNotice` 按 `session.id`/`session.path` 清除与未完成 macOS 验收任务的待开始状态。
- **验证记录**：`npm run check` 通过（typecheck + vitest **259 passed / 0 failed**）；`npm run build` 通过；`git diff --check` 通过。本任务未运行 release 构建；macOS 真实应用交互验收仍为下一项已承诺待办。

### 修复 Markdown fenced 编辑辅助四项问题

- **状态**：已完成
- **开始日期**：2026-08-11
- **完成日期**：2026-08-11
- **Feature Spec**：`docs/features/markdown-fenced-code-editing.md`
- **结果**：修复未提交变更中的四项问题。(1) **Enter 性能**：`markdownFenceContext.ts` 抽出共享核心 `unclosedOpeningFromLineSource(lineCount, getLineText, cursorLine)`，纯函数 `unclosedOpeningAtLineEnd` 改为薄封装；`Editor.markdownFenceAutoCloseSpec` 改用 CodeMirror `doc.line(n)` 行 API 按需取行，删除 Enter 热路径上的 `state.doc.toString()`/`splitLines` 全文扫描。(2) **跨标签提示隔离**：`App.tsx` 在 `activeTabId` 变化（覆盖切换/新建/关闭/打开/另存为）与 WYSIWYG 切换时清除 `formatJsonNotice`，避免跨标签/跨模式残留。(3) **真实验收状态**：按实际执行修正 Feature Spec/README/current.md——macOS 真实应用交互验收**未执行**，Feature Spec 状态改为「实现完成，macOS 真实应用交互验收待执行」、对应验收条件改为未勾选、README 将本功能从「已完成 macOS 真实应用验收」中拆出。(4) **章节合并**：合并 `current.md` 中因历次编辑累积的 5 个重复「最近完成」章节为单一章节。补充测试：Editor 大文档普通换行不触发自动闭合、inside-fence 不触发、shorter-closing 下方仍触发；App 跨标签切换与 WYSIWYG 切换清除提示。
- **验证记录**：`npm run check` 通过（typecheck + vitest **254 passed / 0 failed**，新增 3 个 Editor + 2 个 App 用例）；`npm run build` 通过；`git diff --check` 通过。本任务未运行 release 构建；macOS 真实应用交互验收仍待人工执行（见下「集成验收」条目的未尽事项）。

### 接入 fenced JSON 显式格式化

- **状态**：已完成
- **开始日期**：2026-08-11
- **完成日期**：2026-08-11
- **Feature Spec**：`docs/features/markdown-fenced-code-editing.md`
- **结果**：`src/Editor.tsx` 新增 `formatJsonFencePlan(state)`：用 `fenceContextAt` 判定主光标是否在闭合 fence 内容区且 `infoToken === "json"`（大小写不敏感，`jsonc`/`application/json`/未知不匹配），命中则用浏览器内建 `JSON.parse`/`JSON.stringify(value, null, 2)` 把整个内容区替换为 2 空格缩进标准 JSON（末尾保留换行使 closing 独占一行，自然去除原有首尾空白行），单次事务 `userEvent: "format.json"` 可一次撤销，光标映射到内容区起始；解析失败返回 `invalid-json`，上下文不匹配返回 `no-context`，二者都不改源码/选择/撤销历史。`EditorHandle` 新增 `formatJsonFence()`，在 Markdown 且视图就绪时返回计划结果并在 `apply` 时派发事务，否则返回 `unavailable`。`src/App.tsx` 新增 `Format JSON` 工具栏按钮（仅 Markdown 源码、非 WYSIWYG 显示；`!canEdit || readOnly` 禁用）与非阻塞 `notice-format-json` 提示（`no-context`/`invalid-json` 各自安全文案 + Dismiss，不阻止编辑/保存/切换/关闭）；WYSIWYG 用独立编辑器组件，格式化天然只作用于 Markdown 单栏与 Preview 左侧源码。未改 Rust/capability/保存链路。
- **验证记录**：`npm run check` 通过（typecheck + vitest **249 passed / 0 failed**，新增 8 个 `formatJsonFencePlan` 用例：有效 JSON 2 空格重排、紧凑/凌乱 JSON 规范化、大写 JSON 命中、无效 JSON 不改文档、未闭合/`jsonc`/未知/普通文本/fence 行光标均 `no-context`、一次撤销；新增 4 个 App 用例：Markdown 显示按钮且纯文本不显示、WYSIWYG 隐藏按钮、只读禁用、行首光标命中非阻塞提示且文档不变 + Dismiss 清除）；`npm run build` 通过；`git diff --check` 通过。前端切片，macOS release 真实交互验收留给集成验收切片。

### 实现 Markdown opening fence 自动闭合

- **状态**：已完成
- **开始日期**：2026-08-11
- **完成日期**：2026-08-11
- **Feature Spec**：`docs/features/markdown-fenced-code-editing.md`
- **结果**：扩展 `src/markdownFenceContext.ts` 新增 `unclosedOpeningAtLineEnd(text, offset)`：光标在行末、该行符合 opening fence 词法、未被上方未闭合 fence 包住、下方无匹配 closing 时返回 `marker`/`length`/`indent`，供自动闭合构造 closing；复用既有 `classifyFenceLine`/`isClosingFor`。`src/Editor.tsx` 新增 `markdownFenceAutoCloseSpec(state)` 与 `markdownFenceAutoCloseCommand(language)`：单一空光标命中未闭合 opening 行末时，在光标处插入 `\n\n` + 复制 opening 字符/长度/缩进的 closing，光标停在空内容行，单次事务 `userEvent: "input.newline"` 可一次撤销；非 Markdown、非空选区、多选区、非行末、已闭合或被外层 fence 包住时返回 false 交回默认 Enter。Editor 组件新增 `languageRef`（随 `language` prop 同步），在挂载扩展中加入 `Prec.high` Enter keymap 调用命令；由于 WYSIWYG 使用独立编辑器组件，自动闭合天然只作用于 Markdown 单栏与 Preview 左侧源码编辑器。未改列块编辑语义、保存/关闭保护链路、Rust/capability。
- **验证记录**：`npm run check` 通过（typecheck + vitest **237 passed / 0 failed**，新增 9 个 `unclosedOpeningAtLineEnd` 用例 + 6 个 Editor 自动闭合用例：插入空内容行+匹配 closing、复制字符/长度/缩进、已有 closing 不接管、非空选区/多选/非行末不接管、一次撤销、非 Markdown 不接管）；`npm run build` 通过；`git diff --check` 通过。前端切片，未运行 release 构建，macOS 真实 Enter 交互留给集成验收切片。

### 建立 Markdown fence 上下文识别契约

- **状态**：已完成
- **开始日期**：2026-08-11
- **完成日期**：2026-08-11
- **Feature Spec**：`docs/features/markdown-fenced-code-editing.md`
- **结果**：新增纯前端模块 `src/markdownFenceContext.ts` 与测试 `src/markdownFenceContext.test.ts`，建立后续自动闭合与 fenced JSON 格式化共同依赖的单一来源。`classifyFenceLine(lineText)` 做行级词法判断：0–3 个前导空格、≥3 个连续反引号或波浪号，返回 `indent`/`marker`/`length`/`rest`，否则 `null`。`fenceContextAt(text, offset)` 自上而下扫描行，追踪当前打开的 fence，遇到同字符且长度不短于 opening、标记后无非空白内容的 closing 时结束代码块；返回 `marker`/`openLength`/`indent`/`infoToken`（首 token 小写归一化）/`opening`/`closing`（未闭合为 `null`）/`content` 半开 offset 区间。光标位于 opening 与 closing 之间内容区才返回上下文；fence 标记行、普通文本、代码块外、4+ 前导空格、越界 offset 返回 `null`；内容中较短的同类标记、另一种字符或带非空 info 的候选 closing 行不结束当前代码块；相邻多个代码块各自独立识别。导出 `classifyFenceLine` 供后续自动闭合切片复用，避免在 Editor/Preview/WYSIWYG 复制 fence 正则。
- **验证记录**：`npm run test -- markdownFenceContext` 通过（**20 passed / 0 failed**）；`npm run check` 通过（typecheck + vitest **222 passed / 0 failed**）；`npm run build` 通过；`git diff --check` 通过。纯前端契约切片，未改 Editor/应用 UI/Rust/capability，未改变当前可观察行为，未做 macOS 真实交互。

### 确认 Markdown fenced code block 编辑辅助规格

- **状态**：已完成
- **开始日期**：2026-08-11
- **完成日期**：2026-08-11
- **Feature Spec**：`docs/features/markdown-fenced-code-editing.md`
- **结果**：新增并确认 Markdown fenced code block 编辑辅助规格。首版只作用于 Markdown 源码编辑器（包含 Preview 左侧，不包含 WYSIWYG）；支持反引号/波浪号 fence、至少 3 个标记字符和 0–3 个前导空格；单一空光标在未闭合 opening fence 行末按 Enter 时自动补齐结构；JSON 格式化必须通过 `Format JSON` 显式触发，只接受严格 `json` fence，采用 2 空格缩进，无效或错位上下文提示且不改源码。功能拆为上下文识别契约、自动闭合、显式 JSON 格式化和集成验收四个后续切片，首个切片已进入已承诺待办。
- **验证记录**：文档审查与 `git diff --check` 通过；本任务未修改生产代码，未运行实现测试或构建。

### 完成 Markdown WYSIWYG 真实应用验收与文档收尾

- **状态**：已完成
- **开始日期**：2026-08-11
- **完成日期**：2026-08-11
- **Feature Spec**：`docs/features/markdown-wysiwyg-mode.md`
- **结果**：新增 `samples/markdown-wysiwyg-smoke.md` 真实应用冒烟样例并完成 WYSIWYG 首版组合验收。macOS release 应用确认 Markdown 才显示 Preview/WYSIWYG 入口；WYSIWYG 正确呈现并可编辑标题、段落、列表、任务项、引用和 fenced code block；切换 Preview 会退出 WYSIWYG 并显示同步后的源码派生结果；切到普通标签再返回时 Markdown 模式与内容保持隔离；保存只写 Markdown 源码，表格、Mermaid fence 与原始 HTML 源码岛保持；未保存关闭会弹出保存确认；只读文件进入 WYSIWYG 后所有字段与任务复选框均禁用。验收未发现需要修改生产代码的阻塞问题，未新增自动闭合 fence、代码格式化、富文本粘贴、跨重启恢复、网络、shell、Rust IPC 或 Tauri capability。
- **验证记录**：`npm run test -- markdownWysiwyg MarkdownWysiwygEditor tabSession App` 通过（**98 passed / 0 failed**）；`npm run check` 通过（typecheck + vitest **202 passed / 0 failed**）；`npm run build` 通过；`npm run tauri -- build` 通过并生成 release `Textora.app`；macOS release 真实 UI 验收覆盖模式入口与互斥、常见块编辑、源码往返、源码岛保留、保存源码、多标签隔离、只读锁定和未保存关闭保护；`git diff --check` 通过。

### 接入 Markdown WYSIWYG 模式入口与首版编辑视图

- **状态**：已完成
- **开始日期**：2026-08-10
- **完成日期**：2026-08-10
- **Feature Spec**：`docs/features/markdown-wysiwyg-mode.md`
- **结果**：Markdown 标签新增 `WYSIWYG` 工具栏入口，非 Markdown 标签不显示；WYSIWYG 与 Preview 按标签互斥，默认仍为源码编辑；首版编辑视图支持标题、段落、无序/有序/任务列表、引用、fenced code block、分隔线和源码岛编辑，修改会同步 Markdown 源码、脏状态、保存和关闭保护链路。只读 Markdown 的 WYSIWYG 字段禁用；源码编辑器保留既有只读文件本地编辑后另存为副本流程。未新增跨重启模式偏好、代码格式化、自动闭合 fence、Mermaid 可视拖拽编辑、富文本粘贴、导出、远程资源、网络、shell、Rust IPC 或 Tauri capability。
- **验证**：`npm run test -- markdownWysiwyg MarkdownWysiwygEditor tabSession App` 通过（**98 passed / 0 failed**）；`npm run check` 通过（typecheck + vitest **202 passed / 0 failed**）；`npm run build` 通过；`npm run tauri -- build` 通过并生成 release `Textora.app`；`git diff --check` 通过。当前自动化环境未做真实 WebView 人工点击验收。

### 建立 Markdown WYSIWYG 块模型与源码往返契约

- **状态**：已完成
- **开始日期**：2026-08-10
- **完成日期**：2026-08-10
- **Feature Spec**：`docs/features/markdown-wysiwyg-mode.md`
- **结果**：新增 `src/markdownWysiwyg.ts` 和 `src/markdownWysiwyg.test.ts`，建立首版 WYSIWYG 纯前端块模型。解析支持标题、段落、无序/有序/任务列表、引用、fenced code block 与分隔线；表格、原始 HTML、Mermaid fence、未知 fence 和未知结构作为源码岛保留；序列化会把块模型写回 Markdown 源码，为后续 UI 编辑和保存链路提供稳定 Markdown 源码契约。未接入 App 主界面，未新增 WYSIWYG 按钮、保存逻辑、依赖、网络、shell、Rust IPC 或 Tauri capability。
- **验证**：`npm run test -- markdownWysiwyg` 通过（**4 passed / 0 failed**）；`npm run build` 通过；`git diff --check` 通过。

### 确认 Markdown 所见即所得模式规格

- **状态**：已完成
- **开始日期**：2026-08-10
- **完成日期**：2026-08-10
- **Feature Spec**：`docs/features/markdown-wysiwyg-mode.md`
- **结果**：新增 Markdown 所见即所得模式规格，确认 WYSIWYG 是 Markdown 的第三种手动模式，不替代默认源码编辑，也不改变现有 Preview 左右分栏入口；模式状态按标签保存在当前会话内，不做全局偏好或重启恢复；首版优先交付标题、段落、列表、引用、fenced code block 等常见块级结构的结构化编辑，复杂语法使用源码岛；保存永远写 Markdown 源码，WYSIWYG DOM 不进入文件；Mermaid 在 WYSIWYG 首版中不做可视拖拽编辑。已拆出下一项实现切片「建立 Markdown WYSIWYG 块模型与源码往返契约」。
- **验证**：文档审查；本任务不修改生产代码，未运行构建或测试。

### 优化暗色模式下 Markdown Mermaid 箭头可读性

- **状态**：已完成
- **开始日期**：2026-08-10
- **完成日期**：2026-08-10
- **Feature Spec**：`docs/features/markdown-split-preview.md`、`docs/features/mermaid-local-preview.md`
- **结果**：优化暗色模式下 Markdown 预览内 Mermaid 图表的箭头和连接线可读性。为 `.markdown-mermaid-preview` 内 Mermaid SVG 增加暗色局部覆盖：edge path 与 arrow marker 改为高对比浅色并加粗；节点改为暗底浅字和更清晰的紫色描边；edge label、cluster 和背景标签同步暗色适配，避免节点亮底刺眼且箭头融入背景。未改变 Mermaid 源码、渲染逻辑、安全清洗策略、图表类型支持、导出、主题偏好、保存逻辑、依赖、网络、shell、Rust IPC 或 Tauri capability。
- **验证**：`npm run test -- mermaidPreview markdownPreview App` 通过（**95 passed / 0 failed**）；`npm run build` 通过；`git diff --check` 通过。本切片未运行 release 构建、未部署到 `/Applications`，视觉细节仍建议在暗色模式真实应用中人工复验。

### 继续优化暗色模式按钮与 Markdown fence 标记可读性

- **状态**：已完成
- **开始日期**：2026-08-10
- **完成日期**：2026-08-10
- **Feature Spec**：`docs/features/markdown-code-block-highlighting.md`、`docs/features/markdown-split-preview.md`
- **结果**：继续修正暗色模式剩余可读性问题。顶部工具栏按钮在暗色模式下新增更清晰的普通、hover、disabled 和 active 状态；`Save`、`Save As...`、`Sequence`、`Preview` 等按钮不再主要依赖低对比暗边框/暗文字区分。CodeMirror 编辑器接入项目级 `HighlightStyle`，让 Markdown fenced code block 的 info token（如 `json`、`bash`）走高对比的 `labelName` 配色，而不是使用默认暗蓝/紫色；同时保留既有语言重配置和编辑器实例复用行为。未新增主题偏好、用户自定义配色、语言能力、渲染逻辑、保存逻辑、依赖、网络、shell、Rust IPC 或 Tauri capability。
- **验证**：`npm run test -- Editor markdownCodeHighlight markdownPreview App` 通过（**118 passed / 0 failed**）；`npm run build` 通过；`git diff --check` 通过。本切片未运行 release 构建、未部署到 `/Applications`，视觉细节仍建议在暗色模式真实应用中人工复验。

### 优化暗色模式下 Markdown 预览与代码颜色可读性

- **状态**：已完成
- **开始日期**：2026-08-10
- **完成日期**：2026-08-10
- **Feature Spec**：`docs/features/markdown-code-block-highlighting.md`、`docs/features/markdown-split-preview.md`
- **结果**：优化暗色模式下 Markdown 分栏预览与代码颜色可读性。预览面板不再使用大片亮底；正文、标题、引用、表格、行内代码、代码块、链接/图片占位、Mermaid 容器、loading/error 占位和 Preview 激活按钮均增加暗色覆盖。语法 token 颜色改为 CSS 变量驱动，并在暗色模式下同时覆盖 Markdown 预览代码块与 CodeMirror 编辑器 token，改善截图中 fenced 语言标记和代码高亮对比不足的问题。未新增主题偏好、渲染逻辑、保存逻辑、依赖、网络、shell、Rust IPC 或 Tauri capability。
- **验证**：`npm run test -- markdownCodeHighlight markdownPreview App` 通过（**97 passed / 0 failed**）；`npm run build` 通过；`git diff --check` 通过。本切片未运行 release 构建、未部署到 `/Applications`，视觉细节仍建议在暗色模式真实应用中人工复验。

### Markdown 代码块高亮集成验收与文档收尾

- **状态**：已完成
- **开始日期**：2026-08-10
- **完成日期**：2026-08-10
- **Feature Spec**：`docs/features/markdown-code-block-highlighting.md`
- **结果**：完成 Markdown 预览代码块语法着色的组合验收、release 构建、bundle 配置检查、权限 diff、release 启动确认和文档收尾。`docs/features/markdown-code-block-highlighting.md` 已标记为已完成，验收条件全部勾选；README 当前状态与文档导航已同步；新增 `samples/markdown-code-highlight-smoke.md` 作为人工真实 UI 冒烟验证样例。未新增功能行为、复制按钮、行号、主题配置、代码执行、导出、远程资源、网络、shell、Rust IPC、Tauri capability、部署到 `/Applications`、签名/公证或安装器。
- **验证**：`npm run check` 通过（typecheck + vitest **191 passed / 0 failed**）；`npm run build` 通过；`npm run tauri -- build` 通过并生成 release `Textora.app`；bundle 检查确认 `CFBundleIdentifier` 为 `com.tsingmu.textora`、`CFBundleExecutable` 为 `textora`；capability diff 确认未新增网络、shell、文件系统或 Rust/Tauri 权限；构建产物包含 `index`、`codemirror` 与 `mermaid.core` chunk；release app 可由 `/usr/bin/open -n` 启动，提权只读进程查询确认 `Textora.app/Contents/MacOS/textora` 正在运行；`git diff --check` 通过。当前自动化环境无法可靠观察 WebView 内点击和视觉颜色，真实 UI 可用 `samples/markdown-code-highlight-smoke.md` 人工复验。

### 建立 Markdown 代码块高亮渲染契约并接入预览

- **状态**：已完成
- **开始日期**：2026-08-10
- **完成日期**：2026-08-10
- **Feature Spec**：`docs/features/markdown-code-block-highlighting.md`
- **结果**：Markdown 预览中的普通 fenced code block 现在会按 info string 首个 token 识别 JavaScript、TypeScript、JSON、HTML、CSS、Rust、Python、Java、Shell、SQL、TOML、YAML 与 Markdown 等既有语言集合，并复用 CodeMirror parser 与 `@lezer/highlight` token class 输出本地安全高亮 HTML。未知语言、空语言、Mermaid 或高亮失败退化为普通转义代码块；fenced `mermaid` 仍优先走图表渲染。预览样式新增本地 token 配色；App 级测试确认预览中可见高亮 token，同时保存仍只写 Markdown 源码，不包含 Mermaid SVG 或高亮 HTML。未新增复制按钮、行号、折叠、主题配置、代码执行、导出、远程资源、网络、shell、Rust IPC 或 Tauri capability。
- **验证**：`npm run test -- markdownCodeHighlight markdownPreview App` 通过（**97 passed / 0 failed**）；`npm run check` 通过（typecheck + vitest **191 passed / 0 failed**）；`npm run build` 通过（Vite 大 chunk 提示仍存在，不影响本切片）；`git diff --check` 通过。本切片未运行 release 构建或真实 macOS UI 验收，已拆出下一项「Markdown 代码块高亮集成验收与文档收尾」。

### 确认 Markdown 预览代码块语法着色规格

- **状态**：已完成
- **开始日期**：2026-08-10
- **完成日期**：2026-08-10
- **Feature Spec**：`docs/features/markdown-code-block-highlighting.md`
- **结果**：新增 Markdown 预览代码块语法着色规格，确认首版只处理 Markdown 预览右侧普通 fenced code block；按 info string 首个 token 大小写不敏感识别既有代码高亮语言集合；未知、空语言或高亮失败退化为普通转义代码块；fenced `mermaid` 保持图表渲染优先级；不纳入复制按钮、行号、折叠、主题配置、代码执行、LSP、导出、所见即所得、滚动同步、远程资源或新 Tauri/Rust 权限。已拆出下一项实现切片「建立 Markdown 代码块高亮渲染契约并接入预览」。
- **验证**：文档审查；`git diff --check` 通过。本任务不修改生产代码，未运行构建或测试。

### Markdown Mermaid 集成验收

- **状态**：已完成
- **开始日期**：2026-08-10
- **完成日期**：2026-08-10
- **Feature Spec**：`docs/features/markdown-split-preview.md`、`docs/features/mermaid-local-preview.md`
- **结果**：完成 Markdown 预览中 fenced `mermaid` code block 本地渲染集成的自动化、前端构建、release 构建、bundle 配置、权限 diff、按需 chunk 和 release 启动验收记录。未新增功能行为，未部署到 `/Applications`，未做签名/公证/安装器。
- **验证**：`npm run check` 通过（typecheck + vitest **184 passed / 0 failed**）；`npm run build` 通过；`npm run tauri -- build` 通过并生成 release `Textora.app`；bundle 检查确认 `CFBundleIdentifier` 为 `com.tsingmu.textora`；capability diff 确认未新增网络、shell、文件系统或 Rust/Tauri 权限；构建产物确认 Mermaid 仍作为按需 chunk 存在；release app 可启动，进程名为 `textora`；`git diff --check` 通过。本轮自动验收未直接观察 WebView 内点击结果，真实 UI 可用 `samples/markdown-mermaid-preview-smoke.md` 人工复验。

### 在 Markdown 预览中渲染 Mermaid fenced code block

- **状态**：已完成
- **开始日期**：2026-08-10
- **完成日期**：2026-08-10
- **Feature Spec**：`docs/features/markdown-split-preview.md`、`docs/features/mermaid-local-preview.md`
- **结果**：Markdown 预览现在会识别 fenced `mermaid` code block（大小写不敏感，可带空白），并复用既有 `renderMermaidPreview` 本地安全渲染契约在原位置显示图表。源码变更后约 300ms debounce 更新，渲染错误在对应代码块位置显示错误占位，不锁定 Markdown 编辑器；异步结果按活动标签与源码校验，避免旧结果覆盖新 Markdown 或污染其他标签。普通代码块继续按代码块显示；保存仍只提交 Markdown 源码，不包含 SVG 预览产物。新增 `samples/markdown-mermaid-preview-smoke.md` 作为人工冒烟验证样例。未新增 Markdown inline Mermaid、导出、所见即所得、滚动同步、全局偏好、重启恢复、远程资源、网络、shell、Rust IPC 或 Tauri capability。
- **验证**：`npm run test -- markdownPreview App` 通过（**90 passed / 0 failed**）；`npm run check` 通过（typecheck + vitest **184 passed / 0 failed**）；`npm run build` 通过，Mermaid 仍作为按需 chunk 加载；`git diff --check` 通过。本切片未运行 release 构建或真实 macOS UI 验收。

### Mermaid 集成验收与文档收尾

- **状态**：已完成
- **开始日期**：2026-08-10
- **完成日期**：2026-08-10
- **Feature Spec**：`docs/features/mermaid-local-preview.md`
- **结果**：完成 Mermaid 本地编辑与预览的组合回归、release 构建、真实 macOS 应用验收和文档收尾，并把 `docs/features/mermaid-local-preview.md` 与 README 同步为已完成状态。首版支持 `.mmd` / `.mermaid` 文件识别为 `Mermaid`、工具栏 `Preview` 开关、源码/预览左右分栏、本地 Mermaid 图表渲染、编辑后约 300ms debounce 更新、错误退化、多标签隔离、保存仍只写源码，以及 Markdown fenced Mermaid code block 仍按普通代码块显示。新增 `samples/mermaid-preview-smoke.mmd` 作为人工冒烟验证样例。未新增导出、所见即所得、滚动同步、全局偏好、重启恢复、Markdown 内嵌 Mermaid 渲染、Rust IPC、Tauri capability、网络、shell 或文件权限。
- **验证**：`npm run check` 通过（typecheck + vitest **179 passed / 0 failed**）；`npm run build` 通过；`npm run tauri -- build` 通过并生成 release `Textora.app`；bundle 检查确认 `CFBundleIdentifier` 为 `com.tsingmu.textora`；capability diff 确认未新增网络、shell、文件系统或 Rust/Tauri 权限；release app 可启动，进程名为 `textora`；`git diff --check` 通过。人工真实 macOS UI 验收确认通过：打开 `.mmd`/`.mermaid`、状态栏 `Mermaid`、Preview 左右分栏、本地图表渲染、编辑后更新、错误退化、保存源码、多标签隔离、关闭保护，以及 Markdown fenced Mermaid code block 仍不渲染为图表。

### 接入 Mermaid 预览入口与更新

- **状态**：已完成
- **开始日期**：2026-08-10
- **完成日期**：2026-08-10
- **Feature Spec**：`docs/features/mermaid-local-preview.md`
- **结果**：在 Mermaid 活动标签接入 `Preview` 开关和源码/预览左右分栏，非 Mermaid 标签不显示 Mermaid 入口。预览开关状态新增为 `DocumentTab.mermaidPreviewOpen`，按标签保存在当前会话内，并与 Markdown 预览状态字段分离；源码变更后约 300ms debounce 调用 `renderMermaidPreview` 更新预览，渲染期间显示 loading，占位结果按 `tabId + source` 校验，避免旧异步结果覆盖新源码或污染其他标签。渲染错误显示在 Mermaid 预览区且不阻止继续编辑。`mermaidPreview.ts` 改为动态导入 `mermaid`，让 Mermaid 依赖进入按需 chunk，避免进入初始主入口 bundle。未渲染 Markdown fenced Mermaid code block，未新增导出、所见即所得、滚动同步、全局偏好、重启恢复、Rust IPC、Tauri capability、网络、shell 或文件权限。
- **验证**：`npm run test -- mermaidPreview App tabSession` 通过（**88 passed / 0 failed**）；`npm run check` 通过（typecheck + vitest **178 passed / 0 failed**）；`npm run build` 通过，主入口 chunk 约 641 kB，Mermaid core 作为按需 chunk 约 623 kB，Vite 大 chunk 提示仍存在但不阻塞本切片；`git diff --check` 通过。本切片未做 release 构建或真实 macOS 交互验收。

### 建立 Mermaid 本地渲染安全契约

- **状态**：已完成
- **开始日期**：2026-08-10
- **完成日期**：2026-08-10
- **Feature Spec**：`docs/features/mermaid-local-preview.md`
- **结果**：新增本地打包的 `mermaid@11.16.1` 前端依赖、`src/mermaidPreview.ts` 渲染适配层和 `src/mermaidPreview.test.ts`。适配层集中初始化 Mermaid：`startOnLoad: false`、`securityLevel: "strict"`、`htmlLabels: false`、`arrowMarkerAbsolute: false`，并把渲染结果清洗为安全 SVG 字符串；清洗规则移除脚本、`foreignObject`、事件属性、非本地 `href`/`src`、`javascript:` 与外部 `url(...)`/`@import` 样式。`renderMermaidPreview` 成功时返回 `{ status: "ok", html }`，失败时返回安全错误占位，不向 UI 调用方抛异常。为 jsdom 补最小 SVG 文本测量 mock 以验证基础 flowchart 渲染。未接入 App 主界面、Preview 入口、分栏布局、Markdown fenced code block 渲染、Rust IPC、Tauri capability、网络、shell 或文件权限。
- **验证**：`npm run test -- mermaidPreview` 通过（**4 passed / 0 failed**）；`npm run check` 通过（typecheck + vitest **174 passed / 0 failed**）；`npm run build` 通过（Vite 大 chunk 体积提示仍为既有语言包提示，不影响本切片；由于主界面尚未引用 `mermaidPreview.ts`，Mermaid 依赖会在后续 UI 接入切片进入实际 bundle）；`npm audit --omit=dev` 通过（生产依赖 **0 vulnerabilities**）；完整 `npm audit` 仍报告 3 个开发依赖链审计项，来源为 `vite -> postcss/nanoid` 与 `jsdom -> undici`，未自动执行 `npm audit fix`；`git diff --check` 通过。本切片未做 release 构建或真实 macOS 交互验收。

### 接入 Mermaid 语言识别与普通文本退化契约

- **状态**：已完成
- **开始日期**：2026-08-10
- **完成日期**：2026-08-10
- **Feature Spec**：`docs/features/mermaid-local-preview.md`
- **结果**：在前端语言识别契约中新增 `mermaid` 模式，`.mmd` / `.mermaid` 扩展名大小写不敏感，`languageDisplayName` 显示 `Mermaid`。CodeMirror 语言扩展映射中 Mermaid 暂时返回 `null`，按普通文本编辑退化，不新增 Mermaid 语法扩展或渲染依赖。App 级测试覆盖打开 Mermaid 文档后状态栏显示 `Mermaid`，且本切片不显示 `Preview` 开关或预览面板。未改 Rust、Tauri capability、保存/关闭链路、Markdown fenced code block 渲染、网络、shell 或文件权限。
- **验证**：`npm run check` 通过（typecheck + vitest **170 passed / 0 failed**）；`npm run build` 通过（Vite 大 chunk 体积提示仍为既有语言包提示，不影响本切片）；`git diff --check` 通过。本切片未做 release 构建或真实 macOS 交互验收。

### 确认 Mermaid 本地编辑与预览规格

- **状态**：已完成
- **开始日期**：2026-08-10
- **完成日期**：2026-08-10
- **Feature Spec**：`docs/features/mermaid-local-preview.md`
- **结果**：将 Mermaid 本地编辑与预览规格从草案确认。首版决议为：优先支持独立 `.mmd` / `.mermaid` 文档；Markdown fenced Mermaid code block 暂不渲染，仍按普通代码块显示；Mermaid 纳入语言识别并在状态栏显示 `Mermaid`；预览入口复用 Markdown 的 `Preview` 开关和左右分栏模式，按标签保存在当前会话内；渲染更新采用约 300ms debounce；允许新增本地打包的 `mermaid` 前端依赖，但必须使用手动渲染与最严格可用安全配置，不引入远程资源、网络、shell 或新权限；首版验收图表类型限定为 `flowchart` / `graph`、`sequenceDiagram`、`stateDiagram`、`classDiagram` 与 `erDiagram`。已拆出下一项实现切片「接入 Mermaid 语言识别与普通文本退化契约」。
- **验证**：文档审查；`git diff --check` 通过。本任务不修改生产代码，未运行构建或测试。

### Markdown 分栏集成验收与文档收尾

- **状态**：已完成
- **开始日期**：2026-08-10
- **完成日期**：2026-08-10
- **Feature Spec**：`docs/features/markdown-split-preview.md`
- **结果**：完成 Markdown 源码与本地预览左右分栏的自动化回归、release 构建、macOS 真实交互验收和文档收尾，并把 `docs/features/markdown-split-preview.md` 与 README 同步为已完成状态。首版支持 Markdown 标签工具栏 `Preview` 开关、左右分栏源码/预览布局、编辑后本地预览更新、按标签隔离预览状态、非 Markdown 不显示入口，以及 HTML 转义、链接非导航占位、图片非加载占位等安全退化策略；保存仍只写 Markdown 源码。未新增滚动同步、重启恢复、全局偏好、Mermaid、所见即所得、导出、脚注、数学公式、目录大纲、远程资源加载、网络权限、shell 权限或文件系统权限。
- **验证**：`npm run check` 通过（typecheck + vitest **167 passed / 0 failed**）；`npm run build` 通过；`npm run tauri -- build` 通过并生成 release `Textora.app`；`git diff --check` 通过。release `Textora.app` 可由 `/usr/bin/open -n` 启动；自动化环境无法可靠观测 WebView 窗口内容，因此最终真实 macOS 点击验收由人工完成并确认通过：打开 Markdown、开启 Preview、编辑后预览更新、保存源码、多标签切换和关闭保护均符合规格。

### 接入 Markdown 分栏入口与预览更新

- **状态**：已完成
- **开始日期**：2026-08-10
- **完成日期**：2026-08-10
- **Feature Spec**：`docs/features/markdown-split-preview.md`
- **结果**：在 Markdown 活动标签工具栏接入 `Preview` 开关，非 Markdown 标签不显示该入口。开启后编辑区进入左右分栏：左侧保留 CodeMirror Markdown 源码编辑，右侧使用 `renderMarkdownPreview` 显示本地安全预览；关闭后恢复单栏源码。分栏状态新增为 `DocumentTab.markdownPreviewOpen`，按标签保存在当前会话内，不写入文档内容、不影响脏状态、保存格式或关闭保护；源码编辑后预览随 `session.content` 重新派生，多标签切换时 Markdown 分栏状态与预览内容互不污染。新增样式覆盖基础 Markdown 预览排版、安全链接/图片占位和错误占位。未新增依赖、Tauri capability、Rust IPC、滚动同步、重启恢复或全局偏好。
- **验证**：`npm run check` 通过（typecheck + vitest **167 passed / 0 failed**，新增 App 级测试覆盖非 Markdown 不显示 Preview、Markdown 开关分栏、安全占位、编辑后预览更新、按标签隔离）；`npm run build` 通过（Vite 大 chunk 体积提示仍为既有语言包提示，不影响本切片）；`git diff --check` 通过。本切片未做 release 构建、真实 macOS 验收或规格最终收尾。

### 建立 Markdown 预览渲染与安全退化契约

- **状态**：已完成
- **开始日期**：2026-08-10
- **完成日期**：2026-08-10
- **Feature Spec**：`docs/features/markdown-split-preview.md`
- **结果**：新增 `src/markdownPreview.ts` 本地 Markdown 预览渲染适配层与 `src/markdownPreview.test.ts`。渲染结果以 `{ status, html }` 纯数据返回，供后续 UI 接入；支持首版 Markdown/GFM 结构（标题、段落、强调、链接文本、列表、任务列表、引用、代码块、行内代码、分隔线、表格、删除线）。安全策略已固化：原始 HTML 转义，链接用非导航占位而不生成 `<a href>`，图片用非加载占位而不生成 `<img>` 或 `src=`；渲染异常返回可显示错误占位，不影响源码继续编辑/保存。未新增依赖，未改 Tauri capability、Rust、主界面布局或保存/关闭链路。
- **验证**：`npm run check` 通过（typecheck + vitest **165 passed / 0 failed**，新增 4 个 Markdown 预览契约测试）；`npm run build` 通过（Vite 大 chunk 体积提示仍为既有语言包提示，不影响本切片）；`git diff --check` 通过。本切片未做主界面接入、release 构建或真实 macOS 验收。

### 确认 Markdown 源码与本地预览左右分栏规格

- **状态**：已完成
- **开始日期**：2026-08-10
- **完成日期**：2026-08-10
- **Feature Spec**：`docs/features/markdown-split-preview.md`
- **结果**：将 Markdown 源码与本地预览左右分栏规格从草案确认。首版决议为：Markdown 文件默认仍显示源码编辑，工具栏 `Preview` 开关手动进入左右分栏；分栏状态按标签保存在当前会话内，不作为全局偏好或重启恢复状态；首版不做滚动同步；原始 HTML 全部转义；链接不触发导航或外部打开；图片不加载远程或本地资源，只显示 alt 文本与 URL 占位；支持常见 Markdown 与 GFM 表格、任务列表、删除线，不包含脚注、数学公式、目录大纲或 Mermaid 渲染。已拆出下一项实现切片「建立 Markdown 预览渲染与安全退化契约」。
- **验证**：文档审查；`git diff --check` 通过。本任务不修改生产代码，未运行构建或测试。

### 代码高亮集成验收与文档收尾

- **状态**：已完成
- **开始日期**：2026-08-10
- **完成日期**：2026-08-10
- **Feature Spec**：`docs/features/code-syntax-highlighting.md`
- **结果**：完成代码高亮的自动化回归、前端构建、release 构建、系统应用重新部署和 macOS 真实交互验收，并把 `docs/features/code-syntax-highlighting.md` 与 README 同步为已完成状态。首版代码高亮支持按文件名/扩展名识别 JavaScript、TypeScript、JSON、HTML、CSS、Rust、Python、Java、Shell、SQL、TOML、YAML、Markdown 和 Plain Text；活动标签状态栏显示语言名，切换标签、打开文件与另存为后重新识别；未知扩展名与 Untitled 退化为普通文本；Markdown 仅源码高亮，不引入预览。未新增 LSP、补全、主题、折叠、Markdown 预览、文件系统权限、shell 权限、网络权限或远程页面权限。
- **验证**：`npm run check` 通过（typecheck + vitest **161 passed / 0 failed**）；`npm run build` 通过；`npm run tauri -- build` 通过并生成 release `Textora.app`；`git diff --check` 通过。已用 `/usr/bin/ditto` 覆盖部署到 `/Applications/Textora.app`，并经 `codesign --force --deep --sign - /Applications/Textora.app` 本机重签名；`codesign --verify --deep --strict /Applications/Textora.app` 通过，`CFBundleIdentifier` 为 `com.tsingmu.textora`，`CFBundleIconFile` 为 `icon.icns`，安装后图标资源与项目 `src-tauri/icons/icon.icns` SHA-256 一致。人工验证通过：在重新部署后的 `/Applications/Textora.app` 中打开 `.ts`、`.json`、`.sh` 与未知扩展名文件，确认语言状态栏、普通文本退化和多标签隔离均符合规格。

### 高亮与既有编辑能力回归

- **状态**：已完成
- **开始日期**：2026-08-10
- **完成日期**：2026-08-10
- **Feature Spec**：`docs/features/code-syntax-highlighting.md`
- **结果**：验证高亮启用下既有编辑能力不回退，并补齐自动化回归用例。新增 `src/Editor.test.ts`「column block editing under syntax highlighting」用例：TypeScript 语言扩展与列块选区扩展同时启用时，多选区、列块删除、列块粘贴、数字序列填充仍按既有结果工作，且数字序列填充可经 `undo` 恢复（证明语言扩展不破坏列块编辑与撤销栈）。新增 `src/Editor.test.tsx` 用例：在 `typescript` 与 `markdown` 之间重配置语言时，编辑器实例与文档内容保持不变且不触发 `onChange`（证明高亮重配置不丢弃文档/脏状态）。新增 `src/App.test.tsx` 两条集成用例：打开 `.tsx` 文件后切换到初始 Untitled 再切回，状态栏语言在 `TypeScript` 与 `Plain Text` 之间按活动标签跟随且互不污染；Untitled 经另存为保存到 `.ts` 路径后，活动标签与状态栏语言重新识别为 `TypeScript`。未改生产代码、Rust/capability/IPC 与保存/关闭保护链路；高亮重配置仍走既有 `languageCompartment` 的 `Compartment.reconfigure`，不重建编辑器实例。
- **验证**：`npm run check` 通过（typecheck + vitest **161 passed / 0 failed**，新增 7 个高亮回归用例：4 个列块编辑 + 1 个语言重配置保文档 + 2 个 App 多标签/另存为重新识别）；`npm run build` 通过；`git diff --check` 通过。前端切片，macOS release 真实交互验收（各语言高亮、状态栏语言、未知退化、多标签隔离）与 Feature Spec/README 收尾留给集成验收切片。

### 接入 CodeMirror 基础语法高亮与状态栏语言

- **状态**：已完成
- **开始日期**：2026-08-10
- **完成日期**：2026-08-10
- **Feature Spec**：`docs/features/code-syntax-highlighting.md`
- **结果**：把 `LanguageMode` 映射到 CodeMirror 语言扩展并接入编辑器与状态栏。新增依赖 `@codemirror/lang-{javascript,json,html,css,python,java,sql,markdown,rust,yaml}`、`@codemirror/legacy-modes`（shell/toml 经 `StreamLanguage`）、`@codemirror/language`。新增 `src/languageExtensions.ts`：`languageExtension(mode)` 集中映射（typescript 用 `javascript({typescript,jsx})`，shell/toml 用 `StreamLanguage.define`），`plain-text` 返回 `null`，`safeLanguageExtension` 捕获构造错误退化为普通文本。`Editor.tsx` 新增 `language` prop 与 `languageCompartmentRef`（复用既有 `Compartment` 模式），在活动标签切换/打开/另存为导致 `LanguageMode` 变化时重配置语言扩展，不重建编辑器实例。`App.tsx` 按 `detectLanguage(session.path, session.displayName)` 计算 `activeLanguage` 传入 `Editor`，并在状态栏以 `languageDisplayName` 显示语言名（与编码·换行并列）。Markdown 仅源码高亮、无预览。未改 Rust/capability/IPC 与保存/关闭保护链路。
- **验证**：`npm run check` 通过（typecheck + vitest **154 passed / 0 failed**，新增 `languageExtensions` 映射测试与 `Editor` language prop 重配置用例，既有编辑器实例保持/可编辑切换用例补 `language` prop）；`npm run build` 通过（语言包纳入 bundle，体积增长属预期，未做代码分割优化）；`git diff --check` 通过。前端切片，macOS 真实交互（各语言高亮、状态栏语言、Markdown 源码、未知退化）留给集成验收。

### 接入语言识别与普通文本退化契约

- **状态**：已完成
- **开始日期**：2026-08-10
- **完成日期**：2026-08-10
- **Feature Spec**：`docs/features/code-syntax-highlighting.md`
- **结果**：新增前端纯函数模块 `src/languageRecognition.ts`：`LanguageMode` 枚举（JavaScript/TypeScript/JSON/HTML/CSS/Rust/Python/Java/shell/SQL/TOML/YAML/Markdown + `plain-text`）+ `detectLanguage(path, displayName)` + `languageDisplayName(mode)`。`path` 非空时取其 basename，否则用 `displayName`；完整文件名（`package.json`/`tsconfig.json`/`jsconfig.json`/`Cargo.toml`/`pyproject.toml`）优先匹配，再回退扩展名；扩展名大小写不敏感；Untitled、无扩展名、隐藏文件与未知扩展名退化为 `plain-text`。未接入 CodeMirror、未新增依赖、未改 UI/Rust/capability。
- **验证**：`npm run check` 通过（typecheck + vitest **150 passed / 0 failed**，新增 `languageRecognition` 测试覆盖各语言扩展名、TS/JS 变体、yaml/html/markdown 别名、大小写不敏感、复合配置名、Untitled/未知/隐藏文件退化、路径 basename 与显示名派生）；`npm run build` 通过；`git diff --check` 通过。前端切片，未改 Rust，未做 macOS 真实交互。

### 确认代码文本识别与最小语法高亮规格

- **状态**：已完成
- **开始日期**：2026-08-10
- **完成日期**：2026-08-10
- **Feature Spec**：`docs/features/code-syntax-highlighting.md`
- **结果**：代码高亮规格从草案更新为已确认。四个开放问题决议为：首版语言清单为**核心集（JavaScript/TypeScript/JSON/HTML/CSS/Rust/TOML/YAML）+ 常用脚本（shell/SQL/Python）+ Java**，并纳入 Markdown 源码高亮；**状态栏显示**检测到的语言名（`Plain Text`/`TypeScript`/`JSON` 等），与编码·换行设置并列；**Markdown 按源码高亮**纳入首版（不引入预览，预览仍属独立的 Markdown 分栏规格）；**大文件不新增退化规则**，50 MiB 以内各语言行为一致，明显卡顿作为后续性能任务。规格补充了首版语言清单表（含匹配输入与 CodeMirror 包方向）、复合文件名优先匹配规则、状态栏语言派生规则、Markdown 仅源码高亮边界与大文件一致性规则，并把开放问题替换为决议记录；实现拆分为语言识别契约 → CodeMirror 高亮与状态栏 → 既有能力回归 → 集成验收。`current.md` 写入首个实现切片「接入语言识别与普通文本退化契约」。
- **验证**：文档审查；本任务不修改生产代码，未运行构建或测试。

### 修复关闭主窗口后 Dock 点击无法恢复窗口

- **状态**：已完成
- **开始日期**：2026-08-07
- **完成日期**：2026-08-07
- **结果**：修复点击 macOS 红灯关闭主窗口后应用仍在 Dock 存活、再次点击 Dock/重新打开应用却没有窗口的问题。主窗口关闭保护现在在无脏标签或用户完成保存/不保存确认后隐藏窗口而不是销毁唯一窗口，保留现有内存标签状态；macOS `Reopen` 事件在没有可见窗口时会显示、取消最小化并聚焦主窗口，若主窗口已不存在则按配置重建。新增最小 `core:window:allow-hide` capability，未扩大文件系统、shell、网络、多窗口、会话恢复、签名/公证或安装器范围。
- **验证**：`npm run check` 通过（typecheck + vitest **120 passed / 0 failed**，更新窗口关闭保护测试为阻止 destroy 并 hide）；`cargo fmt --manifest-path src-tauri/Cargo.toml --check`、`cargo check --manifest-path src-tauri/Cargo.toml --all-targets`、`cargo test --manifest-path src-tauri/Cargo.toml --quiet`（**126 passed / 0 failed**）通过；`npm run tauri -- build` 通过并生成 release `Textora.app`；`git diff --check` 通过。真实 macOS 验证：启动构建产物与部署后的 `/Applications/Textora.app`，红灯关闭后窗口数从 1 变 0，再通过 `open -a Textora` 重新打开后窗口数恢复为 1；部署后的 `/Applications/Textora.app` 已用 `/usr/bin/ditto` 覆盖安装、`codesign --force --deep --sign -` 本机重签名，且 `codesign --verify --deep --strict /Applications/Textora.app` 通过。

### 替换标题栏品牌图标并重新部署

- **状态**：已完成
- **开始日期**：2026-08-07
- **完成日期**：2026-08-07
- **结果**：把标题栏内原先硬编码的 `T` 品牌方块替换为项目根目录 `icon.png` 渲染出的图片标识，并调整容器背景、圆角、裁切与轻量阴影，使界面品牌图标与 macOS bundle 图标同源。重新构建 release app，覆盖安装到 `/Applications/Textora.app`，并对安装后的 app 做本机 ad-hoc 重签名。未改 macOS bundle 图标生成规则、签名/公证/DMG、整体品牌视觉体系或运行时功能行为。
- **验证**：`npm run check` 通过（typecheck + vitest **120 passed / 0 failed**）；`npm run tauri -- build` 通过，Vite 产物包含 `dist/assets/icon-*.png` 并生成 release `Textora.app`；`/usr/bin/ditto` 已把当前 release app 复制到 `/Applications/Textora.app`；`codesign --force --deep --sign - /Applications/Textora.app` 完成；`codesign --verify --deep --strict /Applications/Textora.app` 通过；安装后 `Info.plist` 中 `CFBundleIdentifier` 为 `com.tsingmu.textora`、`CFBundleIconFile` 为 `icon.icns`。

### 替换 macOS 应用图标为项目根目录 icon.png

- **状态**：已完成
- **开始日期**：2026-08-07
- **完成日期**：2026-08-07
- **结果**：使用项目根目录 `icon.png` 重新生成 Tauri 图标资源，更新 `src-tauri/icons` 下 macOS release bundle 使用的 `icon.icns` 以及同源 PNG/ICO/Windows tile 图标资源。清理 Tauri 图标生成器额外产生但当前 macOS 项目未引用的 iOS/Android 未跟踪资源与 `64x64.png`，避免扩大分发范围或留下无关噪音。未改签名、公证、DMG/安装器、运行时 UI 或品牌视觉规则。
- **验证**：`npm run tauri -- build` 通过（包含 `npm run build` 与 release bundle 生成），生成 `/Users/mouqing/codexProjects/textora/src-tauri/target/release/bundle/macos/Textora.app`；`Info.plist` 中 `CFBundleIconFile` 为 `icon.icns`；`Textora.app/Contents/Resources/icon.icns` 与 `src-tauri/icons/icon.icns` 的 SHA-256 一致；`git diff --check` 通过。

### 完成列块编辑集成验收与文档收尾

- **状态**：已完成
- **开始日期**：2026-08-07
- **完成日期**：2026-08-07
- **Feature Spec**：`docs/features/column-block-editing.md`
- **结果**：完成列块编辑完整回归、release 构建和真实 macOS 交互验收，并把 `docs/features/column-block-editing.md` 标记为已完成、同步 README 当前状态。列块编辑首版支持 `Option` + 鼠标拖拽矩形选择、多选区 Delete/Backspace 删除、单行粘贴到每个选择行、多行等量逐行粘贴、行数不匹配拒绝、工具栏 `Sequence` 与 `⌥⌘N` 数字序列填充（`1..n`，按结束值宽度补零）。集成验收中发现 `⌥⌘N` 在 AppleScript 物理键事件下未稳定触发，因此补充工具栏 `Sequence` 作为可靠可发现入口；未实现自定义起始值/步长/前导零、十六进制、字母、日期序列、命令面板、键盘矩形选择、Markdown 或 Mermaid 能力。
- **验证**：`npm run check` 通过（typecheck + vitest **120 passed / 0 failed**）；`npm run build` 通过；`cargo fmt --manifest-path src-tauri/Cargo.toml --check`、`cargo check --manifest-path src-tauri/Cargo.toml --all-targets`、`cargo test --manifest-path src-tauri/Cargo.toml --quiet`（**126 passed / 0 failed**）通过；`npm run tauri -- build` 通过并生成 `Textora.app`；`git diff --check` 通过。2026-08-07 在 release `Textora.app` 做真实 macOS 交互验收：粘贴四行测试文本；`Option` 拖拽形成跨四行列块；`Delete` 删除同列内容；单行剪贴板粘贴到每个选择行；四行剪贴板逐行写入；两行剪贴板粘到四行列块时被拒绝且文档不变；点击工具栏 `Sequence` 写入 `1, 2, 3, 4`；聚焦编辑器后 `⌘Z` 撤销序列填充；列块编辑后的 `⌘Q` 触发未保存关闭确认。

### 实现数字序列填充首版

- **状态**：已完成
- **开始日期**：2026-08-07
- **完成日期**：2026-08-07
- **Feature Spec**：`docs/features/column-block-editing.md`
- **结果**：新增数字序列填充命令，并接入编辑器快捷键 `⌥⌘N`（CodeMirror `Mod-Alt-n`）。当存在多个选择范围时，命令按选择范围顺序插入或替换十进制 `1..n`；宽度按结束值自动补零，例如 10 行生成 `01..10`。单选区不接管该快捷键，普通编辑行为不变。序列填充通过普通 CodeMirror 事务提交，保持撤销/重做、内容同步、脏状态和保存保护链路；未实现自定义起始值、步长、前导零、十六进制、字母或日期序列。
- **验证**：`npm run check` 通过（typecheck + vitest **120 passed / 0 failed**，新增覆盖多光标插入序列、范围替换序列、10 行自动补零和撤销恢复原文）；`npm run build` 通过；`git diff --check` 通过。本切片未跑 `npm run tauri -- build` 或真实 macOS 快捷键验收，按范围留给列块编辑集成验收。

### 实现列块粘贴

- **状态**：已完成
- **开始日期**：2026-08-07
- **完成日期**：2026-08-07
- **Feature Spec**：`docs/features/column-block-editing.md`
- **结果**：新增列块粘贴计划与命令，并在多选区下接管 `paste` DOM 事件。剪贴板为单行文本时，文本会插入或替换到每个选择范围；剪贴板为多行文本时，去掉一个末尾换行后要求行数与选择范围数一致，并逐行插入或替换；行数不匹配时阻止默认粘贴且不改变文档，避免普通粘贴把多行内容误塞进第一个选区。单选区、空剪贴板或无法读取纯文本时仍交给 CodeMirror 默认粘贴。列块粘贴通过普通 CodeMirror 事务提交，保持撤销/重做、内容同步、脏状态和保存保护链路。
- **验证**：`npm run check` 通过（typecheck + vitest **116 passed / 0 failed**，新增覆盖单行复制到每个选择行、多行等量逐行粘贴、末尾换行处理、行数不匹配拒绝且不改文档、粘贴后撤销恢复原文）；`npm run build` 通过；`git diff --check` 通过。本切片未跑 `npm run tauri -- build` 或真实 macOS 粘贴验收，按范围留给列块编辑集成验收。

### 调整关闭确认按钮为 macOS 交通灯色系

- **状态**：已完成
- **开始日期**：2026-08-07
- **完成日期**：2026-08-07
- **结果**：关闭确认弹层里的三个操作按钮已参考 macOS 左上角窗口控制按钮配色调整：Cancel 使用柔和黄色，Don't Save 使用柔和红色，Save 使用柔和绿色；保留原有文案、点击行为、焦点与禁用语义，并增加轻量 hover/active 反馈。该切片只改关闭确认弹层样式，未改变未保存关闭流程，也未影响列块编辑待办。
- **验证**：`npm run check` 通过（typecheck + vitest **112 passed / 0 failed**）；`npm run build` 通过；`git diff --check` 通过。未运行 `npm run tauri -- build`，因为本切片仅修改前端 CSS。

### 实现列块删除

- **状态**：已完成
- **开始日期**：2026-08-07
- **完成日期**：2026-08-07
- **Feature Spec**：`docs/features/column-block-editing.md`
- **结果**：新增显式列块删除命令并接入编辑器高优先级 keymap：当存在多个选择范围时，`Delete`/`Backspace` 会删除每个列块范围；多个零宽光标时，`Delete` 删除各光标后的行内字符，`Backspace` 删除各光标前的行内字符，位于行首/行尾的光标不会跨行合并文本。单选区继续交给 CodeMirror 默认 keymap，普通编辑行为不变。列块删除通过 CodeMirror 事务提交，保持普通撤销/重做、内容同步、脏状态与保存保护链路。
- **验证**：`npm run check` 通过（typecheck + vitest **112 passed / 0 failed**，新增覆盖非空列块范围删除、多个光标行内删除且不合并行、删除后撤销恢复原文）；`npm run build` 通过；`git diff --check` 通过。本切片未跑 `npm run tauri -- build` 或真实 macOS 拖拽/删除验收，按范围留给列块编辑集成验收。

### 接入 Option 拖拽矩形选择基础

- **状态**：已完成
- **开始日期**：2026-08-07
- **完成日期**：2026-08-07
- **Feature Spec**：`docs/features/column-block-editing.md`
- **结果**：确认列块编辑 Feature Spec，并完成首个实现切片。编辑器现在启用 CodeMirror `rectangularSelection()`、`crosshairCursor()` 与 `EditorState.allowMultipleSelections`：macOS 上按住 `Option` 左键拖拽可形成矩形多选区，并有十字光标提示；普通选择、内容同步、脏状态和保存流程不变。新增最小自动化测试，防止未来编辑器配置回退为单选区。README 和 backlog 已同步为列块编辑进入当前任务，后续删除、粘贴和数字序列仍拆为独立待办。
- **验证**：`npm run check` 通过（typecheck + vitest **109 passed / 0 failed**，新增矩形列块多选区配置测试）；`npm run build` 通过；`git diff --check` 通过。本切片未跑 `npm run tauri -- build` 或真实 macOS 拖拽验收，按范围留给列块编辑集成验收。

### 完成多标签会话集成验收与文档收尾

- **状态**：已完成
- **开始日期**：2026-08-07
- **完成日期**：2026-08-07
- **Feature Spec**：`docs/features/multi-tab-session.md`
- **结果**：完成多标签会话完整回归、release 构建和真实 macOS 交互验收，并把 `docs/features/multi-tab-session.md` 标记为已完成、同步 README 当前状态。集成验收中发现 macOS 菜单 Quit/`⌘Q` 会绕过原先仅基于 `RunEvent::ExitRequested` 的退出保护：release 应用中未保存 Untitled 收到 `⌘Q` 后直接退出。修复为自定义 macOS Quit 菜单项，点击菜单或 `⌘Q` 时发出 `textora-app-exit-requested` 交前端统一执行逐标签未保存确认；Rust 侧保留一次性 `ExitGuard` 标记，只放行前端确认完成后调用的 `request_app_exit`，避免程序化退出被再次拦截。未新增多标签主要行为，未实现汇总关闭面板、多窗口、恢复会话、拖拽排序、最近关闭标签、列块编辑或 Markdown 能力。
- **验证**：`npm run check` 通过（typecheck + vitest **108 passed / 0 failed**）；`npm run build` 通过；`cargo fmt --manifest-path src-tauri/Cargo.toml --check`、`cargo check --manifest-path src-tauri/Cargo.toml --all-targets`、`cargo test --manifest-path src-tauri/Cargo.toml --quiet`（**126 passed / 0 failed**）通过；`npm run tauri -- build` 通过并生成 `Textora.app`；`git diff --check` 通过。2026-08-07 在 release `Textora.app` 做真实 macOS 交互验收：启动默认 Untitled，新建 `Untitled 2` 并切换；粘贴编辑内容后确认标签与状态栏为 Modified；单标签关闭显示保存/不保存/取消确认且 Cancel 保持内容；窗口关闭对多个未保存标签逐一提示，Don't Save 后进入下一标签、Cancel 中止并保留剩余标签；修复后 `⌘Q` 对未保存内容弹出保存确认，Cancel 保持运行，Don't Save 后退出。

### 多标签关闭协调

- **状态**：已完成
- **开始日期**：2026-08-07
- **完成日期**：2026-08-07
- **Feature Spec**：`docs/features/multi-tab-session.md`
- **结果**：把关闭状态机从单一 `closeIntent` 升级为关闭队列：窗口关闭与应用退出会按标签顺序收集所有脏标签，逐一切到对应标签并复用现有保存/不保存/取消确认；保存成功后继续下一项，不保存会释放后端文档并关闭该标签，任一取消或保存失败/冲突/缺失都会停止剩余队列并保持应用运行。重复窗口关闭或 app-exit 请求只维持一个确认，不叠加队列；全部待处理标签成功处理后才发出一次窗口关闭授权或 `request_app_exit`。单标签关闭继续保留既有体验，最后一个标签关闭仍创建新的空白 Untitled。未新增 capability，未实现汇总面板或最近关闭标签。
- **验证**：`npm run check` 通过（typecheck + vitest **108 passed / 0 failed**，新增覆盖窗口关闭逐一处理多个脏 Untitled、重复关闭不叠加、取消停止剩余队列且已不保存标签生效、多标签 app-exit 保存/不保存全部完成后才退出、保存失败停止队列且不退出）；`npm run build` 通过；`cargo fmt --manifest-path src-tauri/Cargo.toml --check`、`cargo check --manifest-path src-tauri/Cargo.toml --all-targets`、`cargo test --manifest-path src-tauri/Cargo.toml`（**126 passed / 0 failed**）、`git diff --check` 均通过。本切片未做最终 macOS 真实交互验收或 Feature Spec/README 收尾。

### 打开与保存按活动标签绑定

- **状态**：已完成
- **开始日期**：2026-08-04
- **完成日期**：2026-08-04
- **Feature Spec**：`docs/features/multi-tab-session.md`
- **结果**：打开文件入口从替换活动标签改为成功后新建文件标签并切换过去；取消或失败只清除发起标签的 Opening 状态，不替换其内容。前端显式把当前已打开文件标签路径传给后端，后端在文件选择后先按规范化路径与可解析的 canonical 真实路径检查是否已打开：命中时返回现有 `tabId`，前端直接切换且不调用 `read_document_content`，避免重复读取和重复后端活动文档。新打开候选改用多文档 `store_open`，不再清理其他文档状态。普通保存、Save As、冲突重载/覆盖、文件缺失与关闭保存续行继续按发起 `tabId`/`documentId` 回写，过期结果不会覆盖其他标签；Save As 预览新增其他标签路径占用识别，命中时在替换确认与写盘前显示错误并拒绝继续。测试断言同步为读取活动标签而非第一个标签。
- **验证**：`npm run check` 通过（typecheck + vitest **105 passed / 0 failed**，新增覆盖重复打开已打开路径只切换不重读、Save As 目标被其他标签占用时不进入替换确认/写盘）；`npm run build` 通过；`cargo fmt --manifest-path src-tauri/Cargo.toml --check`、`cargo check --manifest-path src-tauri/Cargo.toml --all-targets`、`cargo test --manifest-path src-tauri/Cargo.toml`（**126 passed / 0 failed**，新增覆盖符号链接选择命中已有真实路径、另存为目标被其他标签占用）、`git diff --check` 均通过。本切片未做多标签窗口/应用退出逐一协调，也未做最终 macOS 真实交互验收。

### 前端多标签会话与切换

- **状态**：已完成
- **开始日期**：2026-08-04
- **完成日期**：2026-08-04
- **Feature Spec**：`docs/features/multi-tab-session.md`
- **结果**：前端由单 `DocumentSession` 改为 `TabSessionState`（标签数组 + 活动标签 id），新增 `DocumentTab` 与纯函数管理新建 Untitled、活动标签切换、按标签更新文档和关闭标签。主界面标签栏支持新建多个 Untitled，显示名按 `Untitled`、`Untitled 2`、`Untitled 3` 递增；切换标签时编辑器、状态栏、错误提示和格式设置随活动标签切换，各标签内容、脏状态、格式和错误状态互不共享。单标签关闭已接入现有保存/不保存/取消确认：未修改标签直接关闭，已修改标签先切到发起标签再确认，最后一个标签关闭后创建新的空白 Untitled。另存为、冲突、文件缺失、关闭确认和打开确认等模态期间锁定标签切换与新建标签；异步打开、保存、重载和覆盖结果按发起 `tabId` 回写。当前切片未改后端、IPC 签名或 capability；打开文件仍按既有单文档入口替换活动标签，打开入新标签与保存/冲突/缺失按标签绑定留给下一切片。
- **验证**：`npm run check` 通过（typecheck + vitest **103 passed / 0 failed**，新增 `tabSession` 纯函数用例和 App DOM 用例覆盖 Untitled 数字后缀、新建/切换/编辑隔离、清洁关闭、关闭最后标签创建新 Untitled、脏标签关闭确认/取消/不保存、Save As 模态锁定切换）；`npm run build` 通过；`cargo fmt --manifest-path src-tauri/Cargo.toml --check`、`cargo check --manifest-path src-tauri/Cargo.toml --all-targets`、`cargo test --manifest-path src-tauri/Cargo.toml`（**124 passed / 0 failed**）、`git diff --check` 均通过。本切片为前端会话骨架，未做 macOS 真实交互。

### 重构后端 DocumentStore 支持多文档并发可信状态

- **状态**：已完成
- **开始日期**：2026-08-04
- **完成日期**：2026-08-04
- **Feature Spec**：`docs/features/multi-tab-session.md`
- **结果**：把 `DocumentStore` 由单活动文档状态机重构为按文档 id 并发的多文档状态。新增 `DocumentEntry`（候选内容/候选可信/重载版本/活动可信/冲突/覆盖租约/保存目录授权）与 `HashMap<String, DocumentEntry>`，Untitled 首次保存授权放全局槽；冲突版本与授权 id 计数保持全局单调（跨文档唯一）。取消「新文档替换旧文档」这一单文档不变量：`store_open`/`take_content`/`create_active` 只作用于对应 id 的 entry，其他 entry 不受影响——这是多标签共存的必要前提。覆盖租约、冲突解决、reload 候选提升与保存授权消费全部 per-doc；`active_for` 在该 entry 覆盖期间返回 `None`，不影响其他文档；`clear_save_grant` 改为按文档上下文清除，`current/take_save_grant` 在所有 entry 与 Untitled 槽中查找。修正 review 指出的回归：`trusted_for_inline_save_as(None)` 与 `establish_save_grant(None)` 不再要求后端无 active 文档，Untitled 标签首次保存可与文件标签并发（归属校验改为 `grant.document_id == None`，仍只能用后端发放的 grant，不扩大为任意路径写入）；当前 `select_and_open_document` 单文档入口使用 replacement 候选，内容成功取回并提升时清理旧 active/conflict/grant，避免前端尚未多标签化期间留下不可达旧状态，同时保留内部多文档 API 供后续切片使用。未改前端、IPC 命令签名、错误码或 capability；单文档（单一 id 贯穿）行为与重构前完全一致。
- **验证**：`cargo fmt --manifest-path src-tauri/Cargo.toml --check`、`cargo check --manifest-path src-tauri/Cargo.toml --all-targets`、`cargo test --manifest-path src-tauri/Cargo.toml`（**124 passed / 0 failed**，含 4 个多 id 用例改为共存语义并改名、新增 12 个多文档/过渡期用例覆盖共存、独立冲突/覆盖租约/授权、全局单调版本、候选与重载不扰动他文档、Untitled 与文件授权共存、「文件文档 active 下 Untitled 发放 grant→预览→首次保存成功且文件文档仍 active、grant 单次消费」、当前单文档打开提升后清理旧不可达状态及单文档退化）、`npm run check`（typecheck + vitest **96 passed / 0 failed**，前端未改）、`git diff --check` 均通过。本切片不改前端，未做 macOS 真实交互。

### 确认多标签会话规格与首批任务拆分

- **状态**：已完成
- **开始日期**：2026-08-04
- **完成日期**：2026-08-04
- **Feature Spec**：`docs/features/multi-tab-session.md`
- **结果**：多标签规格从草案更新为已确认。五个开放问题决议为：多未保存标签的关闭/退出**逐一**复用现有保存/不保存/取消确认（不做汇总面板）；后台普通保存及系统文件面板关闭后的异步读取期间允许跨标签编辑与切换，系统文件/目录选择、另存为/冲突/缺失/关闭确认等模态打开时锁定切换；同一路径再次打开**切换到已有标签**（不新建重复标签、不重新读取），Save As 命中其他标签已关联路径时在写盘前安全拒绝，路径身份同时考虑规范化选择路径与符号链接真实路径；Untitled 用数字后缀去重，显示名只用于展示且不影响保存目标；标签关闭后不保留撤销/重做历史或最近关闭记录。规格补充了同路径复用已有标签、Save As 路径占用保护、模态锁定切换与逐一关闭协调的行为规则与验收条件，并把开放问题替换为决议记录；新增「实现拆分」路线图（后端多文档可信状态 → 前端标签会话与切换 → 打开/保存按标签绑定 → 多标签关闭协调 → 集成验收）。`current.md` 写入首个实现切片「重构后端 DocumentStore 支持多文档并发可信状态」。
- **验证**：文档审查；本任务不修改生产代码，未运行构建或测试。

### 完成另存为内嵌目标面板的集成验收与文档收尾

- **状态**：已完成
- **开始日期**：2026-08-04
- **完成日期**：2026-08-04
- **Feature Spec**：`docs/features/save-as-inline-target-panel.md`
- **结果**：组合验证另存为内嵌目标面板并完成文档收尾。Untitled 首次保存与 Save As 均在应用内直接展示文件名、可信位置和右下角当前格式摘要；目录由 macOS 面板授权。取消保持会话不变；UTF-8 BOM/CRLF 覆盖、保存后普通保存续写、Mixed 阻断及明确归一、当前原路径冲突保护、只读源另存为均符合规格。Feature Spec 状态改为「已完成」，全部验收条件已核对，README 同步当前状态。
- **验证**：`npm run check` 通过（typecheck + vitest **96 passed / 0 failed**）；`cargo fmt --manifest-path src-tauri/Cargo.toml --check`、`cargo check --manifest-path src-tauri/Cargo.toml --all-targets`、`cargo test --manifest-path src-tauri/Cargo.toml`（**112 passed / 0 failed**）、`npm run build`、`npm run tauri -- build` 与 `git diff --check` 均通过并生成 `Textora.app`。2026-08-04 通过 Computer Use 在 release 应用与临时目录完成上述真实 macOS 交互；磁盘字节与权限/哈希检查符合预期。

### 修复主窗口关闭权限缺失

- **状态**：已完成
- **开始日期**：2026-08-04
- **完成日期**：2026-08-04
- **Feature Spec**：`docs/features/unsaved-close-protection.md`
- **结果**：为主窗口 capability 增加关闭事件链必需且范围最小的 `core:window:allow-close` 与 `core:window:allow-destroy`。`onCloseRequested` 放行后的隐式 `destroy()` 和确认后的程序化 `close()` 均可通过 Tauri ACL；未扩大到 `core:window:default`，关闭确认状态机与应用退出策略未改动。新增 capability 清单回归测试，防止前端窗口 mock 再次掩盖真实权限缺口；Feature Spec 同步更正权限记录。
- **验证**：`npm run check` 通过（typecheck + vitest **96 passed / 0 failed**，含新增 capability 回归测试）；`cargo fmt --manifest-path src-tauri/Cargo.toml --check` 与 `cargo test --manifest-path src-tauri/Cargo.toml`（**112 passed / 0 failed**）通过；`npm run tauri -- build` 通过并生成 `Textora.app`；`git diff --check` 通过。真实窗口按钮复验需重启 dev 应用后执行。

### 实现另存为内嵌文件名与位置面板（前端）并移除旧流程

- **状态**：已完成
- **开始日期**：2026-08-04
- **完成日期**：2026-08-04
- **Feature Spec**：`docs/features/save-as-inline-target-panel.md`
- **结果**：Save As 与 Untitled Save 已切换为应用内目标面板：异步取得 Rust 可信默认文件名与目录 grant，直接编辑文件名、显示/更改位置并展示右下角当前格式摘要；文件名非法、位置未选或 Mixed 尚未在右下角明确确认 LF/CRLF 时阻止保存。确认前调用 `preview_save_target`；不同已存在目标显示 Replace 二次确认，当前原路径跳过该提示并继续走 `InPlace` 保护。保存通过 Raw body + grant/file-name/format headers 调用 `save_document_as_at`，Unicode 文件名使用 percent-encoding；成功关联新目标，普通取消、Escape 与目录选择取消均保持会话不变，关闭意图只在保存成功后续行。TOCTOU 冲突保留面板与 grant 供重试；当前路径内容冲突/目标缺失分别进入既有冲突与缺失流程。前端新增三个 grant 错误码识别与安全文案。Rust 侧补齐缺失当前原路径优先按 `InPlace` 路由并分类/记录冲突，移除旧 `save_document_as` 命令、旧前端 `saveAs` 和格式模态；capability 未变化。
- **验证**：`npm run check` 通过（typecheck + vitest **95 passed / 0 failed**），新增覆盖默认目标、文件名修改、位置选择取消、Escape、右下角格式写入、Replace 与当前原路径跳过、Mixed 明确选择、Unicode Raw IPC、成功关联、关闭意图续行、TOCTOU 重试和 target-missing 路由；`cargo fmt --manifest-path src-tauri/Cargo.toml --check`、`cargo check --manifest-path src-tauri/Cargo.toml --all-targets`、`cargo test --manifest-path src-tauri/Cargo.toml`（**112 passed / 0 failed**）、`npm run build`、`git diff --check` 通过。macOS 真实交互与 README/Feature Spec 收尾按非范围留给下一项集成验收任务。

### 实现另存为 Rust 目录授权与保存契约

- **状态**：已完成
- **开始日期**：2026-08-04
- **完成日期**：2026-08-04
- **Feature Spec**：`docs/features/save-as-inline-target-panel.md`
- **结果**：Rust 侧新增内嵌另存为的可信目标契约。`DocumentStore` 只保存一个绑定当前活动文档（Untitled 为 `None`）的目录 grant；新授权替换旧授权，候选打开、文档切换/创建、关闭与成功保存均使其失效，保存失败则保留供重试。新增 `prepare_save_as`、`pick_save_directory`、`preview_save_target`、`save_document_as_at`：目录只能由可信文档父目录或 Rust 系统目录面板取得，前端只持 grant id、显示名和文件名；文件名按单一分量校验，经 UTF-8 percent-encoding header 支持 Unicode，再由 Rust 与授权目录拼接。保存复用 `choose_save_target`、安全保存核心和 `build_saved_descriptor`，选择当前原路径仍走 `InPlace` 冲突/只读保护；新增稳定错误码 `invalid-file-name`、`missing-grant`、`grant-mismatch`。旧 `save_document_as` 与 capability 保持不变，前端面板和旧流程移除留给下一切片。
- **验证**：`cargo fmt --manifest-path src-tauri/Cargo.toml --check`、`cargo check --manifest-path src-tauri/Cargo.toml --all-targets`、`git diff --check` 通过；`cargo test --manifest-path src-tauri/Cargo.toml` **114 passed / 0 failed**，新增 10 项测试覆盖默认草稿、Unicode/非法文件名、授权绑定/替换/失效、候选打开清理、目标预览、成功单次消费、失败保留重试、缺失/跨文档授权拒绝和当前原路径冲突保护；`npm run check` 通过（typecheck + vitest **86 passed / 0 failed**）。

### 修复右下角格式弹层在文档切换时保留旧草稿

- **状态**：已完成
- **开始日期**：2026-08-04
- **完成日期**：2026-08-04
- **Feature Spec**：`docs/features/save-as-inline-target-panel.md`
- **结果**：修复文档切换时格式弹层草稿泄漏。文档格式变化的 `useEffect` 现在同时把 `formatDraft` 重置为当前文档格式并关闭弹层（与 `saveFormat` 一致），因此弹层打开期间切换文档后，旧文档的草稿不再残留、也无提交入口，不会覆盖新文档格式。
- **验证**：`npm run check` 通过（typecheck + vitest **86 passed / 0 failed**，新增 1 个用例覆盖“弹层打开+改草稿为 GBK/CRLF→切换到 UTF-8/LF 文档→弹层关闭、`saveFormat` 反映新文档、重新打开草稿为新文档格式”）；`npm run build` 通过；`git diff --check` 通过。

### 建立主界面右下角编码与换行设置

- **状态**：已完成
- **开始日期**：2026-08-04
- **完成日期**：2026-08-04
- **Feature Spec**：`docs/features/save-as-inline-target-panel.md`
- **结果**：在主界面右下角（状态栏）建立持久的编码与换行设置入口。新增前端 `saveFormat` 状态（`EncodingChoice` + `LineEndingChoice`），用 `useEffect` 在文档 `id`/`encoding`/`lineEnding` 变化时重置为当前文档格式，用户覆盖在文档未变化期间保留；状态栏把原静态格式展示改为可点击摘要按钮（编码 · 换行；Mixed 内容显示「Mixed」标记），点击展开轻量弹层（草稿 + 完成/取消）：编码 UTF-8/UTF-8 BOM/GBK、换行 LF/CRLF；Mixed 内容时弹层提示「需在保存前选择 LF 或 CRLF」。新增 `encodingChoiceDisplayName` 用于显示选择编码。未改动既有保存入口、另存为模态框、关闭意图与 Rust；`saveFormat` 作为后续另存为目标面板的单一前端格式来源，暂未接入保存流程（按非范围留给后续切片）。
- **验证**：`npm run check` 通过（typecheck + vitest **85 passed / 0 failed**，新增 5 个用例覆盖默认显示 UTF-8·LF 且默认收起、打开弹层与两个选择器、完成应用所选编码/换行、取消保持原状、Mixed 标记与提示）；`npm run build` 通过；`git diff --check` 通过。本任务为前端切片，完成标准未要求 macOS 真实交互；应用内视觉确认留给后续内嵌目标面板的集成验收任务。

### 完成另存为目标选择的集成验收与文档收尾

- **状态**：已完成
- **开始日期**：2026-07-31
- **完成日期**：2026-08-04
- **Feature Spec**：`docs/features/save-as-target-selection.md`
- **结果**：组合验证另存为目标选择行为并完成文档收尾。Untitled 首次保存已有默认文件名 `Untitled`；前置格式选择界面已补齐说明、ARIA 标签与按钮语义，使用户明确下一步进入 macOS 系统保存面板修改目标；默认目录因 `rfd` macOS 保存面板同时设置目录与文件名时存在渲染异常，按规格如实降级为系统默认目录，不阻断用户手动切换目录。Feature Spec 状态改为「已完成」，README 同步当前状态。用户进一步提出将文件名与保存位置直接放入应用内对话框、编码与换行由应用主界面右下角设置决定的新体验，已单独形成 `docs/features/save-as-inline-target-panel.md` 与后续任务。
- **验证**：`npm run check` 通过（80 passed），`cargo test --manifest-path src-tauri/Cargo.toml` 通过（104 passed），`cargo fmt --manifest-path src-tauri/Cargo.toml --check`、`cargo check --manifest-path src-tauri/Cargo.toml --all-targets`、`npm run build`、`npm run tauri -- build`、`git diff --check` 均通过，并已生成 `Textora.app`；2026-08-04 用户确认当前验收任务可标记完成。

### 实现另存为默认文件名

- **状态**：已完成
- **开始日期**：2026-07-31
- **完成日期**：2026-07-31
- **Feature Spec**：`docs/features/save-as-target-selection.md`
- **结果**：在 `save_document_as` 打开系统保存面板时提供合理默认文件名。新增纯函数 `default_save_file_name`：已有文档沿用显示名，Untitled 首次保存使用常量 `Untitled`（无扩展名，遵守「不自动追加扩展名」）。对话框构造改为始终 `set_file_name`；不新增依赖或权限，前端不提交路径或名称。取消语义、当前原路径路由（`choose_save_target`→`InPlace`）、只读源另存为等既有行为未改动。已有文档默认目录曾计划使用 `set_directory`，但当前 `rfd` macOS 保存面板在同时设置目录与文件名时会渲染异常，故该部分不宣称完成，留给集成验收记录真实降级或后续独立修复。
- **验证**：`cargo fmt --check`、`cargo check --all-targets`、`git diff --check` 通过；`cargo test` **107 passed / 0 failed**（新增确定性单测覆盖首次保存默认名 `Untitled` 与已有文档沿用显示名）；`npm run check` 通过（typecheck + vitest **80 passed / 0 failed**，前端未改）；`npm run build` 通过。OS 对话框实际默认值与用户可在面板修改目录/文件名的 macOS 真实交互验收留给集成验收任务。Clippy 未运行（缺组件）。

### 确认另存为目标路径与文件名选择规格

- **状态**：已完成
- **开始日期**：2026-07-31
- **完成日期**：2026-07-31
- **Feature Spec**：`docs/features/save-as-target-selection.md`
- **结果**：规格从草案更新为已确认（2026-07-31）。核对 `save_document_as` 与 `tauri-plugin-dialog` 能力：`file()` 链式 `set_file_name`/`set_directory`/`add_filter`/`set_title` 均可用，无需新依赖或新权限。解决两个开放问题：Untitled 默认文件名采用无扩展名 `Untitled`（与显示名一致、不自动追加扩展名）；首版不持久化、也不在会话内记忆上次保存目录。已有文档默认目录仅在当前插件栈可同时可靠设置默认目录与文件名时由父目录派生，否则退回系统默认目录，不阻断用户手动切换目录。调查确认必须修复的缺口为 Untitled 默认文件名与目标选择可发现性；取消语义、当前原路径路由（`choose_save_target`→`InPlace`）、只读源另存为、系统面板由 Rust 发起等验收点已被现有实现覆盖。可测性策略：默认文件名决策提取为纯函数供确定性单测，格式选择弹窗说明由前端 DOM 测试覆盖，OS 对话框实际可修改性由 macOS 交互验收。拆出后续两个任务：实现默认文件名与可发现性、集成验收与文档收尾。
- **验证**：文档审查；本任务不修改生产代码，未运行构建或测试。

### 完成未保存关闭保护的集成验收与文档收尾

- **状态**：已完成
- **开始日期**：2026-07-31
- **完成日期**：2026-07-31
- **Feature Spec**：`docs/features/unsaved-close-protection.md`
- **结果**：执行完整回归与构建，并在真实 macOS 上完成窗口关闭按钮、`⌘W`、`⌘Q`、应用菜单 Quit 与 Dock Quit 的交互验收。「未保存关闭保护」Feature 达到完成状态：Feature Spec 状态改为「已完成」，12 项验收条件全部核对并勾选，验证记录写入实际自动化与 macOS 交互结果；README 同步为「已完成」。
- **验证**：`cargo fmt --check`、`cargo check --all-targets`、`cargo test`（**102 passed / 0 failed**）、`npm run check`（**80 passed / 0 failed**）、`npm run build`、`npm run tauri -- build`（生成 `Textora.app`）、`git diff --check` 均通过；macOS 真实交互于 2026-07-31 由用户确认窗口关闭按钮与 `⌘W`、`⌘Q`、应用菜单 Quit、Dock Quit 保护与取消/保存/不保存续行符合预期，确认或提示期间重复触发只维持一个提示。Clippy 未运行（缺组件）。

### 完成应用退出确认后的保存与不保存续行

- **状态**：已完成
- **开始日期**：2026-07-31
- **完成日期**：2026-07-31
- **Feature Spec**：`docs/features/unsaved-close-protection.md`
- **结果**：前置任务已把 `executeAuthorizedClose` 的 app-exit 分支接到 `request_app_exit`，且保存失败/冲突/缺失分支经 `clearCloseIntent` 不退出，续行实现无缺口，故本任务未修改生产代码，转为补齐确认后两条续行路径的全部自动化分支覆盖。新增 8 个 app-exit 续行用例验证：保存成功（直接发起与经窗口关闭归并升级两条路径）经 `request_app_exit` 退出且不触发 `window.close()`；明确不保存后经 `closeDocument` + `request_app_exit` 退出；Untitled 首次保存与只读另存为在格式选择与系统保存对话框成功后退出；保存失败、格式选择取消时不退出且保留未保存状态可重新提示；保存触发内容冲突或目标缺失时清除退出意图、进入既有冲突/缺失流程且不自动退出。退出授权只在当前请求完整成功后生效（成功才调 `request_app_exit`），取消或失败立即经 `clearCloseIntent` 失效。
- **验证**：`cargo fmt --check`、`cargo check --all-targets`、`cargo test`（**102 passed / 0 failed**）、`npm run check`（**80 passed / 0 failed**，新增 8 个 app-exit 续行用例覆盖保存成功、不保存、Untitled 首次保存、只读另存为、保存失败不退出、格式选择取消不退出、冲突与缺失清除意图不退出）、`npm run build`、`git diff --check` 均通过。本任务未改生产代码（仅测试与文档），上一任务已验证的 `Textora.app` 构建仍然有效。Clippy 未运行（缺组件）。macOS 三入口真实交互验收留给集成任务。

### 接入应用退出请求的未保存取消保护

- **状态**：已完成
- **开始日期**：2026-07-31
- **完成日期**：2026-07-31
- **Feature Spec**：`docs/features/unsaved-close-protection.md`
- **结果**：Rust 由 `.run(ctx)` 改为 `.build(ctx)?.run(...)`，在 `RunEvent::ExitRequested { code: None }`（用户发起的正常退出）时**一律** `prevent_exit` 并发射 `textora-app-exit-requested` 交前端判断；只有 `request_app_exit` 经 `AppHandle::exit` 触发的程序化退出（`code: Some`）直接放行。判定函数 `should_guard_user_exit(code) = code.is_none()`。该保守策略不依赖任何前端异步同步的保护状态，消除了「文档刚改脏、保护尚未武装」的时序窗口——此前版本用 `set_exit_guard` 维护的受管 `AtomicBool` 决定是否拦截，存在绕过未保存确认的风险，已删除该命令与状态。强制终止不触发 `ExitRequested`，因此无法被伪装为可保护的正常退出。前端在既有关闭意图状态机增加 `kind: "window" | "app-exit"`，收到 `textora-app-exit-requested` 后：未修改且空闲 → `requestAppExit`；脏文档 → 同一个保存/不保存/取消确认；忙碌或已有提示 → 安全阻止；已有意图 → 升级为 app-exit 归并，不重复提示，也不能因取消其中一个事件而由另一个绕过保护。`executeAuthorizedClose` 按 `kind` 分支：窗口走原 `window.close()` 授权，应用退出走 `request_app_exit`。能力新增最小事件权限 `core:event:allow-listen` 与 `core:event:allow-unlisten`，未授予 emit 或任何文件系统、shell、网络、窗口控制权限。
- **范围说明**：取消保护（脏文档提示、取消/Escape、重复退出归并、退出与窗口关闭事件归并、忙碌互斥）与未修改直接退出已交付并通过自动化验证。确认后的「保存/不保存续行→退出」经 `executeAuthorizedClose` 的 app-exit 分支已贯通并经一条归并升级用例验证，但其按分支的专门验证（保存取消/失败/内容冲突/目标缺失时不退出）与 macOS `⌘Q`、应用菜单 Quit、Dock Quit 的真实交互验收按拆分留给下一任务。
- **验证**：`cargo fmt --check`、`cargo check --all-targets`、`git diff --check` 通过；`cargo test` **102 passed / 0 failed**（含 `should_guard_user_exit`：用户发起退出默认拦截、程序化 `code: Some` 放行）；`npm run check` **72 passed / 0 failed**（含 7 个应用退出用例：未修改直接退出、脏文档提示与 Escape 取消、**脏文档收到事件即提示且不调用 `request_app_exit`、且从不调用 `set_exit_guard`**（回归保护时序窗口）、重复退出、忙碌阻止、退出意图期间窗口关闭被阻止、窗口关闭意图升级为应用退出并经 `request_app_exit` 完成）；`npm run build` 通过；`npm run tauri -- build` 通过并生成 `Textora.app`（验证运行事件回路与能力变更）。Clippy 未运行（缺组件）。macOS 三入口真实交互验收留待集成任务。

### 保护未保存文档的主窗口关闭

- **状态**：已完成
- **开始日期**：2026-07-30
- **完成日期**：2026-07-30
- **Feature Spec**：`docs/features/unsaved-close-protection.md`
- **结果**：主窗口关闭确认使用绑定文档与完整内容快照的进程内关闭意图；保存成功或明确不保存后生成一次性授权，`Window.close()` 再次触发 `closeRequested` 时只允许匹配文档通过，文档已切换的过期授权会被拒绝。普通保存、Untitled 首次保存和只读另存为共用关闭意图，格式选择/系统对话框取消、保存失败、内容冲突或目标缺失均清除意图且不自动关闭；后端关闭失败会保留确认和可理解错误。重复关闭请求在确认与处理期间只安全阻止，不叠加或排队。
- **验证**：`npm run check` 通过（**65 passed / 0 failed**）；新增 10 个主窗口关闭用例，覆盖清洁直关、重复请求、Escape、明确不保存、普通保存、一次性及过期授权、Untitled 首次保存、格式与系统取消、内容冲突和目标缺失；`npm run build`、`git diff --check` 通过。macOS 窗口按钮与 `⌘W` 真实交互留待下一项集成验收统一执行。

### 完成保存冲突解决集成验收

- **状态**：已完成
- **完成日期**：2026-07-27
- **Feature Spec**：`docs/features/resolve-save-conflict.md`
- **结果**：保存冲突解决 Feature 全部 5 个子任务（冲突分类与可信状态、取消与重新加载、强制覆盖、关联文件缺失、集成验收）已完成。集成验收执行完整回归套件并核对全部 15 项验收条件。Feature Spec 状态更新为已完成；README 同步为「已完成」。
- **验证**：`cargo fmt --check`、`cargo check --all-targets`、`git diff --check` 通过；`cargo test` 默认并发与串行各 **100 passed / 0 failed**；`npm run check` **55 passed / 0 failed**；`npm run build` 通过；`npm run tauri -- build` 通过并生成 `Textora.app`；打开 `.app` 进程启动。15 项验收条件全部由确定性自动化测试覆盖；用户于 2026-07-27 确认 macOS 交互式真实文件流程验收通过。Clippy 未运行（缺组件）。

### 处理关联文件缺失

- **状态**：已完成
- **开始日期**：2026-07-24
- **完成日期**：2026-07-24
- **Feature Spec**：`docs/features/resolve-save-conflict.md`
- **结果**：后端新增异步 `check_target_exists(id)`，只把可信路径 `metadata` 的 `NotFound` 归为缺失，其他 I/O 错误返回稳定读取失败；未知/过期 id 不触发提示。`close_document(id)` 只关闭匹配活动文档，未知 id 明确拒绝，并原子清除活动关联及冲突候选状态。前端用文档 ID、路径、单调请求代次和 in-flight 状态绑定聚焦检查：同文档请求去重，过期结果、Untitled、忙碌、已有错误或提示均不提交，检查失败保留会话并允许下次聚焦重试。普通保存发现目标缺失进入同一提示；“保留内容”成功解除关联并标脏，后续保存走首次保存；“放弃”成功后回到空白文档。关闭失败保留提示和内容供重试，操作期间按钮互斥；Escape 复用安全的“保留内容”流程，提示期间再次失焦不改变选择。
- **验证**：`cargo fmt` 已执行，`cargo fmt --check`、`cargo check --all-targets`、`git diff --check` 通过；`cargo test` **100 passed / 0 failed**，新增覆盖存在/缺失/非 NotFound I/O 分类及关闭状态清理与过期 id 拒绝；`npm run check` **55 passed / 0 failed**，新增覆盖 Untitled/忙碌跳过、检查失败重试、聚焦去重、过期结果、Escape 保留、关闭失败保护、成功放弃和普通保存缺失路由；`npm run build` 通过。Clippy 未运行（缺组件）；macOS 真实文件交互已于 2026-07-27 的集成验收中确认通过。

### 接入内容冲突的强制覆盖

- **状态**：已完成
- **开始日期**：2026-07-24
- **完成日期**：2026-07-24
- **Feature Spec**：`docs/features/resolve-save-conflict.md`
- **结果**：后端新增异步 `force_overwrite(id)`，只使用 Rust 可信状态中的 ContentChanged 冲突快照、路径、编码和换行信息；确认后重新观测目标，以 `SaveTarget::ExistingTarget` 复用编码、大小、只读、权限、竞争复核、符号链接和原子保存保护。新增绑定文档 ID 与冲突 revision 的覆盖租约：覆盖期间取消、重新加载、重复覆盖、候选文档提升及其他可信状态更新均被拒绝；失败只释放租约并保留冲突，成功则在同一锁内复核租约和 revision、更新可信指纹与字节数并清除冲突，过期提交不能清除更新后的冲突。前端增加 Overwrite 破坏性操作并与 Cancel/Reload 共用互斥状态；成功清脏，失败保留可操作提示。测试环境补齐 jsdom 缺失的 `Range.getClientRects`，消除 CodeMirror 延迟测量产生的非确定性未处理错误。
- **验证**：`cargo fmt` 已执行，`cargo fmt --check`、`cargo check --all-targets`、`git diff --check` 通过；`cargo test` **98 passed / 0 failed**，新增覆盖租约互斥、失败释放、原子提交、过期 revision、真实文件成功覆盖及目标缺失失败保留；`npm run check` 连续两次均为 **49 passed / 0 failed**，新增覆盖成功、稳定失败提示及三操作互斥；`npm run build` 通过。既有保存核心测试继续覆盖确认后再次变化、只读、不可编码、编码歧义、Mixed、超限、符号链接和失败时原文件保护。Clippy 未运行（缺组件）；macOS 交互验收已于 2026-07-27 的集成验收中确认通过。

### 接入内容冲突的取消与重新加载

- **状态**：已完成
- **完成日期**：2026-07-23
- **Feature Spec**：`docs/features/resolve-save-conflict.md`
- **结果**：后端新增 `cancel_conflict` 与 `reload_from_conflict`，且只接受当前活动文档的 `ContentChanged` 冲突；未知、过期、已解决或其他冲突类型明确拒绝。每次冲突具有仅存于 Rust 可信状态的内部版本：重新加载经 `open_document` 取得一致磁盘快照后，必须在同一锁内复核文档 id、类型和版本才能发布候选；`read_document_content` 提升候选时再次复核，Cancel 会同时使已发布但未取回的候选失效，避免取消/重复操作/会话变化后的旧结果覆盖编辑内容。读取失败保留冲突供重试。前端显示 Cancel/Reload 通知并用单一操作状态禁用重复或交叉操作；失败时保留稳定的具体读取错误和可操作冲突状态；Escape 复用取消流程。冲突期间编辑器锁定，打开、保存和另存为禁用。
- **验证**：`cargo fmt` 已执行；`cargo check --all-targets`、`git diff --check` 通过；`cargo test` **93 passed / 0 failed**（含内容冲突类型约束、过期版本拒绝、Cancel 使已发布候选失效、候选取回二次复核及既有读取失败保护）；`npm run check` **46 passed / 0 failed**（含重新加载成功、具体失败原因保留、Cancel/Reload 串行及 Escape 取消）；`npm run build` 通过。Clippy 未运行（缺组件）；macOS 交互验收已于 2026-07-27 的集成验收中确认通过。

### 建立保存冲突分类与后端可信状态

- **状态**：已完成
- **完成日期**：2026-07-23
- **Feature Spec**：`docs/features/resolve-save-conflict.md`
- **结果**：在 `ipc.rs` 增加 `ConflictKind { ContentChanged, TargetMissing }` 与 `ConflictState { kind, snapshot, trusted }`。`DocumentStore` 通过 `record_conflict` 把活动文档 id、完整编辑快照和可信描述绑定到待解决状态；首次冲突不更新指纹、字节数或描述信息。候选打开只有在内容成功取回并提升为活动文档后才清除旧冲突；查询冲突不提前消费，后续解决命令须在成功或明确取消后才清除。`classify_conflict(path)` 只把 `NotFound` 归为目标缺失，其他 `metadata` 错误保留为安全的 I/O 失败。`save_document` 返回稳定代码 `save-conflict-content-changed` / `save-conflict-target-missing`（`save_document_as` 的冲突仍用 `save-conflict`）。前端已同步错误代码，但在操作界面交付前只显示安全拒绝说明，不宣传尚不可用的重新加载、覆盖、保留或放弃操作。
- **验证**：`cargo fmt` 已执行；`cargo check --all-targets`、`git diff --check` 通过；`cargo test` **87 passed / 0 failed**（新增并修正冲突分类、非 `NotFound` I/O、可信状态记录与非消费读取、过期 id、候选打开提交边界、会话成功切换清理及错误映射测试）；`npm run check` **41 passed / 0 failed**（含新增错误代码识别与未完成操作不提前展示测试）。Clippy 未运行（缺组件）。

### 实现另存为与新建文档首次保存

- **状态**：已完成
- **完成日期**：2026-07-22
- **Feature Spec**：`docs/features/save-as-and-first-save.md`
- **结果**：通过 Rust 侧 `blocking_save_file` 取得可信目标，交付 Untitled 首次保存与已有文档另存为，并支持 UTF-8/UTF-8 BOM/GBK 与 LF/CRLF 显式选择。保存核心新增 `SaveTarget { InPlace, ExistingTarget, NewTarget }`：`InPlace` 由核心校验源只读（遵守 `safe-save-core`），另存为跳过该检查；`NewTarget` 用同目录临时文件 + `sync_all` + `std::fs::hard_link` 原子且不覆盖提交（不直接对目标 `create_new`），异常仅清理唯一命名临时文件。新增异步 `save_document_as`：对话框返回后首次观测目标并路由（选当前原路径→`InPlace` 不绕过冲突保护；已存在不同目标→`ExistingTarget{observed}`；不存在→`NewTarget`），成功后更新或建立可信关联（首次保存生成新 id）。格式/id 经 header、内容经 Raw body。前端：应用内格式选择 UI、Save（Untitled→首次保存/已开→普通保存）、Save As 入口、忙碌互斥、成功关联/失败保留/取消恢复。`capability` 仍仅 `core:app:default`。竞争保护从对话框返回后首次观测开始，best-effort，OS 确认到首次观测之间窗口不可关闭（已在规格记录）。
- **验证**：`cargo fmt --check`、`cargo check --all-targets`、`git diff --check` 通过；`cargo test` 默认并发 **78 passed**、`--test-threads=1` 串行 78 passed、两测试进程并发各 78 passed；`npm run check` **40 passed**，`npm run build` 与 `npm run tauri -- build` 通过并生成 `Textora.app`；`./script/build_and_run.sh --verify` 成功启动应用。macOS 原生交互已验收空白首次保存、连续保存、UTF-8 BOM/GBK 与 LF/CRLF、取消、Mixed 转换、不可编码/歧义后改选 UTF-8、只读源与目标、已有目标覆盖确认、当前原路径冲突保护及符号链接连续保存，并核对磁盘字节与原文件保护；目标竞争和 50 MiB/通用 I/O 失败由确定性自动化覆盖。Clippy 未运行（缺组件）。

### 接入已打开文件的普通保存流程

- **状态**：已完成
- **完成日期**：2026-07-22
- **Feature Spec**：`docs/features/save-opened-file.md`
- **结果**：把 Rust 安全保存核心接入受限二进制 IPC、后端文档状态与单文档前端会话。`DocumentStore` 将新选择的文件保持为候选，只有内容按正确 id 成功取回时才替换当前可信文档，避免读取失败后旧文档无法保存；异步 `save_document` 经 Raw body + `textora-document-id` 接收请求，并用 `spawn_blocking` 执行编码、文件 I/O 与同步。打开/保存错误分别映射，保存新增 `save-failed`；前端会话保留完整 `saveError`，使用保存专用文案并展示不可编码字符的码点与偏移。`App.tsx` 提供 Save 入口、忙碌互斥、成功清脏与失败保留；`capability` 仍仅 `core:app:default`。
- **验证**：`cargo fmt --check`、`cargo check --all-targets`、`git diff --check` 通过；`cargo test` **71 passed**；`npm run check` **35 passed**；`npm run tauri -- build` 通过并生成 `Textora.app`，打开 `.app` 后进程启动。用户于 2026-07-22 确认完成规格所列 macOS 真实文件交互验收，包括 UTF-8、UTF-8 BOM、可无损重开的 CP936 成功路径及冲突、只读、超限、不可编码与编码歧义等失败保护。Clippy 未运行（缺组件）。

### 实现 Rust 文档编码与安全保存核心

- **状态**：已完成
- **完成日期**：2026-07-21
- **Feature Spec**：`docs/features/safe-save-core.md`
- **结果**：在 `src-tauri/src/document/` 增加可独立验证的保存核心，未接入 IPC 与界面。`encoding.rs` 的 `encode`：UTF-8（可选加一个 BOM，文本内 U+FEFF 原样保留）、严格 CP936；可表示性用「`encoding_rs::GBK` 无替换编码 + `validate_cp936_structure` 严格帧校验」判定；GBK 普通保存还要求经现有打开流程重开后仍识别为 GBK 且内容一致，否则返回 `EncodingAmbiguous`（纯 ASCII/空也因编码身份无法保持而拒绝，见 D-006）。`line_ending.rs` 的 `normalize` 统一到 LF/CRLF，`Mixed` 返回错误。`save.rs` 的 `save_document`：先 `canonicalize` 解析符号链接到真实目标，再对真实目标做「描述符只读前置 → 规范化与编码 → 50 MiB 限制 → 初次冲突检测 → 初次只读快检 → 同目录原子替换」（`rename` 前再次校验冲突与只读/权限）；原子替换用标准库 `OpenOptions::create_new` + `fs::rename`（无新依赖），任一步失败清理临时文件、原文件不变。**冲突检测与只读/权限保护均为 best-effort**：再次校验/权限设置与 `rename` 之间残留狭窄 TOCTOU 窗口（跨平台无严格 CAS/权限原子替换），规格与代码注释据此降级。`test_support.rs` 的 `TestDir`（PID+纳秒+RAII）消除跨进程撞名。`error.rs` 含 `ReadOnly`、`MixedLineEndingNotChosen`、`UnencodableContent { character, byte_offset }`、`SaveConflict`、`EncodingAmbiguous`，`Io` 仅 OS 文本不泄露临时路径。长期规格已同步：`DECISIONS.md` D-006、`basic-text-editing.md` 行为规则；`README.md` 改为「已完成」。
- **验证**：`cargo fmt --check`、`cargo check --all-targets`、`git diff --check` 通过；`cargo test` 默认并发 **68 passed**、`--test-threads=1` 串行 68 passed、两测试二进制进程并发各 68 passed（PID 临时目录隔离）；`npm run check` 通过（25 passed，未改前端）；`npm run tauri -- build` 通过并生成 `Textora.app`。覆盖三编码往返、纯 ASCII/空以 GBK 保存时因无法保持编码身份而拒绝、「一」`EncodingAmbiguous` 拒绝且证明误读、「一 中」混排可编码重开、BOM 恰好一个、LF/CRLF/Mixed、CP936 不可表示字符位置、50 MiB 超限、缺失/外部修改冲突、best-effort 再次校验保留外部内容并清临时文件、只读前置拒绝、打开后变只读重检、`before_replace` 阶段 `chmod 0444` 最终重检拒绝、`0600` 保留、只读目录模拟创建失败、**符号链接保存链接保留且目标更新**、成功无临时残留且指纹与磁盘一致。Clippy 未运行（stable 工具链缺组件）。

### 接入本地文件打开流程

- **状态**：已完成
- **完成日期**：2026-07-20
- **Feature Spec**：`docs/features/open-local-file.md`
- **结果**：打通系统文件选择、Rust 一致快照与严格解码、二进制 IPC、React 文档会话和 CodeMirror 编辑器。错误使用稳定代码映射且不泄露内部路径；读取失败前不替换原文档；加载期间编辑器只读且不可重复触发；前端未获得宽泛文件系统、shell 或网络权限。
- **验证**：`cargo fmt --check`、`cargo check --all-targets`、`cargo test`（40 passed）、`npm run check`（typecheck + vitest 25 passed）、`npm run build` 与 `npm run tauri -- build` 均通过；macOS 原生界面已验证确认与取消保护、UTF-8/ASCII/UTF-8 BOM/CP936 成功路径、继续输入与焦点，以及非法编码、GB18030 四字节和超过 50 MiB 的错误保护。读取失败、读取期间变化、加载只读与禁止重复触发由确定性自动化测试覆盖。

### 修复编辑器输入后失焦

- **状态**：已完成
- **完成日期**：2026-07-20
- **结果**：CodeMirror `EditorView` 仅在组件挂载时创建，不再因每次受控内容更新而销毁重建；外部内容变化通过事务同步，并避免被误报为用户编辑。连续输入时编辑器实例、焦点、内容同步与脏状态均保持正常。
- **验证**：`npm run check` 通过（3 passed / 0 failed，包含受控内容更新后编辑节点及焦点保持的 DOM 回归测试）；`npm run build`、`cargo fmt --manifest-path src-tauri/Cargo.toml --check`、`cargo test --manifest-path src-tauri/Cargo.toml`（32 passed / 0 failed）及 `npm run tauri -- build` 通过；`./script/build_and_run.sh --verify` 成功启动 macOS 应用，界面验证两轮连续输入得到 `abc123XYZ`，焦点始终位于编辑器且脏状态正确更新。

### 实现 Rust 文档读取与识别核心

- **状态**：已完成
- **完成日期**：2026-07-20
- **结果**：在 `src-tauri/src/document/` 建立内部 Rust 文档核心，未暴露为 Tauri 命令。`error.rs` 定义大小超限、无效编码、读取期间变更与 I/O 错误。`encoding.rs` 按 UTF-8 BOM → 严格 UTF-8 → 严格 CP936 顺序识别；GBK 分支先按 Unicode Consortium 发布的 Microsoft CP936 v2.01 映射范围拒绝 GB18030 四字节与超集专有双字节位置，再由 `encoding_rs` 完成映射，不外泄替换字符。`line_ending.rs` 识别 `Lf`/`Crlf`/`Mixed`；`fingerprint.rs` 生成原始字节的 SHA-256 指纹。`open_document` 使用单一文件句柄与 `MAX + 1` 有界读取，比较读取前后元数据并检测路径原子替换；描述符内部保留原始 `PathBuf`，不再有损转换。
- **验证**：`cargo fmt --manifest-path src-tauri/Cargo.toml --check`、`cargo check --manifest-path src-tauri/Cargo.toml --all-targets` 通过；`cargo test --manifest-path src-tauri/Cargo.toml` 通过（32 passed / 0 failed，覆盖空输入、ASCII、UTF-8 多字节、BOM 剥离、合法 CP936、CP936 单字节欧元与双字节边界/官方映射表签名、GB18030 四字节与超集双字节拒绝、LF/CRLF/Mixed、指纹、50 MiB 边界、有界读取、`open_document` 读取与缺失文件）；`npm run check` 与 `npm run tauri -- build` 通过。

### 建立可运行工程基线

- **状态**：已完成
- **完成日期**：2026-07-20
- **结果**：建立 Tauri 2 + React + TypeScript + Vite + CodeMirror 6 工程，实现可编辑的新建文档、文档核心健康检查 IPC、最小 capability/CSP，并配置统一构建运行脚本与 Codex Run 动作。
- **验证**：`npm run check`、`npm run build`、`cargo fmt --manifest-path src-tauri/Cargo.toml --check`、`cargo test --manifest-path src-tauri/Cargo.toml` 与 `npm run tauri -- build` 通过；`./script/build_and_run.sh --verify` 确认 macOS 进程启动；UI 冒烟确认窗口、IPC 状态、编辑输入与脏状态。

### 建立最小项目文档

- **状态**：已完成
- **完成日期**：2026-07-14
- **结果**：建立项目入口、产品、架构、决策、功能规格模板和任务文档；未确定的产品与技术选择保留为开放问题。
- **验证**：确认所请求文档均存在，并检查文档之间的职责与链接。

### 确认初始双平台技术方案（已由 D-007 取代）

- **状态**：已完成
- **完成日期**：2026-07-14
- **结果**：当时确认 macOS/Windows 产品范围、Tauri/React/CodeMirror/Rust 技术栈、50 MiB 文件上限和 UTF-8/GBK 无损编码规则，并形成基础文本编辑 Feature Spec；其中双平台产品范围后来由 D-007 取代，技术栈与文件边界继续有效。
- **验证**：检查产品、架构、决策、Feature Spec、当前任务与 backlog 的范围和术语一致性。

## 会话交接

- 产品运行与验收平台已按 D-007 收缩为 macOS 13+；Tauri 技术栈、50 MiB 上限和 UTF-8/GBK 编码边界继续有效。
- 可运行工程基线已完成并通过 macOS 验证。
- 基础文本编辑 Feature Spec 已确认。Rust 文档读取与识别核心已完成并通过 macOS 的 fmt/test/check/tauri build 验证：`analyze(&[u8])` 为纯字节分析，内部 `open_document(&Path)` 继续负责一致快照与严格解码。
- 本地文件打开切片已完成实现、自动化验证与 macOS 原生界面验收：无路径参数的 Tauri `select_and_open_document` 在 Rust 侧选择并打开文件，`read_document_content` 通过原始二进制响应传输内容；前端 capability 未获得 dialog、文件系统、shell 或网络权限。
- Rust 文档编码与安全保存核心已完成审查修复并通过 macOS 验证（fmt/check/test 68 并发+串行+跨进程/tauri build/git diff --check；Clippy 因组件缺失未运行）：`save_document` 为内部接口（未暴露为 Tauri 命令）；CP936 可表示性用「无替换编码 + 严格帧校验」判定，普通保存还要求重开后仍识别为 GBK 且内容一致，否则返回 `EncodingAmbiguous`（纯 ASCII/空因编码身份无法保持也拒绝，见 D-006）；保存先 `canonicalize` 解析符号链接到真实目标再原子替换（链接保留、目标更新）；冲突检测与只读/权限保护均为 best-effort（再次校验/权限设置与 rename 之间残留 TOCTOU，规格已如实降级）；测试临时目录 PID+纳秒+RAII。
- `save-opened-file.md` 已完成实现、自动化验证与 macOS 真实文件交互验收：后端候选打开不会提前覆盖当前可信文档，异步 `save_document` 经 Raw body + header 接收内容并在阻塞线程复用安全保存核心，前端保留完整保存错误并使用保存专用提示；capability 未新增宽泛权限。
- 「另存为与新建文档首次保存」已完成实现、自动化验证与 macOS 原生交互验收（cargo test 78 并发+串行+跨进程 / npm check 40 / build / tauri build / 启动验证）：Rust 侧系统保存对话框取得可信目标，`SaveTarget` 区分普通保存/另存已存在/新建（`NewTarget` 用临时文件+`hard_link` 原子不覆盖提交），源只读校验仅 `InPlace` 在核心执行；过期 id 写盘前拒绝，符号链接选择路径在会话中保留；前端含应用内格式选择 UI 与空白 Untitled Save/已有文件 Save As 入口。竞争保护从对话框返回后首次观测开始、best-effort。
- 「未保存关闭保护」Feature 已完成全部三个顺序任务（主窗口关闭、应用退出取消保护、确认后保存/不保存续行）与集成验收：用户发起的应用退出（`RunEvent::ExitRequested { code: None }`）一律 `prevent_exit` 并交既有确认状态机判断，不依赖前端异步武装（消除时序窗口）；`request_app_exit` 触发的 `code: Some` 程序化退出直接放行；确认后保存/不保存续行复用既有保存状态机，成功经 `request_app_exit` 退出，取消/失败/冲突/缺失清除退出意图不退出；能力仅新增 `core:event:allow-listen`/`allow-unlisten`。完整自动化（cargo test 102 / npm check 80）、构建与 macOS 真实交互（窗口按钮、`⌘W`、`⌘Q`、应用菜单 Quit、Dock Quit）均已于 2026-07-31 通过；Feature Spec 状态改为「已完成」。多标签、列块编辑和 Markdown 模式仍在 Backlog。
