# Mermaid 本地编辑与预览

> 状态：已完成（2026-08-10）

## 背景与目标

Textora 已支持 Markdown 源码编辑与本地预览左右分栏。用户在日常文档中还会使用 Mermaid 描述流程图、时序图、状态图等轻量图表，希望能在本地编辑 Mermaid 源码并查看渲染结果，减少在外部网页或在线工具之间切换。

本功能目标是提供一个最小、安全、可退化的 Mermaid 本地编辑与预览能力：源码仍是唯一保存内容，图表预览只是由源码派生出的本地视图；渲染失败时显示可理解错误，不影响继续编辑和保存源码。

## 范围

- 支持独立 Mermaid 文档（`.mmd` / `.mermaid`）的源码编辑与本地预览。
- Mermaid 预览入口复用 Markdown 的 `Preview` 工具栏开关模式：默认源码编辑，用户手动开启后显示源码/预览左右分栏。
- Mermaid 文件纳入语言识别，状态栏显示 `Mermaid`；未知扩展名仍退化为 `Plain Text`。
- 首版验收覆盖 Mermaid 核心图表：`flowchart` / `graph`、`sequenceDiagram`、`stateDiagram`、`classDiagram` 与 `erDiagram`。
- 渲染在本地完成，不依赖远程页面、CDN、在线 API 或网络访问。
- 渲染失败时保留源码编辑能力，并显示可理解错误。
- 保持保存内容为原始源码，不把 SVG/HTML/图片预览产物写回用户文件。

## 非范围

- Mermaid 图表导出为 PNG/SVG/PDF。
- Mermaid 图表所见即所得编辑、拖拽改图、节点交互编辑。
- 在线模板、远程主题、远程图标或外部资源加载。
- Markdown 所见即所得模式。
- Markdown inline Mermaid、未标记语言的代码块图表化，或 Markdown 所见即所得中的 Mermaid 行为。
- 改变文件编码、换行、保存目标、冲突保护或 Tauri 文件权限。

## 用户流程

1. 用户打开或新建 Mermaid 相关文本，例如 `.mmd` / `.mermaid` 文件。
2. Textora 将文件识别为 `Mermaid`，并在工具栏提供可发现的 `Preview` 开关。
3. 用户编辑源码，预览根据当前源码本地更新。
4. 如果源码语法有误，预览区域显示错误，但源码仍可继续编辑和保存。
5. 用户保存文档时，保存的仍是原始文本源码。

## 行为规则与边界情况

- Mermaid 源码或 Markdown 源码仍是唯一权威数据源；渲染结果是可重建派生视图。
- `.mmd` 与 `.mermaid` 扩展名大小写不敏感，均识别为 `Mermaid`；其他文件名不因内容猜测自动切换为 Mermaid。
- `Preview` 开关状态按标签保存在当前会话内，不写入文档，不作为全局偏好或重启恢复状态。
- Mermaid 预览打开后，源码编辑区与图表预览区左右分栏展示；关闭后恢复单栏源码编辑。
- 源码修改后预览采用短延迟更新，目标 debounce 为 300ms 左右，避免每个输入事件都触发昂贵渲染。
- Mermaid 渲染必须在本地完成；不得请求远程页面、脚本、样式、图片或 API。
- 允许新增 `mermaid` 前端依赖，但它必须被打包进应用本地资源；不得通过 CDN、远程 ESM 或运行时网络加载。
- Mermaid 初始化必须使用非自动扫描模式（例如 `startOnLoad: false`）和最严格可用安全级别（例如 `securityLevel: "strict"` 或等价配置），并禁用或退化任何需要远程资源、任意 HTML、脚本执行或宽松外链的能力。
- 预览容器不得执行用户源码中的任意脚本；渲染产物如包含不安全属性、脚本、事件处理器或外部资源引用，应移除或以错误占位退化。
- 渲染失败时预览区域显示当前错误，不保留误导性的旧图表；源码、脏状态、保存与关闭保护不受影响。
- 渲染错误不得阻止普通输入、撤销/重做、保存、另存为、关闭保护或多标签切换。
- 多标签切换时，预览状态与错误状态应跟随活动标签，不污染其他标签。
- 大文件规则沿用首版 50 MiB 上限；若图表渲染明显卡顿，应优先退化或延迟预览，不影响源码编辑。
- Markdown 文档中的 fenced `mermaid` code block 已在后续 Markdown 预览演进中接入同一本地 Mermaid 安全渲染契约；普通代码块和未标记语言代码块不图表化。

