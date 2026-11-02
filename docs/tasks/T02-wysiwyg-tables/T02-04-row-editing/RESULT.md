# RESULT: T02-04 — 插入和删除表格数据行

- **状态**：complete；TASK r1，父 T02；2026-11-02。Codex 聚焦确认见下，父模块仍未完成。
- **基线与范围**：HEAD `fe44de8dd25b98e8537eca107b0f35fd530adf4a`；工作区已有 T02-01～03、有序列表修复、T03 导出与文档/依赖的未提交差异，全部保留。先将 current 转为唯一进行中再实施；未提交/推送/更新安装版。

## 实际交付与后续契约

- `markdownTable.ts` 新增 `MarkdownTableRowCommand`：insert index 为插入位置（0～rows.length），delete index 为已有数据行（0～rows.length-1）；不存在表头删除命令。`changeMarkdownTableRow(source, table, command): string | null` 重新核对原文与实际扫描结果，仅增删行 token 及必要换行；新空行使用表头与分隔行之间的换行，原行/内联 token、header、separator、对齐、外围空白和末尾换行不重建。候选重新扫描并逐行比较，失败返回 null。
- `MarkdownWysiwygEditor.tsx` 沿用 03 submit/App 门禁，新增结构回调 `onRowChange(command): string | null`：只在提交被接受后返回候选完整源码；不是 cell callback，也不从 DOM 获取保存内容。向视图传 `documentSource`，使表格外的自有源码编辑也取消旧确认。
- `MarkdownWysiwygTableEditor.tsx` 保留当前聚焦 row/column（header=-1），操作控件在横向滚动区外，按钮有明确目标行的无障碍名称。表头只提供其后插入；数据行前/后插入；空行直接删除，任何含源码内容的行就地显示目标/内容摘要并确认，默认聚焦取消。确认不改变源码/脏状态，其他结构动作不可叠加。
- 确认和提交使用局部 epoch、当前源码快照、contextRevision、disabled 与存活状态校验；源码更新（包括其他块）、锁定或会话切换清除旧确认，返回旧状态不复活。即时 ref 防重复点击；03 的 App 级 tab/document/source/上下文门禁仍做最后提交校验。
- 结构回调返回的候选源码与受控 props 一致后才在 layout effect 聚焦；无定时重试。插入聚焦新行同列；删除聚焦原位置下一行、无则前一行、再无则表头同列。成功结构操作重建 tbody 输入宿主，避免把已删/移位行的原生输入历史复用到新行；表头组合态也随结构 revision 失效，普通逐键输入不重挂载。
- 当前表格存在未确认 IME 组合时暂禁结构操作，避免把源中仍为空的单元当空行直接删除；组合结束后恢复。没有新增列操作、对齐命令或结构撤销。

05 应沿用单一 pending/epoch/focusRequest 与当前 selected row/column，不再建立可叠加的另一组确认。列操作可增加独立回调，但同样返回已接受的候选源码用于受控确认后聚焦；列移动还需处理表头输入宿主身份。焦点定位使用 data-table-row/data-table-column，不解析 aria-label。普通结构候选无法维持既有扫描边界时（例如空行前插到全横线数据行前会形成相邻表格歧义），保持原文并提示源码模式，不擅改扫描契约或重写剩余行。

## 验收与验证

所有命令在 `/Users/mouqing/codexProjects/textora` 执行，临时路径不作为永久归档。

