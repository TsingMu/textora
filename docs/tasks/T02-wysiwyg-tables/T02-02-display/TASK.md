# TASK: T02-02 — 展示已有表格并对齐 Preview 语义

- **Task ID / 层级 / 所属父任务**：T02-02 / 子 TASK / [T02](../TASK.md)。
- **状态 / 修订**：ready（T02-01 已完成并获 Codex 确认） / r1（2026-10-29）；2026-11-02 用户授权实施，执行状态见 current。
- **规模 / 风险**：Medium / high；接入块定位替换会改变既有 WYSIWYG 更新路径，必须核验未编辑源码保护。
- **Review**：实施者自检后由 Codex 完整代码 Review；确认结果追加同目录 RESULT。完整审查所有块更新接线及范围边界；检查 Preview 回退保持、转义层次、对齐输出的安全属性。
- **项目根**：`/Users/mouqing/codexProjects/textora`；文件路径相对此根。
- **关联 SPEC**：`docs/features/markdown-wysiwyg-tables.md` r1（2026-10-29）；覆盖 FR-1、BR-1/2/3/6/7、AC-1/6/7。
- **SPEC 内容指纹**：SHA-256 `eebd3f699024d96fbdc8f9ef43569fa60825f02d39953d1339d600ccf4c331ab`；范围/规则修订后重新核对受影响子任务。
- **代码基线**：`fe44de8dd25b98e8537eca107b0f35fd530adf4a`；规划开始时工作区干净。本轮只新增规划文档和 current 条目；实施前重新核对 HEAD/diff 及前置 RESULT，不覆盖他人改动。
- **前置依赖**：`docs/tasks/T02-wysiwyg-tables/T02-01-source-contract/RESULT.md` complete 且 Codex 确认通过。前置结果未确认时不得启动，Codex 确认后再将本 TASK 改为 ready。
- **必要上下文**：SPEC FR-1、BR-1/2/3/6/7；父 C-1～C-3；01 RESULT/API；markdownPreview.ts 的 collectTable/renderTable、markdownBlockMap.test.ts；MarkdownWysiwygEditor.tsx updateBlock；`docs/ARCHITECTURE.md` 的源码权威与格式失败退化约束。无需读取其他子任务全文。

## 目标与非目标

已有受支持表格在 WYSIWYG 显示为真实表格，Preview 对相同子集识别转义管道和列对齐；编辑已有其他块不再重建整篇源码。此切片表格只展示，文字和结构编辑留后续。

非目标：不开放 cell 输入或结构命令，不扩充内联语法，不更改 Preview 对不规则表格的既有回退，不改通用保存逻辑。

粒度依据：本项只交付上述一个契约或用户行为，包含必要实现、测试与自检，原则上可在一次聚焦实施会话稳定交付。完整回归和平台矩阵由 07 承接，不混入本项主要实现；07 本身不承担未实现主要行为。

## 准入补充（2026-11-02）

前置 `../T02-01-source-contract/RESULT.md` 已 complete 并记录 Codex 完整自审确认。按实际导出的 `parseMarkdownWysiwygDocument`、`replaceWysiwygBlock`、`serializeMarkdownWysiwygBlock` 与 `scanMarkdownTable` 接入；cell 是带原文范围/padding 的对象，header/separator/rows 是行对象。Preview 渲染须先解表格层转义再用原有内联语义；不能再把原 table token 直接当 table-neutral inline source 编码。01 的旧入口仍返回 source/table，本项才接入 table block 与局部更新。2026-11-02 用户授权继续实施本项。HEAD 未变；工作区已有 T02-01、有序列表修复与 T03 导出实现/文档，全部保留；本项不修改导出实现。

## 已确定技术方案与文件

必须遵守父 TASK 的共享契约；本项具体实现顺序见下。输入是当前 Markdown 源码、表格范围/模型和必要交互目标，输出为经过校验的 Markdown 文本或保持原文的失败结果，不能把 DOM 当保存数据。

| 路径 / 符号 | 计划作用 |
| --- | --- |
| `src/markdownWysiwyg.ts` | table block 分支及单块序列化；unsupported 仍 source island |
| `src/MarkdownWysiwygEditor.tsx` | 使用带范围的解析结果与 C-2 更新所有块；接入 table view |
| `src/MarkdownWysiwygTableEditor.tsx（新增）` | 语义化表头/正文/对齐与安全内联只读展示 |
| `src/markdownPreview.ts` | 受支持子集复用 table 扫描/对齐，保留原 fallback；安全内联与顶层 block map |
| `src/App.css` | 明暗表格、长路径软换行、局部横向滚动，样式限制在表格 |
| `src/MarkdownWysiwygTableEditor.test.tsx（新增）及既有 Editor/Preview/block map 测试` | 展示、disabled、源码补丁与预览一致性 |

## 实施步骤

1. 核对适用 AGENTS、SPEC、前置 RESULT/Review 与本 TASK 修订；先在 `docs/tasks/current.md` 将本任务设为唯一“进行中”，填写开始日期和真实进度并保存，然后才修改任何实现产物。
2. 接入 table block：有效表格用 01 的 model，unsupported 保留 source/table；不要把候选不支持当作正常段落拆丢。单块序列化对未编辑 table 返回 rawSource。
3. 主编辑器从 parseMarkdownWysiwygDocument 获得块与范围，updateBlock 只调用 C-2 的 patch；每种原有块仍使用原有单块序列化语义，不能全篇 join。测试非表格编辑不改表格与外围空白。
4. 渲染 table/thead/th/tbody/td，内联显示复用既有 disabled 模式或展示适配器；无 href、无 HTML 注入。长 code 路径不溢出单元，宽表局部滚动；空数据表仍有表头。
5. Preview 对有效共享子集读取相同 cell/align 数据，先解表格层再渲染现有安全内联；不盲目替换旧 fallback。保持一个表格一个顶层锚点，block map 起止行与源码一致。

现有源码岛表格测试应调整为“受支持表格可视展示，不支持表格仍保留”，保留其他源码岛测试，不能通过删掉原文保留断言来消除回归。

## 验收与验证

| 编号 | SPEC | 可观察结果 | 验证 ID |
| --- | --- | --- | --- |
| 02-AC-1 | AC-1 | 表头/正文/四种对齐/空数据表与五类内联样式可见，非法表格原文仍在 | V-02 |
| 02-AC-2 | AC-6 | 切模式不写回；编辑标题/列表/段落/code/source island 只改对应块，未编辑表格和相邻空白逐字符保留 | V-02 |
| 02-AC-3 | AC-1/7 | 受支持转义管道与对齐在两模式一致，Preview 锚点/行范围不回退，HTML/图片/链接安全 | V-02 |

### 当前完成前必测项

- 在项目根执行父 TASK 验证矩阵的 **V-02、V-Q**；各 ID 在父矩阵给出了完整命令、测试文件与预期，不得替换为仅编译或删测试。新测试文件必须实际新增后再执行；命令均为 NOT_RUN（规划），不表示已经验证。
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
