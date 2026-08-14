# Markdown 所见即所得模式

> 状态：已完成（2026-08-11；长文本自动换行修复与 macOS 窄窗口视觉验收于 2026-08-14 完成）

## 背景与目标

Textora 已支持 Markdown 源码编辑、源码/预览左右分栏、Markdown fenced Mermaid 渲染和预览代码块语法着色。左右分栏适合校对渲染结果，但用户在写作时仍需要在源码标记和预览结果之间来回映射；对于标题、段落、列表、引用和代码块等日常结构，希望能直接在接近最终视觉的界面中编辑。

本功能目标是在不破坏 Markdown 源码权威地位的前提下，提供一个可与源码/分栏预览切换的 Markdown 所见即所得编辑模式。所见即所得模式是源码的结构化编辑视图：用户在其中编辑时，Textora 仍维护并保存 Markdown 源码；无法安全结构化编辑的片段应退化为源码岛，而不是丢弃或重写。

## 范围

- 仅对 Markdown 文档（`.md` / `.markdown`）提供所见即所得入口。
- Markdown 标签默认仍进入源码编辑模式；用户通过工具栏手动切换到 WYSIWYG。
- WYSIWYG 与现有源码模式、左右分栏 Preview 模式按标签保存在当前会话内，不写入磁盘、不作为全局偏好、不跨重启恢复。
- 首版 WYSIWYG 支持结构化编辑常用块级语法：
  - 标题（ATX heading）
  - 普通段落
  - 无序列表、任务列表和有序列表
  - 引用块
  - fenced code block
  - 分隔线
- 首版对复杂或高风险结构使用源码岛编辑：表格、Mermaid fenced code block、未知 fenced code block、原始 HTML、未识别块或未来扩展语法。
- 用户在 WYSIWYG 中修改内容后，Markdown 源码、脏状态、保存、关闭保护和预览派生结果随之更新。
- 切换回源码模式时，应能看到 WYSIWYG 编辑后的 Markdown 源码。
- 保存仍只写 Markdown 源码，不保存渲染 DOM、样式类或编辑器内部结构。

## 非范围

- Typora/Obsidian 完整体验或所有 Markdown 方言的无损可视编辑。
- 跨重启恢复 WYSIWYG/Preview 模式偏好。
- 滚动同步、目录大纲、脚注、数学公式、HTML 所见即所得、图片真实加载、远程资源加载。
- Mermaid 图表的可视拖拽编辑。
- 代码块内部语言服务、自动格式化、自动闭合 fence、补全或诊断。
- 富文本剪贴板、从网页粘贴并转换 Markdown、导出 PDF/HTML/图片。
- 改变编码、换行、保存目标、冲突保护、Rust 文件核心、Tauri capability、网络或 shell 权限。

## 用户流程

1. 用户打开或另存为一个 Markdown 文件。
2. 工具栏显示 `Preview` 与 `WYSIWYG` 两个入口；默认仍显示源码编辑。
3. 用户点击 `WYSIWYG` 后进入单栏结构化 Markdown 编辑视图。
4. 用户直接编辑标题、段落、列表、引用或代码块内容。
5. 用户切回源码或 Preview，可看到编辑后的 Markdown 源码或派生预览。
6. 用户保存文档时，保存的是 Markdown 源码。

## 行为规则与边界情况

- Markdown 源码仍是唯一权威数据源；WYSIWYG DOM/组件状态是可重建派生编辑视图。
- WYSIWYG 只在 Markdown 标签显示；非 Markdown 标签不显示入口。
- 同一 Markdown 标签在源码、Preview、WYSIWYG 之间切换时，不应改变内容、编码、换行或保存格式。
- WYSIWYG 与 Preview 互斥显示：打开 WYSIWYG 时隐藏左右分栏 Preview；打开 Preview 时退出 WYSIWYG。
- 首版不承诺逐字符保留被编辑块的原始空白和标记风格；但未编辑块、源码岛和不支持语法不得被静默重写。
- fenced code block 首版以源码岛方式编辑完整 fence 内容；不执行代码、不格式化代码、不加载远程资源。
- fenced `mermaid` code block 在 WYSIWYG 首版中以源码岛显示和编辑，不在该模式内渲染为可视图表；图表预览仍由现有 Preview/Mermaid 预览负责。
- 原始 HTML 在 WYSIWYG 中按源码岛或文本显示，不作为可执行 DOM 注入。
- WYSIWYG 中的标题、段落、列表项、引用、fenced code block、代码语言标记与源码岛等可编辑文本，在内容超过控件可视宽度时必须软换行并保持完整可见、可编辑；软换行只属于派生视图，不得向 Markdown 源码插入额外换行或改变块结构。
- WYSIWYG 解析失败时应退化为源码编辑或源码岛，不阻止用户继续编辑和保存。
- 加载、保存中、保存冲突、文件缺失、关闭确认和另存为面板期间，WYSIWYG 编辑区与源码编辑器一样被锁定。
- 只读 Markdown 文件中的 WYSIWYG 编辑区被锁定；源码编辑器保留既有“本地编辑后另存为副本”的产品行为。
- 大文件规则沿用 50 MiB 上限；若结构化解析或渲染明显卡顿，应优先退化为源码模式，不影响打开、保存或关闭保护。

