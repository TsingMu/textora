# RESULT: T02-01 — 安全表格解析与局部源码更新契约

- **状态**：complete；TASK r1，父 T02；2026-11-02。
- **基线与候选**：HEAD `fe44de8dd25b98e8537eca107b0f35fd530adf4a` + 本次未提交差异。开始实施前已有 current 与 T02 规划文档；未提交/推送。用户中途插队的有序列表编号修复位于独立文件及 Editor/App 测试，已验证并保留。
- **本项变更**：新增 `src/markdownTable.ts` / `.test.ts`；修改 `src/markdownWysiwyg.ts` / `.test.ts`。无新依赖、Rust、IPC、组件或权限变更。

## 交付与后续接口

- `scanMarkdownTable(source, startOffset)`：table / unsupported / none；UTF-16 绝对范围，`to` 不含最后行结束符，`nextOffset` 越过该行结束符。header/separator/rows 保留行 source 与 cell 原文/padding/range，alignments 与列数一致。未转义管道总是分列，反斜杠奇偶适用于 code/link；非矩形或过短分隔符的候选整段保留，不吞相邻正文/表格。
- `decodeMarkdownTableCell` / `encodeMarkdownTableCell`：表格层与内联源码层分离；后者接收 table-neutral inline Markdown，返回 string/null。拒绝换行和无法按本层精确往返的“管道前奇数个反斜杠”，不猜修内容；未来输入适配器应传解码后的内联源码，而非把旧 table token 再编码。原始 table token 由 `serializeMarkdownTable` 直接保留。
- `replaceMarkdownTableCell(source, table, rowIndex, columnIndex, inlineSource)`：rowIndex=-1 为表头；仅目标 token 变化。重新解析候选并比较全部 cell/列数/行数/对齐；失败返回 null。清空无外侧管道的边缘 cell 时，在被替换 token 内补必要的外管道（例如 `A|B → ||B`），不改变相邻原文。
- `formatMarkdownTable(header, rows, alignments, newline)`：只供后续显式结构操作；输入为原 table-layer cell token；校验矩形及原文解释，失败 null。不实现行列命令。
- `parseMarkdownWysiwygDocument` 返回同一遍历派生的 blocks/ranges；旧 `parseMarkdownWysiwygBlocks` 继续复用该核心，表格仍是 source/table。原文偏移覆盖 LF/CRLF/CR 与非 BMP 字符，源码岛保留原行结束符；新增范围排除块间空白及末行结束符。
- `replaceWysiwygBlock`：范围/原文匹配的局部 patch，拒绝过期、越界及拆开 CRLF/代理对的边界；`serializeMarkdownWysiwygBlock` 导出原有单块序列化语义。

UI 仍走既有全篇序列化更新路径；本项只提供局部更新契约，T02-02 才接线，因此不宣称主界面的未编辑块保护或表格可视展示已经交付。旧解析入口已经受益于修正后的表格候选边界；Preview 未修改。为避免吞后续正文，表头和数据行须有未转义的管道，单列表至少保留一个外管道；单列分隔行可省略外管道。其他不明确写法保留既有字面/源码编辑表现。

## 验收与验证

所有命令在 `/Users/mouqing/codexProjects/textora` 执行。

| 验收 / 验证 | 实际结果 |
| --- | --- |
| 01-AC-1 / V-01 | PASS：矩形/仅表头/空单元/外侧管道/四种对齐/转义/不支持候选/相邻块测试，无补齐或截断数据 |
| 01-AC-2 / V-01 | PASS：cell 原文局部 diff、表格外与相邻 cell 保留、codec 往返、删空、特殊字符、过期/结构变化拒绝；含生成矩形表的重复修改 |
| 01-AC-3 / V-01 | PASS：全部块类型范围、CRLF/CR、Unicode、相邻表格/正文、未闭合 fence 的既有 code 文本、无进度输入及过期 patch 回归 |
| V-01 | `npm run test -- src/markdownTable.test.ts src/markdownWysiwyg.test.ts` 退出 0，2 files / 55 tests |
| V-Q 与补充回归 | `npm run check`（含 typecheck）退出 0，26 files / 627 tests；`npm run build` 退出 0；仅既有 chunk 体积提示和测试环境 localStorage 实验提示，无失败 |
| 差异检查 | `git diff --check`、`git diff --cached --check` 退出 0；另行读取所有新增 TS/文档检查尾换行/行尾空白及本项文件范围；检查 staged/unstaged 与未跟踪清单，无暂存变更 |
| V-07 / V-MAC | NOT_RUN：模块 UI/结构编辑未交付，按父计划由 T02-07 承接；本项纯函数与既有组件/App 回归不能代替 release WebKit 验收 |

过程偏差：首轮 V-Q 因测试使用 ES2021 `replaceAll` 而失败；已改为现有 ES2020 可用的 split/join，并对最终候选重跑上述检查/构建通过。没有修改编译目标或降低验收。完整日志在本地临时 `/tmp/textora-t02-01-check.log`、`/tmp/textora-t02-01-build.log`，仅供本轮诊断，不作为永久证据归档。

## Codex 完整 Review 与完成确认

2026-11-02，同一 Codex 代理实施后完整自审（未声称独立代理复核）。检查全部生产差异、公共返回/失败契约、扫描消费前进、表格/正文边界、转义奇偶、原始 UTF-16/CRLF 范围、代理对保护、候选重新解析与其他 cell 保留、旧 parser API/未闭合 code 兼容性，以及针对性与全套测试证据。

自检发现并关闭的边界：缺少外侧管道时清空首尾 cell 会把分隔管道误当外管道，现局部补 framing pipe 并增加五个回归；未闭合 code 的末尾换行保持旧模型，新增范围单独排除末行结束符。最终无待修可执行问题，无需生成修复说明。01-AC-1～3 获确认，允许 T02-02 准入；父模块尚未完成。

规格仅更新实施状态，r1 行为范围不变；TASK 的 SPEC 指纹标识最初规划输入。下次细化/实施 T02-02 时，以本接口与实际代码重新核对其上下文，勿继续假设 Preview 的 split 能处理转义管道。