| 验收 / 验证 | 实际结果 |
| --- | --- |
| 04-AC-1 | PASS：首条/前后插入、空行/末行删除、表头保留、列数/对齐不变，纯函数及实际控件事件覆盖；生成 1～6 列矩形测试 |
| 04-AC-2 | PASS：LF/CRLF/CR、末尾有/无换行、相邻表格/正文、格式与转义 token 原样保留；取消不写回、不置脏；App mock 保存的二进制内容只删除目标行。组件及 WebKit 实测新行、下一行、前一行、表头焦点 |
| 04-AC-3 | PASS：局部确认禁叠加、重复点击单次提交、源码/其他块更新、锁定/解锁、标签/模式切换、只读及外部重载后的旧确认不写入；未确认组合时禁止行操作 |
| V-04 | PASS：最终 `npm run test -- src/markdownTable.test.ts src/MarkdownWysiwygTableEditor.test.tsx src/App.test.tsx` 退出 0，3 files / 247 tests，`/tmp/textora-t02-04-v04.log` |
| 完整前端回归 | PASS：`npm run check`（含 typecheck）退出 0，30 files / 707 tests，`/tmp/textora-t02-04-check.log`；补充修复后最终全套、V-04 和 build 均重新通过 |
| V-Q | PASS：`npm run typecheck` 及最终 `npm run build`（含 typecheck）退出 0；build 只有既有 chunk 提示，`/tmp/textora-t02-04-build.log`。staged/unstaged diff 检查退出 0，新增 RESULT 与当前队列规则另行检查 |
| WebKit 定向 | PASS：实际组件 bundle + App.css 的独立宿主，`swift -module-cache-path /tmp/textora-export-qa/swift-cache /tmp/textora-t02-04-qa/rows.swift` 退出 0，最后 ROW ACTIONS PASS。25 段交互/检查及原生 marked-text 路径；日志/代码/截图在 `/tmp/textora-t02-04-qa/` |
| V-07 / V-MAC | NOT_RUN：release bundle、完整安装版平台矩阵由 T02-07 承接；本项定向宿主不是安装版完整手工验收 |
| Rust / IPC / 权限 | N/A：本项未改对应实现/配置，不复用历史验证冒充新检查 |

WebKit 证据：720/1000px × light/dark 测量 editor scrollWidth=clientWidth，行工具按钮始终位于视口内；720px 明色及非空确认暗色截图已查看。实际运行插入前后/首行、空行删除、非空确认/取消、重复确认、外部正文变化/锁定取消、删除最后一行恢复表头焦点，最终 8 次合法提交、header/对齐/外部新正文仍保留。NSTextInputClient 的未确认原生组合期间全部行操作禁用，组合结束后恢复，未误删未提交内容。按钮由宿主脚本触发并检查实际 DOM/原生焦点，未声称物理鼠标或系统候选窗全矩阵已验收。

过程偏差：首次原生脚本在删除中间空行后仍查找旧行按钮，而实现按契约聚焦下一行；脚本失败退出 1。修正脚本为先验证下一行焦点，再显式选择目标行；完整复验退出 0，未修改正确的产品焦点行为。普通全套/定向测试均通过。自检补充了 IME 未确认时的结构操作保护及明确目标行 aria-label。

## 自检与 Codex 聚焦完成确认

同一 Codex 实施后自检并聚焦确认，未声称独立代理 Review。核对 TASK/03 RESULT、全部行命令和关键接线：原始行/EOL 边界、末行/表头保护、候选重解析、当前源码及外围保持、非空/取消/重复/过期确认、锁定与会话门禁、结构输入宿主身份及确定性焦点，以及对应自动化和原生证据。无新增依赖、Rust、权限或保存策略改变。

最终无待修可执行问题，无需生成修复说明。04-AC-1～3 确认通过，T02-04 完成，允许 T02-05 准入；本轮不实施下一项，父模块未标完成。

后置复查已关闭：外部更新后通过新的指针/键盘意图恢复仍有焦点的单元目标；组合锁按实际输入目标跟踪，旧单元的组合结束不清除另一单元的新锁。原生复验发现 input 捕获阶段更新目标会干扰未确认文字并阻止解锁，现移除此路径，改为输入前的键盘/指针意图及同目标无操作更新。最终原生宿主确认未确认中文字仍在控件中、确认后操作恢复，全部行流程通过；完整检查 707 项、定向 247 项与 build 重新通过，完成确认恢复。无需生成待修说明。
