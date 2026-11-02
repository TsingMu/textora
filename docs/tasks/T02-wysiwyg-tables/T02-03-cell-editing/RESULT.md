# RESULT: T02-03 — 编辑表格单元格文字并安全回写会话

- **状态**：complete；TASK r1，父 T02；2026-11-02。Codex 完整自审确认见下；父模块未完成。
- **基线**：HEAD `fe44de8dd25b98e8537eca107b0f35fd530adf4a`。开始前已有 T02-01/02、有序列表修复、T03 导出及相关文档/依赖未提交差异，全部保留；先更新 current 为唯一进行中，再实施。本轮未提交/推送/安装覆盖。

## 实际交付与后续契约

- 新增 `MarkdownWysiwygTableCellEditor.tsx` / `.test.tsx`：复用现有 InlineNode/转义/序列化模型与样式，按已有片段使用原生 textarea；镜像布局支持长中文/路径软换行。空单元及删空片段保留原生控件；正常输入不重挂载，保留选区和原生文字撤销。五类格式保持、链接只编辑标签。
- `MarkdownWysiwygTableEditor.tsx` 接收可选 `onCellChange(row, column, inlineSource): boolean` 与 `contextRevision`，缺少回调时继续只读；row=-1 为表头，column 从 0 开始。单元背景可聚焦首个输入，Tab/Shift+Tab 原生移动，不增加行或结构命令。
- `MarkdownWysiwygEditor.tsx` 使用 `replaceMarkdownTableCell` 的目标 token patch，不重建整块/整篇；返回 false 拒绝失败提交。自身已接受内容与外部内容变化区分，外部任意块更新递增 contextRevision，使旧组合失效；自有逐键更新保持控件身份。
- `App.tsx` 以 tabId/documentId/source/模式/只读/锁定及编辑上下文 revision 校验，并在 functional state update 再核验当前会话。切标签按 tabId/documentId 重建编辑器；切回相同标签、恢复模式或解锁不复活旧回调。文件缺失/关闭确认等即时 ref 也参与门禁。
- 输入组合期间仅保留本地 draft，确认时单次回写；Enter/beforeinput 不插入换行但不拦截组合确认；粘贴仅取 text/plain，CR/LF/Tab 归为空格，优先原生 insertText 以保留撤销，非可用环境有 setRangeText 回退。外部更新/锁定取消旧组合，迟到的非 composition 输入也不会被误判为新输入；新的键盘、指针、粘贴或组合意图可继续输入。
- 边界普通空格属于既有表格 padding，暂存在控件供后续单词输入，不重复改写原有 padding。提交前校验内联可见文字往返；code fence 增长后保留长度。既有语法/codec 不能无损表达的组合（例如 code 内管道前奇数反斜杠、code 边界反引号）会拒绝、回退文字并显示源码模式提示，绝不静默丢字符或更改列数。未扩大原内联语法，不改变其他块的默认编辑实现。

04 可在表格视图上增加当前焦点行列目标、结构回调与确认；必须继续使用上下文 revision、App 提交门禁及更新后的 token 范围。结构命令不应复用 cell callback 伪装成整表更新，不从 aria-label 反解析持久身份；新行焦点恢复由 04 实现。

## 验收与验证

所有命令在 `/Users/mouqing/codexProjects/textora` 执行；日志与宿主位于临时目录，非永久归档。

