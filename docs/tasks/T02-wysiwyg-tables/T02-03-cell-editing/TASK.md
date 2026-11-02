# TASK: T02-03 — 编辑表格单元格文字并安全回写会话

- **Task ID / 层级 / 所属父任务**：T02-03 / 子 TASK / [T02](../TASK.md)。
- **状态 / 修订**：ready（T02-02 已完成并获 Codex 确认） / r1（2026-10-29）；2026-11-02 实施与确认见同目录 RESULT。
- **规模 / 风险**：Medium / high；输入法/转义及标签切换迟到事件可能写坏或串写用户内容。
- **Review**：实施者自检后由 Codex 完整代码 Review；确认结果追加同目录 RESULT。完整审查 codec 最小转义、事件提交时机、空节点、受控输入光标、tabId/content/locked 竞态；与原有其他块编辑回归对照。
- **项目根**：`/Users/mouqing/codexProjects/textora`；文件路径相对此根。
- **关联 SPEC**：`docs/features/markdown-wysiwyg-tables.md` r1（2026-10-29）；覆盖 FR-2、BR-2/3/4/7/8、AC-2/6/8。
- **SPEC 内容指纹**：SHA-256 `eebd3f699024d96fbdc8f9ef43569fa60825f02d39953d1339d600ccf4c331ab`；范围/规则修订后重新核对受影响子任务。
- **代码基线**：`fe44de8dd25b98e8537eca107b0f35fd530adf4a`；规划开始时工作区干净。本轮只新增规划文档和 current 条目；实施前重新核对 HEAD/diff 及前置 RESULT，不覆盖他人改动。
- **前置依赖**：`docs/tasks/T02-wysiwyg-tables/T02-02-display/RESULT.md` complete 且 Codex 确认通过。前置结果未确认时不得启动，Codex 确认后再将本 TASK 改为 ready。
- **必要上下文**：SPEC FR-2、BR-2/3/4/7/8；父 C-1～C-3；02 RESULT；MarkdownWysiwygInlineEditor.tsx 的 onInput/composition/paste/空节点；App.tsx WYSIWYG 提交与锁定来源；`docs/ARCHITECTURE.md` 的源码权威与格式失败退化约束。无需读取其他子任务全文。

## 目标与非目标

用户可在已有表格任意表头/数据单元修改文字，输入安全进入源码、脏状态和保存链路；空单元、IME 与特殊字符可用，不串写其他标签。

非目标：不新增行列及对齐按钮、内联格式命令、文档级撤销、链接目标编辑或矩阵粘贴。

粒度依据：本项只交付上述一个契约或用户行为，包含必要实现、测试与自检，原则上可在一次聚焦实施会话稳定交付。完整回归和平台矩阵由 07 承接，不混入本项主要实现；07 本身不承担未实现主要行为。

## 准入补充（2026-11-02）

前置 02 RESULT complete 且 Codex 完整自审确认。实际表格块为 `{type: "table", table: MarkdownTable}`，只读组件接收 `{table, disabled?}`，后续在其上增加输入与快照回调。主编辑器已按原始 ranges 做单块局部替换，不能退回全篇序列化；cell 应使用 01 的更小 token patch。`inlineNodeVisibleText` 已提取至内联模型，五类格式/表格层解码已对齐；Preview 继续显示 URL/图片占位。App 尚未增加 C-3 最新 tab/source/locked 门禁，本项必须补齐。HEAD 未变，工作区含 01/02、有序列表与 T03 导出未提交差异，全部保护。此准入仅解除依赖，不自动启动实现。

## 实施选择补充

单元格适配器新增 `src/MarkdownWysiwygTableCellEditor.tsx`，复用既有内联节点/codec/样式，使用原生 textarea 承载每个已有片段，以保持原生 IME/选区/文字 undo；其他块默认编辑器不变。新增适配器测试纳入 V-03；无新增依赖或需求扩展。实际提交与失败接口仅见 RESULT。

## 已确定技术方案与文件

必须遵守父 TASK 的共享契约；本项具体实现顺序见下。输入是当前 Markdown 源码、表格范围/模型和必要交互目标，输出为经过校验的 Markdown 文本或保持原文的失败结果，不能把 DOM 当保存数据。

| 路径 / 符号 | 计划作用 |
| --- | --- |
| `src/MarkdownWysiwygTableEditor.tsx` | cell 编辑宿主、定位与纯文本单行输入 |
| `src/MarkdownWysiwygInlineEditor.tsx / src/markdownWysiwygInline.ts（仅必要时）` | 可选 table 上下文/空值入口与 codec 适配，保留非表格默认语义 |
| `src/MarkdownWysiwygEditor.tsx` | 单 cell token patch 与快照传递 |
| `src/App.tsx` | 活动 tabId、source 快照与锁定门禁；清理跨标签局部状态 |
| `src/markdownTable.test.ts、src/MarkdownWysiwygTableEditor.test.tsx、src/MarkdownWysiwygEditor.test.tsx、src/MarkdownWysiwygInlineEditor.test.tsx、src/App.test.tsx` | cell 文字、原文保护、会话与迟到事件回归 |

## 实施步骤

