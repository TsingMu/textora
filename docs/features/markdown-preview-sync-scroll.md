# Markdown Preview 左右同步滚动

> 状态：已完成（2026-08-13）

## 背景与目标

Textora 已支持 Markdown 源码与本地预览左右分栏。用户在长文档中编辑或阅读时，经常需要在源码段落和渲染结果之间来回定位；当前左右两侧独立滚动，源码区滚到某段时，预览区不会自动显示对应渲染位置，反向阅读预览时也不会带动源码区定位。

本功能目标是在 Markdown Preview 分栏开启时提供稳定、轻量的双向同步滚动：用户滚动源码区，预览区尽量跟随到对应 Markdown 块；用户滚动预览区，源码区尽量跟随到对应源码块。同步是导航辅助，不改变 Markdown 源码权威地位，不影响编辑、保存和预览安全策略。

## 范围

- 仅在 Markdown 标签开启 `Preview` 左右分栏时启用同步滚动。
- 源码编辑区滚动时，预览区跟随到对应 Markdown 块附近。
- 预览区滚动时，源码编辑区跟随到对应源码位置附近。
- 首版采用块级近似定位，覆盖标题、段落、列表、任务列表、引用、表格、普通 fenced code block 与 Mermaid fenced block。
- 同步滚动应避免双向事件循环、抖动和频繁抢占用户正在滚动的一侧。
- 源码编辑、预览重新渲染、Mermaid 异步渲染、标签切换和窗口尺寸变化后，同步关系应安全恢复或退化。

## 非范围

- 不做逐字符、逐像素精确同步。
- 不新增目录大纲、当前位置高亮、mini map、滚动锁定开关或持久化滚动位置。
- 不在 WYSIWYG、独立 Mermaid 预览、非 Markdown 标签或 Preview 关闭状态中启用。
- 不改变 Markdown 渲染结果、语法支持、代码高亮、Mermaid 安全清洗、保存格式、编码、换行或文件权限。
- 不引入网络、shell、远程页面、LSP 或外部服务。

## 用户流程

### 源码带动预览

1. 用户打开 Markdown 文件并开启 `Preview`。
2. 用户在左侧源码区向下滚动到某个标题、列表、代码块或 Mermaid block。
3. 右侧预览区自动滚动到对应渲染块附近。
4. 用户继续编辑时，编辑器保持可输入，保存仍只写 Markdown 源码。

### 预览带动源码

1. 用户在右侧预览区浏览长文档。
2. 用户滚动到某个渲染段落、表格、代码块或图表。
3. 左侧源码区自动滚动到对应 Markdown 源码块附近，方便继续编辑。

## 行为规则与边界情况

- Markdown 源码仍是唯一权威数据源；同步滚动只读取源码块与预览块的位置，不把预览 DOM 写回文档。
- 同步只在当前活动 Markdown 标签且 `Preview` 开启、WYSIWYG 关闭时启用；切换到其他标签、关闭 Preview 或进入 WYSIWYG 时应停止同步。
- 用户正在主动滚动的一侧短暂作为主控侧；程序触发的跟随滚动不得立即反向触发同步，避免循环和抖动。
- 首版优先使用块级锚点映射。若某些 Markdown 结构无法建立可靠块映射，可按滚动比例同步或暂时不跟随，但不得阻塞编辑。
- 源码修改导致预览重新渲染时，应基于新的源码/预览结构重建映射；重建期间不得丢失用户输入、选择或脏状态。
- Mermaid block 异步渲染完成后可能改变预览高度；同步映射应在渲染完成后可恢复，渲染失败时按错误占位块参与近似定位。
- 大文档或复杂预览中，同步计算应节流或批量到动画帧，避免滚动卡顿。
- 源码区滚动、预览区滚动、窗口尺寸变化和分栏宽度变化不应触发保存、重载、格式化或其他文档内容修改。
- 多标签之间的同步状态互相隔离；后台标签不应因当前标签滚动而更新滚动位置。

## 验收条件

- [x] Markdown 文件开启 `Preview` 后，源码区滚动到后续标题/段落时，预览区跟随到对应渲染区域附近。
- [x] 预览区滚动到后续段落、列表、表格、代码块或 Mermaid block 时，源码区跟随到对应 Markdown 源码附近。
- [x] 同步滚动不会出现明显双向抖动、循环滚动或用户滚动一侧被反复抢回的问题。
- [x] 编辑源码并触发预览重新渲染后，同步滚动仍能继续工作；编辑、选择、撤销、脏状态和保存链路不回退。
- [x] 关闭 Preview、进入 WYSIWYG、切换到非 Markdown 标签或切换标签时，同步滚动停止或按活动标签隔离，不污染其他标签。
- [x] Mermaid 异步渲染成功或失败后，同步滚动不会阻塞编辑，预览高度变化后仍能安全近似定位。
- [x] 大文档滚动时界面保持可用；无法可靠映射时安全退化，不抛错、不阻塞保存。
- [x] 功能不新增网络、shell、远程页面、Rust IPC、Tauri capability 或宽泛文件权限。
- [x] 自动化测试覆盖源码→预览、预览→源码、循环抑制、标签/模式边界和预览重渲染后的同步恢复。
- [x] macOS release 真实应用验收覆盖长 Markdown 文档双向滚动、编辑后继续同步、Mermaid block、关闭 Preview/WYSIWYG 边界。