## 验收条件

- [x] `.mmd` / `.mermaid` 文件被识别为 `Mermaid`，状态栏显示 `Mermaid`。
- [x] Mermaid 文档可打开 `Preview` 入口，并在本地显示基础图表。
- [x] 编辑 Mermaid 源码后，预览能根据当前源码更新。
- [x] Mermaid 语法错误显示可理解错误，源码编辑和保存仍可继续。
- [x] 保存后磁盘内容仍为源码文本，不包含预览产物。
- [x] 多标签切换时，Mermaid 预览状态与错误状态互不污染。
- [x] 功能不引入网络、shell、远程页面或宽泛文件系统权限。
- [x] Markdown 预览中的 Mermaid fenced code block 使用同一本地安全渲染契约显示为图表；普通代码块不受影响。
- [x] 自动化测试覆盖预览入口、安全退化、错误显示、源码保存不受预览影响和多标签隔离。
- [x] macOS release 应用真实验收覆盖打开 Mermaid、编辑后预览更新、错误退化、保存源码和关闭保护。

## 依赖与约束

- 依赖已完成的基础文本编辑、多标签会话、保存/另存为、未保存关闭保护、代码语法高亮和 Markdown 本地预览。
- 遵守 `docs/ARCHITECTURE.md`：文本文档是编辑与保存的权威数据源，预览是可重建派生数据。
- 遵守最小权限原则：前端不得获得宽泛文件系统、shell、远程页面或任意网络能力。
- 遵守 D-004 与 D-007：继续使用 Tauri 2、React/TypeScript、CodeMirror 6 与 Rust 技术栈；只要求 macOS 行为验收。

## 决议记录

- 首版只支持独立 `.mmd` / `.mermaid` Mermaid 文档，不渲染 Markdown fenced Mermaid code block。原因是 Markdown 本地预览已确认以安全源码预览为边界，Mermaid 内嵌渲染会同时改变 Markdown 行为和 Mermaid 渲染安全面，应在独立 Mermaid 预览稳定后另行演进。
- Mermaid 纳入 `LanguageMode`，状态栏显示名为 `Mermaid`；识别依据只看路径或展示名的 `.mmd` / `.mermaid` 扩展名，不做内容猜测。
- 首版验收图表类型限定为 Mermaid 核心集：`flowchart` / `graph`、`sequenceDiagram`、`stateDiagram`、`classDiagram` 与 `erDiagram`。其他 Mermaid 语法如果被本地渲染库自然支持可正常显示，但不作为首版完成条件。
- 允许新增 `mermaid` 前端依赖，前提是完全本地打包，初始化为手动渲染和最严格可用安全配置；不得引入远程脚本、样式、图标、图片、API、shell 或新 Tauri 权限。
- 预览入口复用 Markdown 的 `Preview` 开关模式，并按标签保存当前会话状态；不新增全局偏好或重启恢复。
- 渲染更新采用约 300ms debounce。渲染错误显示在预览区，不阻塞源码编辑、保存、关闭保护或多标签切换。

## 实现拆分

Mermaid 本地编辑与预览按以下顺序拆成可连续交付的小切片，实现时优先保留现有编辑、保存和 Markdown 预览行为。`docs/tasks/current.md` 同一时间只保留下一个待执行切片。

1. **确认 Mermaid 本地编辑与预览规格**：确定首版入口、语言识别、支持图表类型、渲染库与安全配置、渲染频率，以及 Markdown fenced code block 是否纳入首版；不修改生产代码。
2. **接入 Mermaid 语言识别与普通文本退化契约**（下一项）：把 `.mmd` / `.mermaid` 纳入 `LanguageMode` 与状态栏展示，覆盖识别测试；不接入渲染库或主界面预览。
3. **建立 Mermaid 本地渲染安全契约**：新增本地渲染适配层与安全退化测试，明确 Mermaid 初始化、安全配置、错误返回和不加载远程资源；不接入主界面。
4. **接入 Mermaid 预览入口与更新**：在 Mermaid 标签工具栏显示 `Preview` 开关和左右分栏，编辑后 debounce 更新，多标签隔离，错误显示不阻塞编辑。
5. **Mermaid 集成验收与文档收尾**：完整自动化、release 构建和 macOS 真实应用验收；规格状态改为已完成，必要时同步 README。