1. 核对适用 AGENTS、SPEC、前置 RESULT/Review 与本 TASK 修订；先在 `docs/tasks/current.md` 将本任务设为唯一“进行中”，填写开始日期和真实进度并保存，然后才修改任何实现产物。
2. 建立单元可编辑宿主，复用已有内联片段显示/编辑但补空值入口；删除格式片段至空时保留可聚焦位置。输入回调先过表格 codec，不能先转义整 cell 再叠加内联转义。
3. 处理 Enter/beforeinput、composition 和纯文本粘贴：IME 确认不被阻止，组合期间不按不完整源码重挂载控件；粘贴 CR/LF/Tab 按 SPEC 归一，不扩行列。Tab/Shift+Tab 保留片段→相邻可编辑项的自然顺序。
4. 保存一次目标 cell 更改，核对表格形状与可见文字后替换目标 token；无改变不触发 onChange。空白/链接目标/其他 cell 与块必须保持。
5. App 捕获 tabId/content 并以最新会话校验，拒绝过期/非活动/锁定回调；切标签可重置局部编辑器身份，正常逐键输入不重挂载。测外部内容更新和迟到组合/输入事件。
6. 补 App 级切模式→编辑→保存（mock IPC 载荷）与锁定回归；真实中文组合、选区和原生文字撤销在可用 WebKit 定向验证，完整 release 矩阵由 07 承接。

测试不只手工调用新回调：组件发真实 input/beforeinput/paste/composition 事件，App 验证会话与保存请求。jsdom 无法证明 IME/光标/撤销正确，RESULT 分开记录自动化与 WebKit 证据；若发现相关真实失败必须在当前切片修复。

## 验收与验证

| 编号 | SPEC | 可观察结果 | 验证 ID |
| --- | --- | --- | --- |
| 03-AC-1 | AC-2 | 普通/格式/空单元可编辑，删空可再输入，IME/Enter/粘贴/特殊字符不改变列数且格式可恢复 | V-03 |
| 03-AC-2 | AC-6 | cell 更新仅改目标 token，保存写 Markdown，源码/Preview 内容一致，不引入 DOM | V-03 |
| 03-AC-3 | AC-8 | 锁定禁止输入，标签或源码变化后的旧回调被拒绝，不污染新文档/脏状态 | V-03 |

### 当前完成前必测项

- 在项目根执行父 TASK 验证矩阵的 **V-03、V-Q**；各 ID 在父矩阵给出了完整命令、测试文件与预期，不得替换为仅编译或删测试。新测试文件必须实际新增后再执行；命令均为 NOT_RUN（规划），不表示已经验证。
- 验证选择依据：纯函数契约用源码/输出差异测试；视图和会话用 React/App 行为测试；每项实施执行 typecheck、前端 build 与 diff 检查，不在纯规划阶段生成构建产物。
- 影响链：本项文件 → 父契约与对应后续调用方 → 上表 AC；修改共享行为时补跑相关已有测试。若输入法/焦点/布局有不确定性，应在本切片提前用 macOS WebKit 定向复现，不把已知问题推给最终验收。

### 模块集成或最终验收项

父 `TASK.md` 的 V-07 / V-MAC 由 `../T02-07-integration/TASK.md` 的 07-AC-1～3 承接，在 01～06 全部完成并获 Codex 确认后执行；覆盖完整前端回归、release bundle 与 macOS WebKit 明暗/窄窗/IME/焦点/保存等矩阵。当前纯函数与组件必要测试不得延后；真实平台发现本项相关失败时立即回到本项修复并补测。

### 证据复用与完成门槛

相关源码、测试、工具链未变化时可复用明确的上游证据，需在 RESULT 给出来源与适用范围；没有可复用的新功能证据时按计划执行。旧功能通过不能替代本项新增断言。必要项失败/缺环境时 RESULT 只能 partial 或 blocked，区分 FAIL 与 NOT_RUN，不得为了完成而降低标准。

## 约束与允许局部选择

不增加运行时依赖、权限、网络/链接导航、Rust 或 IPC；不改变文件保存和编码策略。可自主选择局部函数命名、组件拆分与样式细节，但必须保留共享契约、需求边界及可验证结果。失败不发送覆盖原文的更新；不绕开 current 状态门禁，不自动 commit/push/安装/发布。

## RESULT 交接

同目录新增或更新 `RESULT.md`，记录本 TASK r1、父 T02、实际 HEAD/工作区差异、实现文件、每个验收 ID 与验证 ID 的 PASS/FAIL/NOT_RUN/N/A、执行目录/命令/退出码/计数、真实平台步骤/证据、失败复验、偏差、未测项及承接任务。说明对后续接口和风险的影响，并留 Codex Review/完成确认区。报告可执行问题时附可直接交给其他 LLM 的修复说明：位置、触发、风险、修法、测试和命令。无可执行问题明确无需修复说明。

任务必要验证通过并获 Codex 确认后才释放下一依赖；current 完成时同次清理最近完成至三条以内。父模块验收前不得将父 RESULT 标 complete。

## 未决项

无额外需求缺口；前置依赖状态如上。若必须扩大子集/改核心接口或产品行为，先记录证据和影响并交 Codex 修订规划，不顺手扩大实施范围。