## 验收条件

- [x] Markdown 文件显示 `WYSIWYG` 入口；非 Markdown 文件不显示该入口。
- [x] 点击 `WYSIWYG` 后进入单栏所见即所得编辑视图；点击 `Preview` 后退出 WYSIWYG 并进入现有左右分栏预览。
- [x] 在 WYSIWYG 中编辑标题、段落、列表、引用和 fenced code block 后，切回源码能看到对应 Markdown 源码已更新。
- [x] WYSIWYG 编辑会触发脏状态；保存后磁盘内容为 Markdown 源码，不包含 DOM 或样式产物。
- [x] 多标签切换时，每个 Markdown 标签的 WYSIWYG/Preview/源码状态互不污染。
- [x] 表格、Mermaid fenced block、原始 HTML 或未知结构以源码岛方式保留，不被静默丢弃或执行。
- [x] 只读、保存中、冲突、文件缺失和关闭确认期间不能继续编辑 WYSIWYG 内容。
- [x] 功能不引入网络、shell、远程页面或宽泛文件系统权限。
- [x] 自动化测试覆盖模式入口、模式互斥、内容同步、保存源码、多标签隔离和源码岛退化。
- [x] macOS release 应用真实验收覆盖模式入口与互斥、常见块编辑后源码往返、源码岛保留、保存源码、多标签隔离、只读锁定和未保存关闭保护。
- [x] 长列表项及其他 WYSIWYG 可编辑块在窄窗口内自动软换行、保持完整可见和可编辑，且保存源码不产生额外换行。

## 依赖与约束

- 依赖已完成的基础文本编辑、多标签会话、保存/另存为、未保存关闭保护、Markdown 源码高亮、Markdown 左右分栏预览和 Markdown fenced Mermaid 本地渲染。
- 遵守 `docs/ARCHITECTURE.md`：文本文档是编辑与保存的权威数据源，预览或结构化视图是可重建派生数据。
- 遵守最小权限原则：前端不得获得宽泛文件系统、shell、远程页面或任意网络能力。
- 遵守 D-004 与 D-007：继续使用 Tauri 2、React/TypeScript、CodeMirror 6 与 Rust 技术栈；只要求 macOS 行为验收。

## 决议记录

- 2026-08-10 确认首版范围：
  1. WYSIWYG 是 Markdown 的第三种手动模式，不替代默认源码编辑，也不改变现有 Preview 左右分栏入口。
  2. 模式状态按标签保存在当前会话内；不做全局偏好、不跨重启恢复。
  3. 首版优先交付常见块级结构的结构化编辑；复杂语法使用源码岛，避免为追求“看起来完全可视化”而破坏源码无损。
  4. 保存永远写 Markdown 源码，WYSIWYG DOM 不进入文件。
  5. Mermaid 在 WYSIWYG 首版中不是可视拖拽图表编辑器；图表可视化仍走现有 Preview。

## 实现拆分

Markdown 所见即所得模式按以下顺序拆成可连续交付的小切片。`docs/tasks/current.md` 同一时间只保留下一个待执行切片。

1. **确认 Markdown 所见即所得模式规格**（本任务）：确定模式关系、源码权威、源码岛、安全边界、非范围和验收条件；不修改生产代码。
2. **建立 Markdown WYSIWYG 块模型与源码往返契约**：新增纯前端解析/序列化模块，把 Markdown 源码拆成可编辑块与源码岛；覆盖标题、段落、列表、引用、fenced code block 和未知结构保留测试；不接入主界面。
3. **接入 Markdown WYSIWYG 模式入口与会话状态**：为 Markdown 标签提供 `WYSIWYG` 入口；按标签记录源码/Preview/WYSIWYG 模式；与现有 Preview 互斥；非 Markdown 不显示入口。
4. **实现首版 WYSIWYG 编辑视图**：用块模型渲染可编辑结构化视图，编辑后同步 Markdown 源码、脏状态和保存/关闭保护；只读/忙碌状态下锁定编辑。
5. **WYSIWYG 集成验收与文档收尾**：完整自动化、前端构建、release 构建和 macOS 真实应用验收；规格状态改为已完成，必要时同步 README。

