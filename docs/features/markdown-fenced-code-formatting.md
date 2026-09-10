# Markdown fenced code block 通用格式化

> 状态：已完成（2026-09-10）

## 背景与目标

Textora 已能在 Markdown 源码视图中显式格式化光标所在的闭合 `json` fenced code block，但入口固定为 `Format JSON`，其他常见代码块仍需复制到外部工具处理。

本功能把入口统一为 `Format`：用户点击后，应用根据当前闭合 fenced code block 的语言标记选择本地格式化器，只修改该代码块内容。首期纳入 JSON、JavaScript、TypeScript、YAML、SQL 与 Shell；Java 与 Python 因无可接受的浏览器本地方案移出首期（理由见「依赖取舍与依据」）。

## 首期语言、别名与格式化器

语言标记取 info string 首个 token，按现有 `infoTokenOf` 规则小写归一化，再查下表别名映射；未命中视为「不支持的语言」。

| 语言 | 格式化器 | 别名（info 首 token，统一小写） |
| --- | --- | --- |
| JSON | 现有自写 `JSON.parse` + `JSON.stringify(value, null, 2)` + 末尾换行 | `json` |
| JavaScript | prettier standalone（babel 解析器） | `js`、`javascript`、`jsx`、`mjs`、`cjs`、`node` |
| TypeScript | prettier standalone（typescript 解析器） | `ts`、`typescript`、`tsx` |
| YAML | prettier standalone（yaml 解析器） | `yaml`、`yml` |
| SQL | sql-formatter | `sql`（StandardSQL）；方言别名 `mysql`、`mariadb`→mysql，`postgres`、`postgresql`、`psql`→postgresql，`sqlite`→sqlite，`tsql`、`transactsql`→transactsql，`bigquery`→bigquery |
| Shell | `@wasm-fmt/shfmt`（shfmt 的 WASM 构建） | `sh`、`bash`、`zsh`、`shell`、`shellscript` |

- SQL 方言别名直接映射到 sql-formatter 的 `language` 选项；无方言的 `sql` 使用 StandardSQL。
- Shell 各别名统一按 bash 变体解析（bash 为 POSIX 超集，覆盖绝大多数 fence 内容）；zsh 专有语法解析失败时按统一失败语义处理。
- `jsonc`、`console`、`terminal` 等继续不支持，保持现有「未知语言」语义。

## 固定输出风格

不提供用户配置；所有选项在代码中显式固定并集中定义，保证同一输入在同一依赖版本下输出确定。

- JSON：沿用现有 2 空格缩进 + 末尾 `\n`，行为不回退。
- JavaScript/TypeScript/YAML（prettier 3.x standalone）：`printWidth: 80`、`tabWidth: 2`、`useTabs: false`、`semi: true`、`singleQuote: false`、`trailingComma: "all"`、`endOfLine: "lf"`；解析器按上表选择，其余选项用 prettier 库默认值。
- SQL（sql-formatter）：`tabWidth: 2`、`useTabs: false`、`keywordCase: "preserve"`、`expressionWidth: 50`；`language` 按别名映射，其余选项用库默认值。
- Shell（shfmt）：缩进 2 空格，不启用 `-s` 代码简化，其余格式化开关全部关闭，仅做排版。
- 所有格式化器输出统一使用 `\n` 行尾，与现有 JSON 行为一致；文档的换行元数据与混合换行保存契约不受影响。

## 失败语义与保护

所有失败均为非阻塞 `role="status"` 提示条，且保证零修改：不产生文档变更、脏状态翻转或新的撤销历史。

- 光标在 fence 行、块外或代码块未闭合：沿用现有「光标需位于闭合代码块内」提示。
- 语言未识别或不支持：提示不支持格式化该语言。
- 内容解析失败（各格式化器抛错或拒绝）：提示该语言内容无效、文档未修改。
- 代码块内容超过 1 MiB（按字符数）：提示代码块过大，不执行格式化。首期格式化在主线程同步执行，靠该上限保护基础编辑；Worker 化留作后续可选优化。
- 并发保护：格式化结果应用前重新定位 fence 上下文，若文档或该代码块内容在格式化期间已变化，中止并提示文档已变化、未做修改。
- 格式化器返回非字符串结果视为失败。

