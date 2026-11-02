# RESULT: T02-06 — 修改表格列对齐

- **状态**：complete（P2 已关闭，Codex 复审通过）；TASK r1，父 T02；2026-11-02。
- **基线与范围**：HEAD `fe44de8dd25b98e8537eca107b0f35fd530adf4a`（与 TASK 规划基线一致）。开始前工作区已含 T02-01～05、有序列表修复、T03 导出与文档/依赖的未提交差异，全部保留；本项只追加列对齐实现与测试。先在 current.md 将本任务设为唯一进行中后才改实现产物。未暂存/提交/推送/更新安装版。

## 实际交付与后续契约

- `src/markdownTable.ts` 新增 `changeMarkdownTableAlignment(source, table, index, alignment): string | null`：default/left/center/right 对应 `---`/`:---`/`:---:`/`---:`（映射常量 `markdownTableAlignmentTokens`）。重扫核对原文与范围后，仅用 `replaceMarkdownSourceRange` 替换目标 separator cell 的 token 区间（保留该单元左右 padding 与行内其他字节）；同值重复选择显式返回 null（无操作，非失败）；候选重扫核对 to/行数/header+rows 全部 cell token/其余 separator token/alignments 后才返回。支持无外侧管道的一列分隔行（`| A |\r\n:----:`）。
- `src/MarkdownWysiwygTableEditor.tsx` 新增 `onAlignmentChange` 与 `Column N alignment` 控件组（四按钮 `Align default/left/center/right`，aria-label `Set column N alignment to X`，当前值禁用并 `aria-current`）。`applyAlignment` 复用 `valid()`/组合/`pendingRef` 保护：确认待决、组合未确认、busy/锁定/只读均禁用；不提升 structureRevision/headerRevision、不发 focusRequest——不重挂载任何输入宿主，焦点与原生输入历史原地保留。错误状态扩展 `alignment` 变体文案。
- `src/MarkdownWysiwygEditor.tsx` 接线 `onAlignmentChange`（与行/列同一 `submit`/App 门禁路径）；新增测试覆盖 `markdownTable.test.ts`、`MarkdownWysiwygTableEditor.test.tsx`、`markdownPreview.test.ts`、`markdownBlockMap.test.ts`、`App.test.tsx`。无新样式（复用 `wysiwyg-table-column-actions`）。

## 验收与验证

所有命令在 `/Users/mouqing/codexProjects/textora` 执行；日志在 `/private/tmp`（不作为永久归档）。

| 验收 / 验证 | 实际结果 |
| --- | --- |
| 06-AC-1 | PASS：四种对齐即时更新 thead/tbody `textAlign` 并与 Preview `style="text-align: …"` 一致（preview 测试逐字节断言 html）；同值按钮禁用且纯函数返回 null，不触发 onChange/脏状态；App 级保存内容恰为目标分隔单元替换、重开/预览一致 |
| 06-AC-2 | PASS：diff 恰为 `source.slice(0,cell.from)+token+source.slice(cell.to)`（padding/邻列/表格外/EOL 逐字节保留，含非规范 padding、`:----` 变体）；行列交错（对齐→插行→插列→删列）后列对齐正确、新列默认；对齐操作不重挂载输入宿主，焦点全程保持 |
| V-06 | PASS：`npm run test -- src/markdownTable.test.ts src/MarkdownWysiwygTableEditor.test.tsx src/markdownPreview.test.ts src/markdownBlockMap.test.ts src/App.test.tsx` 退出 0，5 files / 309 tests，`/private/tmp/textora-t02-06-v06.log` |
| 完整前端回归 | PASS：`npm run check`（含 typecheck）退出 0，30 files / 733 tests，`/private/tmp/textora-t02-06-check.log`（测试类型修正后最终全套与 V-06 均重新通过） |
| V-Q | PASS：`npm run typecheck`、`npm run build`（含 typecheck）退出 0，build 仅既有 chunk 体积提示，`/private/tmp/textora-t02-06-build.log`。`git diff --check`、`git diff --cached --check` 退出 0；所触及文件（含未跟踪）无行尾空白 |
| WebKit 定向 | PASS：组件 bundle + App.css 独立宿主，`swift -module-cache-path /tmp/textora-t02-06-qa/swift-cache /tmp/textora-t02-06-qa/alignment.swift` 退出 0，末行 `ALIGNMENT PASS`。1000/720px × 明暗 4 例：行/列/对齐三组工具栏均在视口内；3 相交互：center/left/default 三次提交的源码均恰为目标 token 替换、当前项禁用状态切换、真实 WebKit 下 `document.activeElement` 与输入宿主节点身份全程不变。日志/代码在 `/tmp/textora-t02-06-qa/` |
| V-07 / V-MAC | NOT_RUN：release bundle、完整安装版平台矩阵由 T02-07 承接 |
| Rust / IPC / 权限 | N/A：未改对应实现/配置，未引入运行时依赖 |