## 验证记录

- 2026-08-14 发现 WYSIWYG 长列表项超过可视宽度后被单行裁切，且当前交互无法拖动查看剩余内容。已承诺后续任务「修复 Markdown WYSIWYG 长文本无法完整查看」：修复列表项的自动软换行，并检查标题、段落、引用、fenced code block、代码语言标记与源码岛等其他可编辑块是否存在同类问题后统一处理；实现与验证尚未执行。

- 2026-08-14「修复 Markdown WYSIWYG 长文本无法完整查看」：把 WYSIWYG 标题、列表项文本、代码语言标记由单行 `<input>` 改为自动增高的 `<textarea>`（新增内部 `AutoGrowTextarea`：按 `scrollHeight` 自动扩展高度、`wrap="soft"` 视觉软换行、`singleLine` 模式拦截 Enter 并在 `onChange` 清洗 `\r`/`\n` 保持源码单行，IME 组合态期间不拦截 Enter），普通段落、引用、fenced code、源码岛与空文档也统一改用该组件。按审查强化高度测量：`useLayoutEffect` 依赖纳入 `className`（标题级别/控件样式变化时重测），以 `ResizeObserver` 监听控件宽度变化（容器/窗口宽度变化时重测，替代窗口 resize 监听），首次回调只记录宽度避免循环；文本相同而级别/样式/宽度变化时不再保留过期高度，且不为大量文本框在每次渲染制造重复布局。`App.css` 把编辑器内 textarea 设为 `resize:none`，为 `markdown-wysiwyg-list-text`/`code-language`/`empty` 补 `display:block`，`list-text` 设 `width:100%` 填充网格单元并在窄窗口随宽度软换行，`list-item` 改 `align-items:start` 并给 marker/任务复选框顶部偏移使其与首行对齐。软换行只影响派生显示，不向 Markdown 源码注入额外换行或改变块结构。验证：`npm run check` 通过（typecheck + vitest **384 passed / 0 failed**，含 `MarkdownWysiwygEditor` 13 用例：单行控件为 textarea 且换行清洗为单行源码、Enter 拦截、IME 组合态不拦截、多行段落允许换行、长中文/英文无空格列表项保持单行、jsdom 无 `scrollHeight` 不抛错，以及 AutoGrowTextarea 尺寸行为：mount 测高、值变化重测、className 即标题级别变化在文本相同时重测、ResizeObserver 宽度变化重测、宽度不变不重测无循环；既有 heading/source island 用例改为 textarea setter，App 集成用例 heading 操作同步改为 textarea）；`npm run build` 通过；`npm run tauri -- build` 通过并生成 release `Textora.app`（bundle `CFBundleIdentifier`=`com.tsingmu.textora`、`CFBundleExecutable`=`textora`、`CFBundleIconFile`=`icon.icns`）；`src-tauri/capabilities/` 无改动，未新增网络、shell、远程页面、Rust IPC、Tauri capability 或文件权限；`git diff --check` 通过。macOS release 窄窗口真实视觉验收**未执行**——`osascript` 无辅助访问权限（错误 -1719）无法驱动应用 UI，且 app 无 `RunEvent::Open`/文件关联、Untitled 为纯文本，无法自动加载长内容 Markdown 到 WYSIWYG；该视觉验收已拆为 `docs/tasks/current.md` 的独立待办，最后一条验收条件仍为未勾选。

- 2026-08-14「修复 AutoGrowTextarea 忽略首次 ResizeObserver 通知」：修正上一切片「首次回调只记录宽度」的取舍——多个控件挂载后父容器滚动条可能缩小可用宽度，首次 `ResizeObserver` 通知携带最终宽度，跳过重测会使长文本仍按挂载时宽度测量而被裁切。改为首次通知在设置 `widthRef` 后执行一次 `resize()`（按最终宽度重读 `scrollHeight`），后续仅在宽度变化时重测；`resize()` 只改高度不改宽度，不触发宽度变化的循环回调。仅改 `src/MarkdownWysiwygEditor.tsx`。验证：`npm run check` 通过（typecheck + vitest **385 passed / 0 failed**，新增用例：首次通知按最终宽度重测（40px→70px）、相同宽度后续通知不重复测量（不变成 250px）；既有尺寸/重渲染用例不回退）；`npm run build` 通过；`git diff --check` 通过。macOS 视觉验收仍为独立待办。

