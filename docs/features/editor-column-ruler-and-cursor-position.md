# 编辑器列标尺与光标行列位置

> 状态：实现完成，macOS 真实应用验收待执行

## 背景与目标

Textora 已支持列块编辑与自动换行开关，但用户查看日志、定宽文本、代码或批量处理列块时，仍需靠目测判断当前列及跨行对齐位置。目标是在源码编辑器上方提供与横向滚动同步的列标尺，并在状态栏持续显示当前主光标的逻辑行与显示列，让列块工作流具备稳定、可读的坐标参照。

## 范围

- 在所有 CodeMirror 源码编辑区的状态栏显示当前主选择头部的 1-based 行号与显示列，文案固定为 `Ln 1, Col 1`。
- 在关闭 `Word Wrap` 时，于源码编辑器上方显示横向列标尺；开启软换行时隐藏标尺，状态栏行列位置继续显示。
- 标尺每列有基础刻度，每 5 列使用更明显的中刻度，每 10 列使用最强刻度并显示十进制列号。
- 标尺刻度表示对应字符列的右边界：输入第 5 个窄字符后的光标与刻度 5 对齐；行首插入点是刻度前的零边界。标尺随 CodeMirror 的横向滚动同步移动，行号 gutter 保持固定。
- 状态栏与标尺采用同一套显示列单位：Tab 按编辑器 4 列制表位推进，Unicode 宽字符占 2 列，普通字素簇占 1 列，组合标记不额外增加列宽。
- 普通文本、代码、Markdown/Mermaid 源码以及 Markdown Preview 左侧源码区适用；WYSIWYG 与预览渲染区不显示其自身的行列位置或标尺。

## 非范围

- 不新增列标尺或光标位置的显示开关，也不持久化新的查看偏好。
- 不提供点击标尺定位、拖拽参考线、跳转到行/列、字符偏移、选择长度或多光标坐标列表。
- 不改变 Tab 宽度、字体、CodeMirror 矩形选择算法、短行补空格或现有列块编辑语义。
- 不在 WYSIWYG 的独立可编辑片段、Markdown Preview 或 Mermaid 渲染结果上建立派生坐标。
- 不修改用户文件内容、编码、换行、脏状态、撤销历史或保存结果。

## 用户流程

1. 用户把光标放在源码编辑器的任意位置，状态栏显示当前 `Ln` 与 `Col`。
2. 用户输入、移动光标、扩展选择或切换标签，行列位置立即更新为当前主选择头部的位置。
3. 用户关闭 `View > Word Wrap`，源码编辑器上方出现列标尺。
4. 用户横向滚动长行，标尺与源码内容同步移动，可据此检查不同逻辑行的列对齐。
5. 用户重新开启软换行或进入 WYSIWYG，列标尺隐藏；回到适用的非换行源码视图后重新出现。

## 行为规则与边界情况

- 行号以 CodeMirror 已规范化的文档逻辑行为准，首行为 1；软换行产生的视觉续行不增加行号。
- 列号表示主选择 `head` 前的 1-based 插入列。行首为 `Col 1`；一个普通字素簇后为下一列。
- 显示列按 Unicode 字素簇计算：窄字符及 East Asian Ambiguous 字符宽度为 1；East Asian Wide/Fullwidth 字符及 emoji 展示簇宽度为 2；组合标记、变体选择符和连接符序列包含在所属字素簇中，不单独增加宽度。无法分类时安全按 1 列处理。
- Tab 使用当前 CodeMirror `EditorState.tabSize`；首期编辑器保持默认值 4。Tab 将插入位置推进到下一个 4 列制表位，例如行首 Tab 后为 `Col 5`。
- 非空选择显示主选择的 `head`，而不是较小的文档偏移；反向选择因此显示用户正在移动的一端。矩形/多选区只显示 CodeMirror `main` 选择的 `head`，不汇总其他光标。
- 文档编辑、选择变化、撤销/重做、外部内容采用、标签切换和源码编辑器重新挂载后都必须刷新位置；同一位置的无关视图更新不应产生重复 React 状态更新。
- 状态栏位置只在当前存在 CodeMirror 源码视图时显示。进入 WYSIWYG 后隐藏；Preview 左侧源码和 Mermaid 源码仍存在，因此继续显示。重新进入源码视图时以实际编辑器选择初始化，不恢复一套独立坐标状态。
- 标尺只在 `Word Wrap` 关闭且 CodeMirror 源码视图存在时显示。软换行开启时隐藏，避免逻辑列刻度与从左侧重新排版的视觉续行产生错误对齐暗示。
- 标尺使用编辑器实际字符宽度和滚动位置定位，不把固定 CSS 像素值当作文档列宽；窗口、分栏或字体度量变化后应重新对齐。每 10 列数字不得改变相邻刻度间距。标尺显示时去除源码区原有的顶部内容留白，使首行紧接标尺；开启软换行、标尺隐藏时保留原有顶部留白。
- macOS 的 CJK/emoji 回退字体实际 advance 若不是主等宽字体的精确两倍，源码视图应把逻辑宽度为 2 的完整字素簇放入 `2ch` 视觉单元格；不得改变文档字符、UTF-16 选择偏移、语法高亮、撤销或保存内容。
- 水平滚动仅更新标尺视图，不更新文档位置、不触发 `onChange`，也不干扰现有 Preview 纵向同步滚动回调。
- 空文档显示 `Ln 1, Col 1`。只读、加载或保存锁定不妨碍查看已有位置；编辑器尚未挂载或已卸载时不显示陈旧坐标。