过程偏差：新增测试最初用 `querySelectorAll(...)[i].style` 未带 `HTMLElement` 泛型，vitest 不做类型检查先通过、`npm run check` 的 tsc 报 5 处；补泛型后最终全套通过。交错用例的预期串两次修正（漏表头空列、漏既有空行），均为测试预期错误，实现行为始终符合契约。

## 自检与遗留

- 核对范围：TASK r1、SPEC FR-5/BR-3/6/8、父 C-1/C-4、05 RESULT 交接；alignment 走既有 `submit`/App 快照门禁，未新建确认或焦点机制。
- 已知边界：显式对齐仅规范化目标分隔单元为 3 横线规范形（BR-6 允许）；列宽、快捷键、新表格不在范围。对齐命令不重挂载结构，行列命令语义未变（V-06 全量含行/列/单元回归）。
- 对后续影响：T02-07 组合验收应把“对齐→行/列命令→保存重开”纳入交错矩阵；父表 V-06 证据由本 RESULT 承接。
- Review 提出的 P2 已按下述修复记录处理；其余自检结论不变。

## Codex Review / 完成确认

2026-11-02：Codex 聚焦 Review 未通过。局部 token 替换、默认/左对齐区分、同值无操作、会话接线及行列交错检查未发现其他可执行问题；以下问题须修复后复审，T02-07 继续 blocked。本轮未修改业务代码。

### [P2] 将旧行数组移出逐单元校验循环

- 位置：`src/markdownTable.ts:457–460`，第 459 行 `[model.header, ...model.rows][i]`。
- 触发与影响：较多行表格执行对齐变化时，每比较一个 cell 都重新分配并复制全部旧行引用，复杂度变成 O(rows² × columns)。点击处理在 UI 线程同步执行，导致卡顿和大量临时数组；这是本任务新增路径。
- 独立复现：项目根执行 `node_modules/.bin/esbuild src/markdownTable.ts --bundle --platform=node --format=esm --outfile=/private/tmp/textora-t02-06-review-table.mjs`，退出 0。Node 导入 scanner/命令，生成双列表头、分隔行及重复的 `| x | y |` 数据行，先扫描，再仅计 `changeMarkdownTableAlignment(source, scan.table, 0, "center")`。1,000/4,000/8,000/16,000 行分别耗时 11/76/270/1217 ms，均返回候选，命令退出 0。16,000 行源码仅 160,024 字节，远低于 50 MiB 上限。计时为本机 Node 定向结果，非 WebKit 性能验收。
- 原因隔离：仅在临时 bundle 中将比较改为 `(i === 0 ? model.header : model.rows[i - 1]).cells[j].source`，4,000/8,000/16,000 行为 9/19/24 ms，均返回候选，退出 0。临时变体不是仓库修复或最终验收。
- 已核对既有 V-06（309 tests）、完整 check（733 tests）、build 和 WebKit 宿主脚本/日志（ALIGNMENT PASS），相关实现修改时间早于证据；这些小表证据不覆盖规模风险。本轮未重跑全套、构建或原生宿主。Review 文档更新后另执行 diff 检查。

### 可直接交给实施 LLM 的修复说明