- 2026-08-14「修复 AutoGrowTextarea 自动测高边框误差」：修复项目全局 `box-sizing: border-box` 下 `resize()` 直接把 `scrollHeight` 当作最终 CSS 高度的边框误差。`scrollHeight` 不含边框，而 border-box 的 CSS `height` 须含边框，直接用 `scrollHeight` 会使带边框控件高度偏小、内容可能被裁切；改为 `scrollHeight + (offsetHeight - clientHeight)`（补上下边框总宽度）。仅改 `src/MarkdownWysiwygEditor.tsx`。验证：`npm run check` 通过（typecheck + vitest **386 passed / 0 failed**，新增用例：mock `scrollHeight=40`、`offsetHeight=50`、`clientHeight=48`（1px 上下边框）时最终高度为 42px；首次 `ResizeObserver` 重测、宽度变化重测、宽度不变无循环用例不回退）；`npm run build` 通过；`git diff --check` 通过。macOS 视觉验收仍为独立待办。

- 2026-08-14「Markdown WYSIWYG 长文本软换行 macOS 窄窗口视觉验收」：用户在 release `Textora.app`（含首次 RO 通知与边框补正修复）中打开 `samples/markdown-wysiwyg-wrap-smoke.md` → 切到 `WYSIWYG` → 把窗口缩到最小宽度 720px，确认标题（H2/H3）、段落、无序/有序/任务列表项、引用、fenced code（JSON/Python）、代码语言标记与表格源码岛均在窄窗口内自动软换行且完整可见可编辑；列表 marker 与任务复选框与首行顶部对齐；长文本高度自动扩展；保存后磁盘 Markdown 源码无额外换行、块结构不变。用户确认验收通过。最后一条验收条件已勾选，Feature Spec 状态改为「已完成（长文本自动换行修复与 macOS 窄窗口视觉验收于 2026-08-14 完成）」，README 同步。本次仅记录用户完成的 macOS 真实应用视觉验收，未修改实现代码或依赖，未重新运行自动化或构建（沿用前置修复任务已通过的 `npm run check` 386 tests 与 `npm run tauri -- build` 结果）。

- 2026-08-10「建立 Markdown WYSIWYG 块模型与源码往返契约」：新增 `src/markdownWysiwyg.ts` 与 `src/markdownWysiwyg.test.ts`，建立首版纯前端块模型。解析支持标题、段落、无序/有序/任务列表、引用、fenced code block 与分隔线；表格、原始 HTML、Mermaid fence、未知 fence 和未知结构作为源码岛保留；序列化会把块模型写回 Markdown 源码。验证：`npm run test -- markdownWysiwyg` 通过（**4 passed / 0 failed**）；`npm run build` 通过；`git diff --check` 通过。本切片未接入主界面。
- 2026-08-10「接入 Markdown WYSIWYG 模式入口与首版编辑视图」：Markdown 标签新增 `WYSIWYG` 工具栏入口，非 Markdown 不显示；WYSIWYG 与 Preview 按标签互斥，默认仍为源码编辑；新增 `MarkdownWysiwygEditor` 把块模型渲染为标题、段落、列表/任务列表、引用、fenced code block、分隔线和源码岛编辑视图，编辑后同步 Markdown 源码、脏状态、保存和关闭保护链路；只读 Markdown 的 WYSIWYG 字段禁用，源码编辑器继续保留既有只读另存为副本流程。未新增依赖、网络、shell、Rust IPC、Tauri capability 或远程资源能力。验证：`npm run test -- markdownWysiwyg MarkdownWysiwygEditor tabSession App` 通过（**98 passed / 0 failed**）；`npm run check` 通过（typecheck + vitest **202 passed / 0 failed**）；`npm run build` 通过；`npm run tauri -- build` 通过并生成 release `Textora.app`；`git diff --check` 通过。当前自动化环境未做真实 WebView 人工点击验收。
- 2026-08-11「WYSIWYG 集成验收与文档收尾」：新增 `samples/markdown-wysiwyg-smoke.md`，在 release `Textora.app` 完成真实 macOS UI 验收。确认 Markdown 才显示 Preview/WYSIWYG 入口；WYSIWYG 正确呈现并可编辑标题、段落、列表、任务项、引用和 fenced code block；切换 Preview 后源码与派生预览同步且 WYSIWYG 自动退出；普通标签与 Markdown 标签的模式和内容隔离；保存后磁盘只有 Markdown 源码，表格、Mermaid fence 与原始 HTML 源码岛保留；未保存关闭确认正常；把样例临时设为只读后，WYSIWYG 所有字段及任务复选框均禁用，验收后已恢复文件权限和样例原始内容。验证：`npm run test -- markdownWysiwyg MarkdownWysiwygEditor tabSession App` 通过（**98 passed / 0 failed**）；`npm run check` 通过（typecheck + vitest **202 passed / 0 failed**）；`npm run build` 通过；`npm run tauri -- build` 通过并生成 release `Textora.app`；`git diff --check` 通过。未发现需要修改生产代码的阻塞问题。