## 验收条件

- [x] 空文档及普通 ASCII 文本中的光标移动，状态栏以 `Ln n, Col n` 正确显示 1-based 逻辑行和列。
- [x] Tab、中文/全角字符、emoji、组合标记和普通字素簇按已确认显示列规则计算，无法分类时安全退化。
- [x] 正向/反向非空选择及矩形多选区均显示主选择 `head` 的位置。
- [x] 输入、删除、撤销/重做、标签切换、打开/恢复/外部采用内容及源码模式重新挂载后位置及时更新，且不改变内容或脏状态。（打开/恢复/外部采用与输入共用同一内容同步→docChanged→重算链路。）
- [ ] 关闭自动换行后标尺出现，输入第 n 个窄字符后的光标与刻度 n 对齐；中文、全角字符及 emoji 的视觉单元格与 2 个窄字符列宽一致；基础、5 列与 10 列刻度层级清晰，10 列显示数字，首行与标尺之间无额外顶部空白。
- [ ] 横向滚动时标尺与内容同步，gutter 不移动；窗口缩放、Preview 分栏和字体度量变化后仍保持对齐。
- [x] 开启软换行或进入 WYSIWYG 时标尺隐藏；状态栏位置在软换行源码与 Preview/Mermaid 源码中继续显示，在 WYSIWYG 中隐藏。
- [x] 位置与标尺更新不触发 `onChange`、不新增撤销步骤、不修改选择、滚动、编码、换行或磁盘内容。
- [x] 只读与忙碌状态可继续查看位置和标尺；切换标签或模式不会显示上一源码视图的陈旧坐标。
- [x] 自动化覆盖显示列纯函数、Editor 选择/滚动通知、状态栏与模式/标签边界、标尺刻度及水平滚动同步。
- [ ] `npm run check`、`npm run build`、`cargo test --manifest-path src-tauri/Cargo.toml`、`npm run tauri -- build` 与 `git diff --check` 通过；macOS release 真实应用验收覆盖 ASCII/Tab/中文、横向滚动、软换行及 Preview/WYSIWYG 边界。

## 依赖与约束

- 依赖已完成的列块编辑、代码语法高亮、Markdown Preview/WYSIWYG、Mermaid 源码与预览，以及全局自动换行开关。
- 遵守 `docs/ARCHITECTURE.md`：文本文档仍是权威数据源；位置与标尺都是可重建的前端派生视图，失败不得阻止编辑或保存。
- CodeMirror 选择和滚动状态是运行期位置事实来源；React 只接收最小派生快照，不维护第二套编辑器选择。
- 显示列规则用于本功能的坐标展示，不追溯改变现有 `rectangularSelection()` 的选择行为；若将来需要统一列块选择对宽字符的命中算法，应单独形成规格。
- 首期不新增 Rust IPC、Tauri capability、网络、shell、文件权限或通用设置框架。