| 验收 / 验证 | 结果与证据 |
| --- | --- |
| 03-AC-1 | PASS：实际 textarea 事件覆盖表头/普通/空/删空再输入、五类片段、中文/emoji、转义/代码 fence、粘贴/Enter/Tab/组合与安全失败回退。真实 WKWebView 的原生输入路径及文字 undo/redo 见下 |
| 03-AC-2 | PASS：CRLF、相邻片段、链接目标及表格外源码保留；App 实际单元输入后 mock 二进制保存载荷等于仅目标 token 改变的 Markdown，Preview 文字正确；保存期间输入禁用；未产生 DOM/格式数据入文件 |
| 03-AC-3 | PASS：外部更新单元或仅改其他块、锁定和迟到 composition/input 事件被拒绝；App 捕获旧回调在切标签/模式、外部重载、另存为面板及只读时拒绝，切回同一标签/模式、取消面板也不能复活；有真实控件输入/状态断言，非仅手调回调 |
| V-03 | PASS：`npm run test -- src/markdownTable.test.ts src/MarkdownWysiwygTableEditor.test.tsx src/MarkdownWysiwygTableCellEditor.test.tsx src/MarkdownWysiwygEditor.test.tsx src/MarkdownWysiwygInlineEditor.test.tsx src/App.test.tsx`，退出 0，6 files / 278 tests。包含新增适配器测试；日志 `/tmp/textora-t02-03-v03.log` |
| 全套前端检查 | PASS：最终 `npm run check`（含 typecheck），退出 0，30 files / 686 tests；`/tmp/textora-t02-03-check.log` |
| V-Q | PASS：`npm run typecheck`、最终 `npm run build`（含 typecheck）退出 0；build 只有既有 chunk 大小提示，`/tmp/textora-t02-03-build.log`；最终 staged/unstaged diff 检查退出 0，并检查新增文件与队列规则 |
| WebKit 原生定向验证 | PASS：实际组件 bundle + App.css 在独立 WKWebView 宿主运行，`swift -module-cache-path /tmp/textora-export-qa/swift-cache /tmp/textora-t02-03-qa/input.swift` 退出 0，最后输出 NATIVE INPUT PASS；宿主与日志/截图位于 `/tmp/textora-t02-03-qa/` |
| V-07 / V-MAC | NOT_RUN：release bundle、安装版全场景及系统输入法候选窗手工矩阵由 07 承接；本项原生 marked-text 证据不冒充完整手工平台验收。未更新安装版 |
| Rust / IPC / 权限 | N/A：本项无相关变更，不冒用此前 T03 的验证 |

原生定向证据：720/1000px × light/dark 的编辑器 scrollWidth=clientWidth，6 个可编辑宿主，长路径/中文换行正常；窄窗明暗及 1000px 暗色截图已查看。由 macOS NSTextInputClient.setMarkedText/insertText 触发真实 WebKit composition/input，中文中间态不提交，确认仅一次。原生 insertText/undo、中文确认后的 undo/redo 保留 Markdown/格式，输入控件引用不变；组合过程中仅改表格外正文，迟到的原生提交仍拒绝。粘贴回调走原生插入后只回写一次，undo 精确恢复外部新正文快照。该宿主程序化驱动原生输入客户端与浏览器 undo 栈，不是仅派发 JavaScript composition 事件，也未声称手工操作系统候选窗。

过程偏差：首轮旧只读断言和空 token 的 padding 位置预期随输入适配更新；保护断言保留。新增 App spy 未及时恢复曾使测试 wrapper 递归并导致 worker 退出，已用 finally 恢复，最终全部稳定通过。初次原生 QA 日志试图序列化 DOM 引用失败，修复日志后重跑完整断言退出 0。自审增加了表格外更新失效、同标签返回/解锁 epoch 保护，以及 code 边界反引号可见文字往返校验，均有回归证据。

## Codex 完整 Review 与确认

同一 Codex 实施后完整自审，未声称独立代理复核。检查本项全部生产差异和新增文件：内联与表格转义层次、token 范围/未编辑源码、空片段和 code fence、可见文字往返、原生选区/IME/undo、粘贴/失败回退、禁用与原文锁定、标签/模式/外部更新/恢复上下文的迟到事件、functional update 二次校验、镜像布局与安全属性，以及前置和本轮测试证据。原表格纯函数、其他内联编辑器、Rust/权限及导出实现未改；既有差异保留。

审查发现的问题已在本轮关闭，最终无待修可执行问题，无需生成修复说明。03-AC-1～3 确认通过，T02-03 完成，允许 T02-04 准入；本轮不实施下一项，父模块最终集成仍待 07。