修复 `src/markdownTable.ts` 中 `changeMarkdownTableAlignment` 的候选校验：内层 `row.cells.some` 每次执行 `[model.header, ...model.rows][i]`，导致合法多行表格操作呈平方复杂度，约 160 KB 的 16,000 行表格已耗时约 1.2 秒并同步阻塞 UI。请在循环外仅创建一次旧行数组，或直接按 header/data-row 索引读取；保留逐 cell、其余 separator、alignments 与范围的全部安全校验，不做无关重构。补较多行表格的精确目标 token diff/内容保留回归，并用 4k/8k/16k 定向计时检查增长趋势，避免普通单测采用依赖机器速度的严格毫秒阈值。修复后运行 `npm run test -- src/markdownTable.test.ts src/MarkdownWysiwygTableEditor.test.tsx src/markdownPreview.test.ts src/markdownBlockMap.test.ts src/App.test.tsx`、`npm run typecheck`、`npm run build`、`git diff --check`、`git diff --cached --check`，按影响判断是否补全套回归，更新本 RESULT 后交 Codex 复审。当前任务保持唯一进行中，T02-07 不释放。

### P2 修复记录（2026-11-02，实施模型）

- `src/markdownTable.ts` `changeMarkdownTableAlignment`：候选校验在逐行比较回调内重复构建 `[model.header, ...model.rows]` 导致 O(rows²)。改为在重扫后一次构建 `previousRows` 再比较；逐 cell、其余 separator token、alignments、to/行数与范围校验全部保留，无其他重构。行/列/单元命令路径未改动（其比较数组本就在循环外构建）。
- 新增回归：`markdownTable.test.ts` "keeps the exact target-token diff and every row on many-row tables"——1,200 行表格（表头含转义管道、code 管道）对齐变更断言 diff 恰为目标 token 替换、全部行 source 逐字节保留、alignments 正确、同值再操作返回 null；不使用机器速度阈值。
- 计时趋势（定向脚本，非单测、非 WebKit 验收）：`node_modules/.bin/esbuild src/markdownTable.ts --bundle --platform=node --format=esm --outfile=/private/tmp/textora-t02-06-perf/table.mjs` 退出 0；`node /private/tmp/textora-t02-06-perf/timing.mjs` 退出 0，4k/8k/16k 行 = 12.1/16.2/27.5 ms（修复前同机量级为 11/76/270/1217 ms 中的 76/270/1217），增长趋势为线性（重扫主导），候选均返回。
- 修复后验证（均在项目根，退出 0）：V-06 五文件命令 5 files / 310 tests（`/private/tmp/textora-t02-06-v06-fix.log`）；`npm run check` 30 files / 734 tests（`/private/tmp/textora-t02-06-check2.log`）；`npm run typecheck`、`npm run build`（仅既有 chunk 提示）；`git diff --check`、`git diff --cached --check` 退出 0。WebKit 小表交互证据（ALIGNMENT PASS）不受本修复影响，行为断言未变。
- 待 Codex 复审 P2 修复；T02-06 维持唯一进行中，T02-07 不释放。

### Codex 复审完成确认（2026-11-02）

P2 已关闭，06-AC-1～2 确认通过；未发现其他可执行问题，无需生成新的修复说明。上文初审问题与修复交接保留为已关闭的历史证据。

- 检查 `previousRows` 已移到比较循环外，仅分配一次；逐 cell、separator、alignments、范围和行数校验全部保留。新增 1,200 行回归核对精确 token diff、所有行原文及同值无操作，修复未触及 UI、IPC 或保存路径。
- 独立复验 PASS：项目根 `npm run test -- src/markdownTable.test.ts`，退出 0，1 file / 54 tests；另用 esbuild 打包当前模块至 `/private/tmp/textora-t02-06-rereview.mjs` 后执行 Node 定向脚本，4k/8k/16k 行耗时 7.4/15.8/26.5 ms，三个候选均逐字等于仅替换目标 token 的预期，退出 0。已消除原先平方复制路径；本机计时不是 WebKit 整体性能保证。
- 读取并复用修复后的 V-06（310 tests）、完整 check（734 tests）及 build2 成功日志；本轮未重复全套、构建和原生宿主。此前 WebKit 小表交互仅作为未改动 UI 的证据，完整 release 矩阵仍由 T02-07 承接。文档更新后执行 staged/unstaged diff 检查。
- T02-06 完成，允许 T02-07 准入；本轮不启动其实现，父模块尚未完成。工作区其他任务差异保留，本确认仅覆盖 T02-06 及本次修复。