## 开放问题

暂无阻止首期实现的问题。已确认：1-based 逻辑行与显示列、Tab 取 CodeMirror 当前 4 列制表位、宽/全角及 emoji 为 2 列、组合字素不重复计列、主选择 `head`、标尺仅在关闭软换行时显示，以及 WYSIWYG 不建立源码坐标。

## 任务拆分

1. **确认列标尺与光标行列位置规格**（已完成）：确认坐标、Unicode、Tab、软换行、滚动、模式与多选择边界；不修改实现。
2. **在状态栏接入光标行列位置**：建立显示列纯函数与 Editor 最小位置通知，在状态栏显示活动源码视图主光标位置；覆盖 Unicode、选择、编辑、标签和模式测试，不实现标尺。
3. **实现关闭软换行时的横向列标尺**：建立字符宽度/水平滚动快照和刻度视图，使标尺与源码内容同步；不新增显示偏好或修改位置语义。
4. **列标尺与光标位置集成验收及文档收尾**：执行完整回归、release 构建、权限核验和 macOS 真实应用验收，只做必要小修并同步文档。

## 验证记录

- 2026-08-19 完成规格确认：复核现有 `Editor` 的 CodeMirror update listener、`main` 选择、`EditorState.tabSize`、横向 `scrollDOM`、Preview 纵向同步回调、全局 `Word Wrap` 状态和状态栏布局。首期确定状态栏始终报告源码主选择的 1-based 逻辑行/Unicode 显示列；标尺只在关闭软换行时显示并与内容水平滚动同步；WYSIWYG 隐藏源码位置。现有列块选择行为不追溯修改。本任务仅修改规划文档，未修改生产代码、实现性测试、依赖或构建配置，未运行测试或构建。
- 2026-08-19「在状态栏接入光标行列位置」：新增 `src/cursorPosition.ts` 显示列纯函数（`Intl.Segmenter` 字素簇 + 安全退化；Tab 制表位、宽/全角与高位 emoji 2 列、VS15/VS16 覆盖、组合标记不计列）与 `Editor.onCursorPosition` 最小通知（挂载初始报告、`selectionSet || docChanged` 派生、同值去重、卸载清空）；App 状态栏在源码视图显示 `Ln n, Col n`，WYSIWYG 隐藏、Preview 左侧源码继续显示。验证：`npm run check`（typecheck + vitest **470 passed / 0 failed**，含坐标纯函数 7、Editor 通知 4、App 状态栏/模式/标签边界 3 用例）、`npm run build` 与 `git diff --check` 通过。
- 2026-08-19「实现关闭软换行时的横向列标尺」：新增 `src/columnRuler.tsx`（`rulerTicksFor` 纯刻度数学 + `ColumnRuler` 展示组件）；`Editor` 在关闭软换行时经 `measureColumnRulerMetrics` 用实际字符宽与内容/滚动容器矩形差测量并对齐，滚动与 `ResizeObserver` 触发重测，gutter 固定，度量不可用渲染空标尺。验证：`npm run check`（typecheck + vitest **479 passed / 0 failed**，含刻度数学/渲染、软换行与模式边界用例）、`npm run build` 与 `git diff --check` 通过。
- 2026-08-19「列标尺与光标位置集成验收及文档收尾」：补删除/撤销后位置映射与只读下持续上报用例；完整回归、release 构建、bundle/权限核验与 release 启动确认通过（验证实例已清理）。8 条可由自动化/代码确认的验收条件已勾选；标尺与源码首列的实际像素对齐、横向滚动的视觉同步及 macOS 真实应用组合验收待人工执行——当前自动化环境无辅助访问权限且 jsdom 无布局，无法进行视觉判定。验证：`cargo fmt --manifest-path src-tauri/Cargo.toml --check`、`cargo test --manifest-path src-tauri/Cargo.toml`（**163 passed / 0 failed**）、`npm run check`（typecheck + vitest **481 passed / 0 failed**）、`npm run build`、`npm run tauri -- build` 与 `git diff --check` 通过。
- 2026-08-19「修复列标尺 gutter 重测与 BMP emoji 宽度」：标尺重测的 ResizeObserver 增加对 `.cm-gutters` 的观察（行数位数变化改变 gutter 宽度但不改变 scroller 尺寸，此前 `originLeft` 过期错位）；显示列宽字符区间加入 BMP `Emoji_Presentation` 展示集（⌚、♿ 等无 VS16 也占 2 列），VS15 仍强制 1 列。验证：`npm run test -- cursorPosition columnRuler Editor`（**103 passed / 0 failed**，含 9→10 行 gutter 变宽重对齐回归与 ⌚/♿/VS15 宽度用例）、`npm run check`（typecheck + vitest **483 passed / 0 failed**）、`npm run build` 与 `git diff --check` 通过。
- 2026-08-19「修复标尺测试生命周期与纯零宽字素列宽」：`Editor.test.tsx` 补 `Range.getClientRects` 桩，gutter 回归测试在恢复 `ResizeObserver`/getter spy 前先卸载编辑器并尝试清空异步测量；`clusterDisplayWidth` 无可见基础码点的字素（ZWSP/ZWJ/ZWNJ、孤立组合标记）返回 0 列。定向测试、构建与 diff 检查通过；该任务当时记录连续两次完整检查通过，但后续独立审查在同一工作树复现一次失败、一次通过，确认测试仍有延迟 geometry update 泄漏，随后由独立修复任务解决。
- 2026-08-19「修复 gutter 重对齐回归测试的异步泄漏」：回归测试移除与目标无关的 9→10 行真实 CodeMirror 文档替换，改为直接模拟 gutter 变宽后的内容左边界并触发已捕获的 ResizeObserver；恢复全局桩前以 `root.render(null)` 卸载 Editor，避免延迟 geometry update 跨测试泄漏。未修改生产代码。验证：`npm run test -- cursorPosition columnRuler Editor`（**104 passed / 0 failed**）、连续三次 `npm run check`（typecheck + vitest **484 passed / 0 failed**，每次退出码 0）、`npm run build` 与 `git diff --check` 通过；Vite 大 chunk 提示为既有。
- 2026-08-19 macOS 真实应用首次视觉验收发现标尺第 1 列落在正文首字符左侧：原实现使用 `.cm-content` 容器边界，遗漏 CodeMirror 行元素的左内边距。修复为通过 `EditorView.coordsAtPos` 测量当前可见逻辑行的真实行首插入坐标；新增容器边界与实际插入点相差 8px 的回归，确保采用插入点。验证：`npm run test -- Editor columnRuler`（**96 passed / 0 failed**）、`npm run check`（typecheck + vitest **485 passed / 0 failed**）、`cargo test --manifest-path src-tauri/Cargo.toml`（**163 passed / 0 failed**）、`npm run tauri -- build` 与 `codesign --verify --deep --strict /Applications/Textora.app` 通过；修复版已重新部署并启动，实际像素对齐等待用户复验。
- 2026-08-19 后续视觉验收确认刻度语义与期望相差一列，并指出首行与标尺间的 20px 内容留白冗余。按用户确认把刻度改为字符列右边界：输入第 5 个窄字符后的光标对应刻度 5；标尺显示时通过状态类移除源码区顶部留白，软换行开启且标尺隐藏时维持原布局。验证：`npm run test -- columnRuler Editor`（**96 passed / 0 failed**）、`npm run check`（typecheck + vitest **485 passed / 0 failed**）、`npm run tauri -- build` 与安装包签名校验通过；修正版已重新部署并启动，等待真实视觉复验。
- 2026-08-19 中文视觉宽度复验发现 macOS 字体回退与逻辑列宽不一致；本机 13px Menlo 测量为窄字符约 7.83px、中文 13px，即中文只有约 1.66 个窄字符列。新增共享 `graphemeDisplaySegments`，位置计算与 CodeMirror 视觉装饰复用同一字素宽度事实；逻辑宽度为 2 的 CJK/emoji 完整字素簇渲染为 `2ch` 单元格，不改变源码、选择偏移、`onChange` 或保存内容。验证：`npm run test -- cursorPosition Editor columnRuler`（**107 passed / 0 failed**）、`npm run check`（typecheck + vitest **487 passed / 0 failed**）、`npm run tauri -- build` 与安装包签名校验通过；修正版已重新部署并启动，等待真实视觉复验。
