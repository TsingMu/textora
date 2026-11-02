# RESULT: T02-05 — 插入和删除表格列

- **状态**：complete（Codex 完整 Review 通过）；TASK r1，父 T02；2026-11-02。
- **基线与范围**：HEAD `fe44de8dd25b98e8537eca107b0f35fd530adf4a`（与 TASK 规划基线一致）。工作区在开始前已含 T02-01～04、有序列表修复、T03 导出与文档/依赖的未提交差异，全部保留；本项只在其上追加列操作实现与测试。先在 current.md 将本任务设为唯一进行中后才改实现产物。未暂存/提交/推送/更新安装版。

## 实际交付与后续契约

- `src/markdownTable.ts` 新增 `MarkdownTableColumnCommand`（`{type:"insert"|"delete"; index}`，insert index 0～列数为新列落位，delete index 为已有列，仅存一列时拒绝）与 `changeMarkdownTableColumn(source, table, command): string | null`：重扫核对原文与范围后，把 header/全部数据行/alignments 在目标位置插空（新列对齐 default）或删列，逐 cell 沿用原始 table-layer token（无 decode/escape 二次编码）经 `formatMarkdownTable` 生成规范管道体（外侧管道、单空格 padding、分隔单元 3 横线），仅替换当前表格区间；候选在原文档中重扫，核对 to/行数/每行 token/对齐完全一致才返回，否则 null 不改原文。列命令是唯一允许重建表头的结构路径；行命令语义未变。
- `src/MarkdownWysiwygTableEditor.tsx`：新增 `onColumnChange` 与列控件组（`Table column actions`，aria-label 含明确目标列）；“Delete column N”在仅剩一列时禁用。非空列（判定含表头）就地确认，与行确认共用同一 `pending/epoch/pendingRef`（Confirmation 增加 `kind: "row"|"column"`），不可叠加；取消/锁定/外部更新/组合中规则与行一致。`run` 重构为 `submit(kind, command, target)`，即时 ref 防重复点击保留。列操作成功同时提升 `structureRevision` 与新增 `headerRevision`：tbody 与 thead 都以字符串前缀 key 重建（`head:N`/`body:N`，避免同级数字 key 撞车），表头输入宿主获得全新原生输入历史；行操作只提升 `structureRevision`，表头宿主身份不变。插列聚焦新列同行；删列聚焦右邻（删末列则左邻）。错误提示区分 row/column。
- `src/MarkdownWysiwygEditor.tsx` 接线 `onColumnChange`（与 `onRowChange` 同一 `submit`/App 门禁路径，返回受控后的候选源码）；`src/App.css` 为列工具栏/确认块添加与行等价的共享样式；`src/App.test.tsx`、组件与纯函数测试同步新增。

## 验收与验证

所有命令在 `/Users/mouqing/codexProjects/textora` 执行；日志在 `/private/tmp`（不作为永久归档）。

| 验收 / 验证 | 实际结果 |
| --- | --- |
| 05-AC-1 | PASS：左右插列/删列在所有行列与 alignments 同步（含仅表头表、LF/CRLF/CR、文件前后缀、邻接表格）；仅存一列时纯函数拒绝且按钮禁用；插删往返后源码逐字节复原 |
| 05-AC-2 | PASS：剩余 cell 原始 token（含 `a\|b`、三连反斜杠+管道、code/link 内管道、中文格式、空单元）逐字符保留；表格外源码不变；显式列操作只规范化当前表格体，相邻表格字节不动；取消不置脏 |
| 05-AC-3 | PASS：非空列（含表头）确认/取消、确认期间行/列动作禁叠加、双击仅一次提交、外部更新清确认且旧确认不复活、锁定/只读禁用、IME 未确认时列操作禁用；连续行列交错后焦点按右邻/左邻规则落位 |
| V-05 | PASS：`npm run test -- src/markdownTable.test.ts src/MarkdownWysiwygTableEditor.test.tsx src/App.test.tsx` 退出 0，3 files / 260 tests，`/private/tmp/textora-t02-05-v05.log` |
| 完整前端回归 | PASS：`npm run check`（含 typecheck）退出 0，30 files / 720 tests，`/private/tmp/textora-t02-05-check.log` |
| V-Q | PASS：`npm run typecheck`、`npm run build`（含 typecheck）退出 0，build 仅既有 chunk 体积提示，`/private/tmp/textora-t02-05-build.log`。`git diff --check` 与 `git diff --cached --check` 退出 0；未跟踪新文件另行检查无行尾空白且以换行结尾 |
| WebKit 定向 | PASS：组件 bundle + App.css 独立宿主，`swift -module-cache-path /tmp/textora-t02-05-qa/swift-cache /tmp/textora-t02-05-qa/columns.swift` 退出 0，末行 `COLUMN ACTIONS PASS`。4 组 1000/720px × 明暗布局（行/列工具栏均可达、无横向溢出）+ 19 相交互：插列前后表头/表体宿主重建身份与焦点、两次插删空列后源码与 initial 逐字节相等、非空列确认（预览含目标内容）/取消/双击单次提交、删列右邻与末列左邻焦点、仅剩一列禁删、NSTextInputClient 未确认中文期间列操作禁用、组合结束后恢复，最终源码含保留 token 且首尾正文不变。日志/代码/截图在 `/tmp/textora-t02-05-qa/` |
| V-07 / V-MAC | NOT_RUN：release bundle、完整安装版平台矩阵由 T02-07 承接；本项为组件级定向宿主，非安装版手工验收 |
| Rust / IPC / 权限 | N/A：未改对应实现/配置，未引入运行时依赖 |