## 入口与交互边界

- Markdown 源码工具栏按钮由 `Format JSON` 改为 `Format`，位置、可用性与禁用逻辑不变（`!canEdit || readOnly`）。
- 成功后只替换当前代码块内容，以单个 CodeMirror 事务提交（`userEvent` 沿用 `format.*` 前缀），光标置于格式化后内容区起点，一次撤销恢复完整原内容。
- 事务走现有 `onChange`/脏状态/撤销链路，不绕过任何编辑器契约。
- Preview 打开时沿用同一源码工具栏入口；WYSIWYG 打开时按钮不渲染（现状保持）。
- 只读、加载、保存、冲突、关闭确认、另存为面板期间沿用现有 `editorLocked` 门禁；多标签下仅作用于当前活动编辑器。
- 提示条沿用现有清除时机（切换标签、切换 WYSIWYG、另存为/身份变化）。

## 依赖取舍与依据

首期新增三个运行时依赖，全部纯本地执行，不新增网络请求、外部进程或 Tauri capability：

- **prettier 3.9.x（MIT，活跃维护）**：JavaScript、TypeScript、YAML 各自只有 prettier 能在浏览器内提供成熟、确定且保留注释的格式化；standalone 浏览器用法为官方支持路径。已知浏览器 bundle 体积偏大（prettier/prettier#12144），通过 Vite 动态导入按需代码分割，只在首次格式化对应语言时加载；实现任务必须记录实际测量体积。备选方案否决理由：js-beautify 解析宽松、无 TypeScript 支持、风格过时；Biome WASM 仅覆盖 JS/TS/JSON 且为独立的数 MB WASM 二进制；`yaml` 包直接往返序列化的注释保留与风格标准均不如 prettier。
- **sql-formatter 15.x（MIT，DoltHub 维护，状态健康）**：纯 JS、体积小、支持多种 SQL 方言，是该场景事实标准。
- **@wasm-fmt/shfmt（MIT，周期性维护，另有 prettier-plugin-sh 作后备）**：shfmt 是 shell 的事实标准格式化器，该包提供浏览器可用的 WASM 构建。

移出首期并记录理由（未来可在 backlog 重新评估）：

- **Java**：唯一可行方案 prettier-plugin-java（dist 约 450 KB）没有官方浏览器 standalone 路径，与 prettier/standalone 打包易产生重复 bundling（社区已知痛点），自用收益不足以抵消维护风险。
- **Python**：浏览器内唯一可行路径是 Pyodide 携带完整 CPython 运行时再加载 black（约 10 MB 量级），属于明显过大的运行时；prettier-plugin-python 等纯 JS 方案无人维护。两者均违反「不引入明显过大运行时或维护不可靠库」的实施约束。

## 延续的安全边界

- Markdown 源码仍是唯一权威数据源；opening fence、closing fence、文档其他内容、编码与换行保存契约不得被格式化器改写。
- 只在用户显式点击时格式化；不在输入、粘贴或保存时自动运行。
- 失败不得产生部分编辑、脏状态变化或新的撤销历史。

## 非范围

- Java 与 Python 的 fenced code block 格式化（首期明确移除，见上）。
- 批量格式化多个代码块、整个 Markdown 文档或普通源码文件。
- WYSIWYG 代码块格式化、选区局部格式化、保存时格式化或用户自定义格式化配置。
- LSP、诊断、代码执行、外部进程、云端格式化服务或项目级工具链探测。
- 格式化 Worker 化（记录为后续可选优化，不承诺）。

## 用户流程

1. 用户把光标放入闭合 fenced code block 的内容区。
2. 用户点击 Markdown 源码工具栏的 `Format`。
3. 应用规范化语言标记并按别名表选择本地格式化器。
4. 成功时只替换该代码块内容、光标置于内容区起点；失败时按「失败语义与保护」提示原因且源码不变。
5. 用户可用一次撤销恢复格式化前的完整代码块内容。