## 验证记录

- 2026-08-10「接入 Mermaid 语言识别与普通文本退化契约」：`npm run check` 通过（typecheck + vitest **170 passed / 0 failed**）；`npm run build` 通过（Vite 大 chunk 体积提示仍为既有语言包提示，不影响本切片）；`git diff --check` 通过。本切片未新增 Mermaid 渲染库、Preview 入口、分栏布局、Rust IPC、Tauri capability、网络、shell 或文件权限，未做 release 构建或真实 macOS 交互验收。
- 2026-08-10「建立 Mermaid 本地渲染安全契约」：新增本地打包的 `mermaid@11.16.1` 前端依赖与 `src/mermaidPreview.ts` 渲染适配层；`npm run test -- mermaidPreview` 通过（**4 passed / 0 failed**）；`npm run check` 通过（typecheck + vitest **174 passed / 0 failed**）；`npm run build` 通过（Vite 大 chunk 体积提示仍为既有语言包提示，不影响本切片）；`npm audit --omit=dev` 通过（生产依赖 **0 vulnerabilities**）；完整 `npm audit` 仍报告 3 个开发依赖链审计项，来源为 `vite -> postcss/nanoid` 与 `jsdom -> undici`，未自动执行 `npm audit fix`；`git diff --check` 通过。本切片未接入 App 主界面、Preview 入口、分栏布局、Markdown fenced code block 渲染、Rust IPC、Tauri capability、网络、shell 或文件权限，未做 release 构建或真实 macOS 交互验收。
- 2026-08-10「接入 Mermaid 预览入口与更新」：在 Mermaid 活动标签显示 `Preview` 开关，开启后进入源码/预览左右分栏；预览结果按标签保存在当前会话内，源码变更后约 300ms debounce 调用 `renderMermaidPreview` 更新，渲染错误在预览区显示且不锁定编辑器。`mermaidPreview.ts` 改为动态导入 `mermaid`，避免 Mermaid 进入初始主入口 bundle；`npm run test -- mermaidPreview App tabSession` 通过（**88 passed / 0 failed**）；`npm run check` 通过（typecheck + vitest **178 passed / 0 failed**）；`npm run build` 通过，主入口 chunk 约 641 kB，Mermaid core 作为按需 chunk 约 623 kB，Vite 大 chunk 提示仍存在但不阻塞本切片；`git diff --check` 通过。本切片未渲染 Markdown fenced Mermaid code block，未新增导出、所见即所得、滚动同步、全局偏好、重启恢复、Rust IPC、Tauri capability、网络、shell 或文件权限，未做 release 构建或真实 macOS 交互验收。
- 2026-08-10「Mermaid 集成验收与文档收尾」：补充 App 自动化回归，覆盖 Mermaid 预览打开时保存仍提交源码文本、不包含 SVG 预览产物；新增 `samples/mermaid-preview-smoke.mmd` 作为人工冒烟验证样例。`npm run check` 通过（typecheck + vitest **179 passed / 0 failed**）；`npm run build` 通过；`npm run tauri -- build` 通过并生成 release `Textora.app`；bundle 检查确认 `CFBundleIdentifier` 为 `com.tsingmu.textora`；capability diff 确认未新增网络、shell、文件系统或 Rust/Tauri 权限；release app 可启动，进程名为 `textora`；`git diff --check` 通过。人工真实 macOS UI 验收已确认通过：打开 `.mmd`/`.mermaid`、状态栏 `Mermaid`、Preview 左右分栏、本地图表渲染、编辑后更新、错误退化、保存源码、多标签隔离、关闭保护，以及 Markdown fenced Mermaid code block 仍不渲染为图表。
- 2026-08-10「在 Markdown 预览中渲染 Mermaid fenced code block」：Markdown 预览中的 fenced `mermaid` code block 已复用 `renderMermaidPreview` 本地安全渲染契约显示为图表，普通代码块保持代码块显示；`npm run check` 通过（typecheck + vitest **184 passed / 0 failed**）；`npm run build` 通过；`git diff --check` 通过。本切片未运行 release 构建或真实 macOS UI 验收。