## 依赖与约束

- 依赖已完成的 `docs/features/markdown-split-preview.md`、`docs/features/markdown-code-block-highlighting.md`、`docs/features/mermaid-local-preview.md` 与 `docs/features/markdown-wysiwyg-mode.md`。
- 遵守 `docs/ARCHITECTURE.md`：文本文档是编辑与保存的权威数据源，预览是可重建派生数据。
- 遵守最小权限原则；本功能为前端本地 UI 行为，不需要新增 Rust IPC、文件系统、网络或 shell 权限。
- 与原 Markdown Preview 首版决策兼容：首版已完成时不做同步滚动；本规格是后续演进，不改写历史验收。

## 决议记录

- 2026-08-12 确认首版范围。原开放问题决议如下：
  1. **映射策略**：采用块级锚点映射作为首版主路径。既有 Markdown 渲染层（`src/markdownPreview.ts` 的 `renderMarkdownToSafeHtml`）已按行扫描源码，并按块（fenced code、标题、分隔线、表格、引用、列表、段落）消费连续源码行，因此能为每个预览块记录源码行范围并以稳定 DOM 锚点（如 `data-sync-block` 序号）标记，无需退化为纯滚动比例同步。个别无法建立可靠块映射的结构仍可按滚动比例近似或暂不跟随，但不得阻塞编辑。
  2. **禁用开关**：首版不提供临时禁用同步滚动的 UI 开关；若真实使用中同步干扰编辑，再单独规格化。

## 实现拆分

1. **确认 Markdown Preview 同步滚动规格**（本任务）：确认双向同步、块级近似、循环抑制、模式边界和验收条件；不修改生产代码。
2. **建立源码块与预览块映射契约**：在 Markdown 渲染链路中形成可测试的块级锚点或位置映射；覆盖标题、段落、列表、表格、代码块和 Mermaid block；不接入滚动事件。
3. **接入源码到预览同步滚动**：监听源码区主动滚动，按映射或比例更新预览区位置；实现节流和程序滚动标记，避免反向循环。
4. **接入预览到源码同步滚动与边界恢复**：监听预览区主动滚动，更新源码区位置；处理预览重渲染、Mermaid 异步高度变化、标签切换、Preview/WYSIWYG 边界。
5. **同步滚动集成验收与文档收尾**：运行完整自动化、生产构建、Tauri release 构建和 macOS 真实应用验收；更新规格、README、current/backlog 状态。

## 验证记录

- 2026-08-12 生成草案规格；本任务只修改规划文档，未运行实现测试、构建或 macOS 真实应用验收。
- 2026-08-12 确认规格。核对既有 `src/markdownPreview.ts` 渲染层：其按行扫描源码并按块消费连续源码行（fenced code、标题、分隔线、表格、引用、列表、段落均能记录各自源码行范围），因此块级源码→预览锚点映射在首版即可实现，决议以块级锚点为主路径，纯滚动比例仅作个别结构的近似回退；首版不提供禁用开关。本任务仅修改规划文档，未运行实现测试或构建；`git diff --check` 通过。
- 2026-08-12 实现完成，自动化与 release 构建通过，macOS 真实应用交互验收**尚未执行**。逻辑层自动化覆盖：`src/markdownBlockMap.test.ts`（块映射，12 用例）、`src/markdownPreviewSync.test.ts`（源码行→块、视口顶部块、相对偏移、scrollIntoView 与程序标记复位，12 用例）、`src/Editor.test.tsx` 与 `src/App.test.tsx`（源码→预览、预览→源码、非 Markdown 边界集成用例）。`npm run check` 通过（typecheck + vitest **310 passed / 0 failed**）；`npm run tauri -- build` 通过并生成 release `Textora.app`；bundle 校验 `CFBundleIdentifier`=`com.tsingmu.textora`、`CFBundleExecutable`=`textora`、`CFBundleIconFile`=`icon.icns`；`src-tauri/capabilities/` 自 `63800c3` 起无改动，确认未新增网络、shell、远程页面、Rust IPC、Tauri capability 或宽泛文件权限；release app 可启动。保存链路、撤销、脏状态与多标签隔离未改，由既有自动化回归覆盖。
- 2026-08-13 完成 macOS release `Textora.app` 真实应用交互验收。使用包含标题、段落、列表、表格、JSON fence 与 Mermaid fence 的长 Markdown 临时文档：源码区取得焦点后 Page Down，预览跟随到第三节与 Mermaid 区域；预览区取得焦点后 Page Down，源码跟随到 Mermaid、第五节和第六节附近；源码编辑触发预览重渲染后再次 Page Up，双向映射继续工作；Mermaid 已从 loading 状态完成本地渲染，异步高度变化后仍能继续近似定位；关闭 Preview、进入 WYSIWYG、切到 Plain Text 标签后 Preview 均不再挂载或参与同步。交互过程中未观察到明显双向抖动、循环滚动或滚动侧被反复抢回。编辑内容随后撤销，临时验收文件未保存并已清理。