## 验收条件

- [x] `Format JSON` 入口迁移为 `Format` 后，现有严格 JSON 格式化行为与测试不回退。
- [x] 每个首期语言及其别名、有效输入、无效输入和确定性输出均有自动化覆盖（别名映射可在单元层覆盖，每语言至少一个代表性格式化快照）。
- [x] 未知/未支持语言、未闭合代码块、fence 行与块外光标均不修改文档，并给出可区分原因。
- [x] 超过 1 MiB 的代码块与「格式化期间文档变化」场景不修改文档并给出提示。
- [x] 格式化只修改当前代码块，保持其他代码块、fence 与 Markdown 内容不变，并可一次撤销。
- [x] Preview、WYSIWYG、只读、忙碌、多标签、保存及关闭保护边界不回退。
- [x] 新依赖的许可证（MIT）与实际 bundle 体积已记录，运行期无网络请求，未新增 Tauri capability。

## 依赖与约束

- 依赖已完成的 `docs/features/markdown-fenced-code-editing.md`、Markdown Preview、多标签会话、保存与关闭保护。
- 复用 `src/markdownFenceContext.ts` 的 fence 上下文识别与 CodeMirror 事务链路，不绕过 `onChange`、脏状态或撤销历史。
- 遵守 `docs/ARCHITECTURE.md` 的源码权威、格式能力可退化与最小权限不变量，以及 D-004、D-007（macOS WebKit 为唯一验收平台，依赖取舍按自用价值排序）。

## 实现拆分

实现按以下顺序拆为独立可验收任务（详见 `docs/tasks/current.md`）：

1. 通用 `Format` 入口与 JSON 迁移（别名注册表、失败原因区分、异步并发保护契约；零新依赖）。
2. prettier 接入 JavaScript、TypeScript 与 YAML。
3. sql-formatter 接入 SQL 与方言别名。
4. shfmt WASM 接入 Shell。
5. 组合回归、release 构建与 macOS 真实应用验收、文档收尾。

## 规划记录

- 2026-09-10 建立草案。当前只确认问题、候选范围与必须延续的安全边界；格式化器、别名、输出风格、首期语言集合及实现拆分仍待规格任务调查和确认，尚未开始实现。
- 2026-09-10 完成规格确认：复核现有 `Format JSON` 链路（工具栏 `src/App.tsx`、`src/Editor.tsx` 的 `formatJsonFencePlan`、`src/markdownFenceContext.ts` 的 fence 上下文与 token 归一化、现有测试）与交互锁边界；调查候选格式化库的浏览器可用性、许可证、维护状态与体积；确定首期语言集合、别名表、固定输出风格、失败语义、1 MiB 上限与并发保护；Java、Python 移出首期并记录理由；实现拆分为 5 个后续任务。本任务未修改任何生产代码。
- 2026-09-10 完成实现与组合回归：通用异步格式化注册表、JSON 迁移、prettier、sql-formatter 与 shfmt WASM 均已接入；`npm run check` 通过（**531 passed / 0 failed**，24 个测试文件），`npm run build` 与 `npm run tauri -- build` 通过，生成 release `Textora.app`。自动化覆盖全部别名、确定性输出、失败零修改、1 MiB 上限、并发变化、一次撤销、Preview/WYSIWYG、只读/忙碌、多标签、保存与关闭保护。
- 2026-09-10 macOS release 真实应用验收确认：实际 `.md` 文件显示通用 `Format`，JSON、JavaScript、TypeScript、YAML、SQL 与 Shell 均产生预期本地格式化输出，JSON 可由一次 `⌘Z` 恢复原文；临时 Untitled 仅选择 Markdown 语法模式时不会开放格式专属入口，符合既有文件身份边界。后续 UI 批量检查因系统同时运行两个相同 bundle ID 的 Textora、Computer Use 无法稳定区分实例而停止；其余失败与模式边界以完整自动化结果验收，未伪报额外人工点击。工作区 release 验收实例已按进程路径单独结束，`/Applications/Textora.app` 原有实例保持运行。
