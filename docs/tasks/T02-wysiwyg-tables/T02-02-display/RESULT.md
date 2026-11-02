# RESULT: T02-02 — 展示已有表格并对齐 Preview 语义

- **状态**：complete；TASK r1，父 T02；2026-11-02。下述 Codex 自审确认完成；父模块尚未完成。
- **基线**：HEAD `fe44de8dd25b98e8537eca107b0f35fd530adf4a`；开始前已有 T02-01、有序列表修复及 T03 导出的未提交实现/测试/文档。保留全部既有差异；先转换 current 状态再实施，未提交/推送/覆盖安装版。

## 实际交付与后续接口

- 新增 `src/MarkdownWysiwygTableEditor.tsx` 及组件测试。React 语义 table/thead/th/tbody/td 展示表头、空数据、格式、转义管道与四种对齐；容器可聚焦滚动，明暗样式/长路径换行限制在本组件。`{table: MarkdownTable, disabled?: boolean}`；本项始终只读，无输入/结构命令和写回回调。
- `markdownWysiwyg.ts` 的共享遍历返回 `{type: "table", table}`，序列化直接返回 rawSource；不规则候选和列表内缩进表格保留源码岛，引用不新增嵌套表格支持。原 UTF-16 range 与原文保持。
- `MarkdownWysiwygEditor.tsx` 接入 blocks/ranges，每次只序列化并替换目标块，拒绝锁定和无变化提交；不再通过全篇 join 重写其他块。继续使用 T02-01 的范围/原文校验，保持被编辑块原有单块序列化规则。
- `markdownPreview.ts` 对共享有效子集使用同一扫描器、解表格层转义与对齐；仍输出一个顶层 table。五类内联显示复用既有 `parseInline` 和提取的 `inlineNodeVisibleText`；React 内联编辑默认行为不变。不规则 Preview 表格仍走旧 fallback。Preview 链接 URL 与图片 alt/URL 占位保留，WYSIWYG 链接仍仅显示标签；均无 href/src/HTML 执行。
- T02-03 下一步须开启 cell 输入、空值入口、IME/粘贴与 token patch，并按父 C-3 加 App 的 tabId/content/locked 最新快照门禁；本项不宣称已经解决所有旧编辑事件的跨标签竞态。增删行列与对齐命令仍由后续任务承接。

## 验收与验证

命令均在 `/Users/mouqing/codexProjects/textora` 执行，临时日志/截图用于本轮复核，非永久归档。

| 验收 / 验证 | 真实结果与证据 |
| --- | --- |
| 02-AC-1 | PASS：表头/空数据/四种对齐/五类格式、空单元、安全文本、非法表格源码保留均有组件与解析断言；WebKit 四组布局见下 |
| 02-AC-2 | PASS：编辑标题/段落/列表/引用/code/source island 的实际组件事件，仅目标块发生变化；LF/CRLF/CR、多表、外围空白保留。App 重复切 WYSIWYG/Preview 后源码逐字符相等、Save 仍禁用 |
| 02-AC-3 | PASS：双模式解码与样式比较、单/多反引号、转义标记/管道；链接/图片无导航/加载节点；Preview 不规则表格旧输出不变；相邻表格/正文的锚点、行区间与顶层数量覆盖三种换行 |
| V-02 | PASS，最终 `npm run test -- src/markdownTable.test.ts src/markdownWysiwyg.test.ts src/MarkdownWysiwygEditor.test.tsx src/MarkdownWysiwygTableEditor.test.tsx src/markdownPreview.test.ts src/markdownBlockMap.test.ts`，退出 0，6 files / 118 tests |
| 补充完整前端回归 | PASS，`npm run check`（含 typecheck），退出 0，29 files / 659 tests；`/tmp/textora-t02-02-check.log`。其后仅格式/EOF 清理；最终 V-02 和带 typecheck 的 build 再次通过 |
| V-Q | PASS，`npm run typecheck` 及最终 `npm run build`（含 typecheck）退出 0；build 日志 `/tmp/textora-t02-02-build.log`，只有既有 chunk 大小提示。`git diff --check`、`git diff --cached --check` 退出 0；检查 staged/unstaged 和新增文件 |
| WebKit 定向布局 | PASS，临时 Swift WKWebView 加载实际组件 bundle 与 App.css，`swift -module-cache-path /tmp/textora-export-qa/swift-cache /tmp/textora-t02-02-qa/layout.swift` 退出 0。720/1000px × light/dark 四张截图逐张查看；`layout.log` 证实 editor scrollWidth=clientWidth=720/1000，宽表容器 656/936px、内容 1009px，长路径换行、仅表头可读、editableCells=0。位于 `/tmp/textora-t02-02-qa/`；这是组件宿主的真实 WebKit 定向验证，不冒充安装版整应用验收 |
| V-07 / V-MAC | NOT_RUN：release bundle、完整安装版平台/IME/保存矩阵由 T02-07 承接；当前只读切片无 cell IME/撤销行为。未替换运行中的安装版 |
| Rust / IPC / 权限验证 | N/A：本项未改相关实现或配置；不重复用之前 T03 的结果冒充本项验证 |

过程说明：首次 WebKit 在沙箱内因服务访问限制超时退出 2；相同测试宿主获执行权限后成功退出 0。审查发现首次共享内联实现会隐藏 Preview 原有 URL/图片占位，已恢复并增加专门断言。随后定向测试曾因移除 URL 节点后的额外空格比较失败（117/118）；按实际可见空白归一比较，另保留 URL/图片专门精确断言，最终 V-02 与全套回归通过，未降低产品验收。

## Codex 完整 Review / 完成确认

同一 Codex 实施后完整自审，未声称独立代理复核。已检查本项全部生产差异与新增组件，范围包括源码权威、块 offset/局部更新、未编辑表格与空白、序列化兼容、列表/引用边界、扫描前进、Preview fallback/块映射、安全转义与链接/图片、对齐值来源、disabled 只读、局部滚动/明暗和前端回归证据；保留既有 T02-01/T03 差异。审查中关闭 Preview 展示回退问题及列表内表格边界问题。

最终无待修可执行问题，无需生成修复说明。02-AC-1～3 确认通过，T02-02 完成，允许 T02-03 准入；本轮不继续实施下一项。完整模块与真实应用集成验收仍待 T02-07。
