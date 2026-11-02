# TASK: T02 — WYSIWYG 表格展示与编辑

- **Task ID / 层级**：T02 / 父 TASK；所属父任务不适用。
- **状态 / 修订**：ready（模块计划可推进，不授权跳过子依赖或直接编码）/ r1，2026-10-29。
- **规模 / 风险**：Large / high。编辑器的源码范围、表格转义与会话事件共同影响用户文件完整性，需要父任务集成验收。
- **Review**：每个子任务实施者先自检，Codex 逐项确认；high 子任务完整 Review。全部必要子任务确认后，Codex 才能验收父模块并建立 `RESULT.md`。
- **项目根**：`/Users/mouqing/codexProjects/textora`；以下路径均相对此根。
- **关联 SPEC**：`docs/features/markdown-wysiwyg-tables.md` r1（2026-10-29），FR-1～FR-5、BR-1～BR-8、AC-1～AC-9。用户已确认范围，行为细则为本轮规划约定。
- **SPEC 内容指纹**：SHA-256 `eebd3f699024d96fbdc8f9ef43569fa60825f02d39953d1339d600ccf4c331ab`；范围/规则修订后重新核对受影响子任务。
- **代码基线**：`fe44de8dd25b98e8537eca107b0f35fd530adf4a`；开始规划时 `git status --short` 无输出，工作区干净。本轮只增加 SPEC/TASK 与更新 current，无业务代码变更。
- **前置依赖**：既有 WYSIWYG、内联编辑、Preview、会话与保存能力。无新依赖、IPC 或权限需求。
- **必要上下文**：关联 SPEC；`docs/ARCHITECTURE.md` 架构不变量；`docs/DECISIONS.md` D-004、D-007；下述现有实现与共享契约。子任务只需读取对应条目，不搬运整个会话。

## 目标、非目标与拆分依据

把已有顶层表格从源码岛提升为可视表格，交付单元格文字编辑、增删数据行、增删列、列对齐，保持源码权威和安全回退。非范围严格沿用 SPEC；不建立全新富文本内核，不提供新建表格或全局撤销。

按可观察行为拆分；解析与局部更新是后续切片必需且能纯函数独立验证的契约，展示、文字编辑、行操作、列操作、对齐各自可演示，最后一项只做组合验证和必要小修。实现、组件、样式与对应测试不按技术层机械拆开。依赖顺序固定，避免多人同时改变共享契约；本规划不启动子代理或实施线程。

## 现有代码依据与冲突

- `src/markdownWysiwyg.ts`：`MarkdownWysiwygBlock` 没有 table 类型；`parseMarkdownWysiwygBlocks` 将表格放入 source/table，`collectUntilBlankOrBlock` 是通用收集器。`serializeMarkdownWysiwygBlocks` 对全体块执行序列化再以两个换行拼接。
- `src/MarkdownWysiwygEditor.tsx`：`updateBlock` 每次重新序列化整篇文档。现有规格要求未编辑块不被重写，但此路径会规范化其他块与空白；这是实现与既有契约的差距。T02-01 提供定位/补丁契约，T02-02 接入所有块的局部更新，限制修正范围，不借机改其他块编辑语义。
- `src/MarkdownWysiwygInlineEditor.tsx`：`parseInline("")` 返回零节点，直接复用会导致空单元无编辑入口；`escapeInlineText` 不转义表格管道，code span 不解反斜杠。因此必须有表格上下文 codec 与空值入口，不能在输出末尾盲目全局替换 `|`。
- `src/markdownPreview.ts`：`collectTable` / `splitTableRow` 直接拆管道，`renderTable` 不读取列对齐。T02-02 为受支持子集复用共享扫描/对齐数据，保留旧不规则表格的 Preview 回退。`collectMarkdownBlockMap` 与 HTML 同源，改动需保持一个顶层表格一个锚点和原行区间。
- `src/App.tsx` WYSIWYG 分支直接调用 `setSession`，没有显式表格事件的标签/源码快照保护。T02-03 以当前 tabId 和原始 content 做比较后提交；切换标签时清理编辑器局部选择/组合态；后续确认操作必须复用此保护。

## 已确定的共享技术契约