过程偏差：初版 `<thead key={headerRevision}>` 与 `<tbody key={structureRevision}>` 初始值同为 0，产生同级重复 key 致 React 复制 thead（App 测试抓到 3 个 th）；改为 `head:N`/`body:N` 前缀后全部通过。首版 WebKit 脚本在同一段 evaluateJavaScript 内触发删除又立即查询确认按钮，先于 React 提交状态而误报失败；拆相后通过，未改产品行为。测试首版把对齐插入期望写成 `""`、交错用例引用了仅表头态才有的按钮文案、App 用例预期保留了错误的列，均为测试修正。

## 自检与遗留

- 核对范围：TASK/SPEC FR-4、BR-3/5/6/7/8、父 C-1/C-4、04 RESULT 接口；确认/焦点/组合保护全部复用 04 机制，未新建第二组确认状态。
- 已知边界：列操作会把当前表格体规范化为标准管道格式（契约允许）；若某 cell token 无法在规范格式下无损重扫（理论上不可达，token 本身可重解析），命令返回 null，视图提示改用源码模式。对齐命令、拖拽/合并/列宽、新建表格不在本项范围。
- 对后续影响：T02-06 对齐命令可复用 `submit` 与确认机制；父表 V-05 证据由本 RESULT 承接；07 组合回归需覆盖行列交错与表头宿主重建路径。
- 最终无待修可执行问题，无需生成修复说明。

## Codex Review / 完成确认

2026-11-02：Codex 完整 Review 通过，05-AC-1～3 确认完成，无待修可执行问题，无需生成修复说明。

- 范围：TASK r1、SPEC FR-4/BR-3/5/6/7/8、父 C-1～4、04 RESULT；检查列命令纯函数、行列共用提交/确认机制、Editor/App 会话门禁、样式和相关测试。工作区包含多个前序任务未提交差异，本次仅确认 T02-05 增量及必要调用链，不表示整个工作区均获 Review。
- 核对：重扫原表格而非信任旧模型；整数索引及最后列保护；header/rows/alignments 同位置 splice；旧 token 无二次编码；规范化仅覆盖当前表格，候选全范围/逐 cell/对齐复核；非空判定包含表头；单一 pending/epoch 与重复提交保护；外部更新/锁定/组合输入取消或拒绝；列操作重建 thead/tbody 宿主，受控源码确认后才聚焦右邻或左邻，旧输入宿主卸载后不能提交。
- 独立复验 PASS：项目根运行 `npm run test -- src/markdownTable.test.ts src/MarkdownWysiwygTableEditor.test.tsx src/App.test.tsx`，退出 0，3 files / 260 tests。列操作重构了共用行提交路径，本次复跑同时核查行回归及 App 接线。`git diff --check`、`git diff --cached --check` 退出 0。
- 证据复用：读取本 RESULT 引用的 check/build 日志（720 tests、typecheck/build 成功）及 WebKit 宿主源码/日志，并查看 720px 暗色确认截图；相关实现文件修改时间早于最终证据。未重复执行全套检查、构建或原生宿主；原生证据仅代表组件宿主，未扩称安装版完整验收。
- 边界：V-07/V-MAC 的完整 release 与组合平台矩阵继续由 T02-07 承接，父模块尚未完成。允许 T02-06 准入，本次不启动其实现。