以下为共享契约；C-1/C-2 已交付的实际 API、偏移与 codec 失败语义见 [T02-01 RESULT](T02-01-source-contract/RESULT.md#交付与后续接口)，后续接入以该接口为准。实施允许局部命名调整，但语义/依赖变更须同步父 TASK 与后续子任务。

### C-1：表格语法与源码 token

新增纯前端 `src/markdownTable.ts`：`scanMarkdownTable(source, startOffset)` 返回可结构化的 `table`、表格候选但不支持的 `unsupported`（携带原文范围）、或 `none`；返回半开字符范围及 nextOffset，消费必须前进。按 SPEC BR-1/2 扫描，表格结束在空行、无有效分隔的正文或其他明确块边界；遇行列不齐保留整个表格候选为源码岛，不截掉多余单元。只读取必要相邻行，不扫描直到文档末尾来猜修复。

`MarkdownTable` 保存 `header`、`rows`、`alignments` 及 `rawSource`、每行/单元/分隔 token 的源码范围与左右空白；单元保存原始内联源码，列数 >= 1，header/rows/alignments 长度相同，数据行可为零。外侧管道与分隔符宽度是源码 token，不混入单元文字。

表格 codec 明确分开“表格层转义”和“内联源码层”：解码/编码 `\|`、反斜杠组合及 code/link 内管道，不重复转义，不误把内容管道当分隔。未编辑 cell 源码原样沿用；修改 cell 仅生成目标 cell token。结构操作先产生候选源码并重新解析验证矩形和可见文字，成功后一次提交；失败不发送 onChange、不修改原文。

### C-2：块定位与局部补丁

在 `src/markdownWysiwyg.ts` 提供 `parseMarkdownWysiwygDocument(source)`，同一遍块扫描返回 `{blocks, ranges}`，range 为原始输入 UTF-16 半开字符区间 `[from,to)`，不包含块间分隔空白与最后行分隔符。现有 `parseMarkdownWysiwygBlocks` 作为兼容入口复用同一核心，不做两套块识别规则。识别时可建行索引，但不得丢失原文 offset；同时测试 LF/CRLF。文档会话仍遵守既有换行/编码策略，本层不转换文件元数据。

`replaceWysiwygBlock(source, range, expectedRaw, replacement)` 在范围匹配、原文匹配时返回新 source，否则拒绝。替换只针对该区间；现有单块序列化规则继续用于被编辑的非表格块。`serializeMarkdownWysiwygBlocks` 保留兼容 API，但主界面更新不再经过全篇重建。

表格事件使用所在块的 range 与快照，cell 与对齐通过更小 token patch，行操作沿用原行 token，列操作仅规范化表格本体为带外侧管道、单空格 padding、分隔单元至少三个横线的格式；不改变未编辑 cell 的内联源码。不得用 DOM/innerHTML 推导保存内容。

### C-3：表格视图与会话提交

新增 `src/MarkdownWysiwygTableEditor.tsx`，React `<table><thead><tbody>` 与局部滚动容器；cell 的显示复用现有内联节点语义。编辑增量只交回 Markdown 源码，不引入第二份权威文档。表格组件必须在 T02-02 展示阶段即支持 disabled 显示，T02-03 才开启输入。

`App` 事件提交捕获 tabId 与 source 快照，在 functional update 中确认仍为相同活动标签、相同内容且未锁定；不匹配直接拒绝。只读及所有 editorLocked 情况禁止操作；外部源更新重置旧焦点目标/确认状态。非空删除使用表格内局部确认；不引入新的全局模态框架。

空单元始终存在可聚焦编辑宿主。表格专用输入适配器复用内联模型/样式，必要时对 InlineEditor 添加可选上下文接口，不改变其他块默认行为。单元事件提交与 IME 时机、焦点恢复由组件负责；不得以每键重挂载整个编辑器解决快照问题。

### C-4：命令边界

- cell：只改一个 cell，纯文本单行粘贴、管道安全、已有格式保留。
- row：仅数据行插入/删除；插入模板继承当前列数，不复制内容；删除非空先确认，最后数据行可删。
- column：列前/后插入，所有行同步；新列对齐默认；最后一列不可删；非空判定含表头。成功后重建当前表格但不改其他块。
- alignment：仅改目标分隔单元；默认/左/中/右，显示与 Preview 一致。
- 每个结构命令携带明确目标及源码快照；目标按当前表格 range 和行列确定，不持久化 index 为跨编辑身份。越界/过期命令拒绝。成功后聚焦相邻 cell；确认取消和拒绝不触发脏状态。

## 子任务、依赖与状态

| 顺序 / Task | 单一目标 | 依赖 | 规划状态 / 实施状态 | 交付接口 |
| --- | --- | --- | --- | --- |
| [T02-01](T02-01-source-contract/TASK.md) | 安全表格扫描、token 与局部源码更新契约 | 现有代码与 SPEC | ready / 已完成，Codex 确认见 [RESULT](T02-01-source-contract/RESULT.md) | C-1/C-2 纯函数与回归 |
| [T02-02](T02-02-display/TASK.md) | 已有表格可视展示及 Preview 一致性 | 01 的 RESULT 与 Codex 确认 | ready / 已完成，Codex 确认见 [RESULT](T02-02-display/RESULT.md) | table block、局部更新接线、只读表格组件 |
| [T02-03](T02-03-cell-editing/TASK.md) | 单元格文字编辑并安全进入会话/保存链路 | 02 确认 | ready / 已完成，Codex 确认见 [RESULT](T02-03-cell-editing/RESULT.md) | C-3 输入与快照门禁 |
| [T02-04](T02-04-row-editing/TASK.md) | 增删数据行 | 03 确认 | ready / 已完成，Codex 确认见 [RESULT](T02-04-row-editing/RESULT.md) | C-4 行命令与确认 |
| [T02-05](T02-05-column-editing/TASK.md) | 增删列 | 04 确认 | ready / 已完成，Codex 完整 Review 通过（[RESULT](T02-05-column-editing/RESULT.md)） | C-4 列命令 |
| [T02-06](T02-06-alignment/TASK.md) | 修改列对齐 | 05 确认 | ready / 已完成，P2 已关闭且 Codex 复审通过（[RESULT](T02-06-alignment/RESULT.md)） | C-4 对齐命令 |
| [T02-07](T02-07-integration/TASK.md) | 组合回归、真实平台验收与文档收尾 | 01～06 全部确认 | ready / 已完成，Codex 确认见 [RESULT](T02-07-integration/RESULT.md) | 模块验收证据 |

子任务实施状态另由 `docs/tasks/current.md` 维护，最多一个进行中。依赖完成并确认后，由 Codex 将下一项规划状态改为 ready，并替换 current 的近期待办；不得因为父 ready 自动开工。

## 验收与验证矩阵

所有命令在项目根执行；以下均为规划，NOT_RUN，不能使用上一轮的 24 项通过代替新功能验证。

| 验证 ID / SPEC | 内容、命令或操作 | 负责人 / 通过标准 |
| --- | --- | --- |
| V-01 / AC-6/7 | `npm run test -- src/markdownTable.test.ts src/markdownWysiwyg.test.ts`（前者待新增），扫描/codec/token 补丁、无操作原文相等、消费前进、CRLF/相邻正文/多表、旧块定位 | 01；全部通过且异常不丢原文 |
| V-02 / AC-1/6/7 | `npm run test -- src/markdownTable.test.ts src/markdownWysiwyg.test.ts src/MarkdownWysiwygEditor.test.tsx src/MarkdownWysiwygTableEditor.test.tsx src/markdownPreview.test.ts src/markdownBlockMap.test.ts`（表格组件测试待新增），真实 table 语义、安全输出、Preview 转义/对齐、顶层锚点/行区间，编辑其他块保留表格 | 02；受支持子集一致，旧回退未变 |
| V-03 / AC-2/6/8 | `npm run test -- src/markdownTable.test.ts src/MarkdownWysiwygTableEditor.test.tsx src/MarkdownWysiwygTableCellEditor.test.tsx src/MarkdownWysiwygEditor.test.tsx src/MarkdownWysiwygInlineEditor.test.tsx src/App.test.tsx`，cell 输入/空值/IME/粘贴/转义、模式/标签、保存与迟到快照 | 03；有效单次回写、不串写、锁定拒绝 |
| V-04 / AC-3/6/8 | `npm run test -- src/markdownTable.test.ts src/MarkdownWysiwygTableEditor.test.tsx src/App.test.tsx`，行命令及取消、确认期间锁定/换标签/更新/连续动作 | 04；只改目标行且焦点合理 |
| V-05 / AC-4/6/8 | 同 V-04 命令，新增列矩形/对齐、删除确认与最后列保护 | 05；剩余内容逐字符保留，表格外不变 |
| V-06 / AC-5/6 | `npm run test -- src/markdownTable.test.ts src/MarkdownWysiwygTableEditor.test.tsx src/markdownPreview.test.ts src/markdownBlockMap.test.ts src/App.test.tsx`，四种对齐与范围 diff | 06；只改目标分隔单元 |
| V-Q / 各切片 | 每项实现完成前 `npm run typecheck`、`npm run build`、`git diff --check`、`git diff --cached --check`，审查 staged/unstaged/新文件 | 01～07 各自；退出 0，构建成功；只看产物大小提示不能作为失败或通过替代 |
| V-07 / AC-1～9 | `npm run check`、`npm run build`、`npm run tauri -- build --bundles app`；交错 cell→row→column→alignment→切模式→保存重开，旧功能回归 | 07；全部必要自动化/构建成功 |
| V-MAC / AC-1～9 | macOS release WebKit：明暗/720px/宽表/长 code 路径；鼠标/Tab/Shift+Tab；中文组合确认、文字原生撤销；增删与取消；最后行列；所有锁定；双标签；保存重开；Preview/同步滚动；HTML/链接不执行、不导航 | 07 必测；逐项证据与使用的 bundle/源码版本相匹配，缺一为 partial |

### 阶段、复用与门禁

项目无 Android 分级；使用纯函数、React/App 自动化、前端构建与真实 macOS WebKit 四类证据。每个实现子任务需执行自己的 V-0n 和 V-Q；涉及输入法/焦点/布局的不确定性应在该切片用真实 WebKit 提前定向验证，不得把已知失败拖到 07。完整 release 平台矩阵由 07 明确承接，不要求每个切片全量打包验收。

上游通过的证据只有在源码、测试和工具链未被相关后续改动影响时可复用；07 的全套检查与真实 release 门禁不可由单测替代。只改前端，无 Rust 模块变化时不要求重复 Rust 全套单测；若范围意外扩到 Rust，先重新规划。所有 RESULT 记录命令、工作目录、退出码、计数、实际手动步骤、源码基线和 bundle 路径/指纹；没有执行的填 NOT_RUN 及承接任务，不标通过。

## 实施约束与 RESULT

进入任一子任务前先完成 current 的 `待开始 → 进行中`，记录日期/真实进度并确认唯一进行中；本次规划不做该转换。依赖完成必须有同目录 `RESULT.md` 和 Codex 确认；high 子任务记录完整 Review，问题未修正不释放依赖。不得预生成 complete RESULT。

子 RESULT 对各自验收 ID 给出 PASS/FAIL/NOT_RUN/N/A 及证据、实际文件、偏差、失败/复验、残余风险与下一任务影响。父 RESULT 只能在全部子任务确认及 V-07/V-MAC 通过后写 complete；任务完成时 current 最近完成最多三条。实施不得自动 commit/push/安装覆盖 `/Applications` 或发布。

## 未决项

无阻塞需求/技术缺口。规划采用保守的矩形顶层表格子集、非空删除就地确认、最后列禁删；若未来要求不规则行、全局撤销、新建表格或表格内硬换行，另立规格，不由实施者顺带加入。

## 本轮规划验证记录（2026-10-29）

仅检查规划文档：本地 Markdown 链接、7 个子任务的字段/依赖状态、验收 ID、current 无进行中且仅一项待办、最近完成恰为三项、所有新增文档尾换行与行尾空白检查通过。`git diff --check` 与 `git diff --cached --check` 退出 0；未跟踪文档另用文件读取检查，因为普通 diff 不包含它们。

未运行实现性测试、前端/原生构建或 macOS 验收（NOT_RUN：本轮纯规划且未修改业务代码）。颗粒度复核：各子任务一个主要目标，依赖无环，只有 01 ready；07 不包含未实现主要行为，无需继续拆分。high 子任务完整 Review 与父模块验收责任已指定。
