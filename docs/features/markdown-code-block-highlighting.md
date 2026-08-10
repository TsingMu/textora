# Markdown 预览代码块语法着色

> 状态：已确认（2026-08-10）

## 背景与目标

Textora 已支持 Markdown 源码/预览左右分栏，也已经在编辑器源码区支持常见代码、配置和脚本文件的 CodeMirror 语法高亮。当前 Markdown 预览中的普通 fenced code block 仍以单色代码块显示；当用户在 Markdown 文档中写技术笔记、脚本片段或配置样例时，预览侧不够容易扫读。

本功能目标是在不改变 Markdown 源码权威地位的前提下，为 Markdown 预览中的普通 fenced code block 提供本地语法着色。高亮结果只是预览 DOM 的派生显示：保存仍只保存 Markdown 源码；高亮失败、语言未知或性能不佳时应安全退化为已转义的普通代码块。

## 范围

- 仅作用于 Markdown 预览右侧面板中的 fenced code block。
- 根据 fenced code block 的 info string 识别语言；首版取去除首尾空白后的第一个 token，并大小写不敏感匹配。
- 复用已完成代码语法高亮能力覆盖的语言集合：JavaScript、TypeScript、JSON、HTML、CSS、Rust、Python、Java、Shell、SQL、TOML、YAML、Markdown。
- 支持常见别名，例如 `js`/`javascript`、`ts`/`typescript`、`tsx`、`json`、`html`、`css`、`rs`/`rust`、`py`/`python`、`sh`/`bash`/`shell`、`yml`/`yaml`、`md`/`markdown`。
- 未填写语言、未知语言或高亮适配失败时，继续显示为已转义的普通代码块。
- fenced `mermaid` code block 保持现有图表渲染行为，不改为代码高亮。
- 高亮渲染必须完全本地完成，不请求远程脚本、远程样式、远程主题或任意网络资源。
- 代码内容必须按文本处理并正确转义，不能把代码片段中的 HTML、脚本、事件属性或 URL 当作可执行 DOM 注入。
- 高亮样式使用 Textora 现有预览视觉系统中的本地 CSS，保证亮色界面下可读。

## 非范围

- 编辑器源码区的新增语言支持；源码区继续沿用已完成的代码语法高亮规格。
- Markdown inline code 语法着色；行内代码仍按现有样式显示。
- 复制按钮、行号、折叠、搜索、代码块标题栏、语言徽标或主题切换。
- LSP、补全、诊断、格式化、代码执行、运行结果预览或 Notebook 能力。
- 远程主题、远程字体、远程语法包或插件系统。
- Markdown 所见即所得、导出 PDF/HTML/图片、滚动同步或目录大纲。
- 改变保存格式、编码、换行、冲突保护、关闭保护或 Tauri/Rust 权限。

## 用户流程

1. 用户打开或另存为一个 `.md` / `.markdown` 文件。
2. 用户点击 `Preview` 进入 Markdown 源码与预览左右分栏。
3. Markdown 中带语言标记的普通 fenced code block（例如 <code>```ts</code>、<code>```json</code>、<code>```bash</code>）在预览侧显示为语法着色代码块。
4. 用户继续编辑源码，预览侧随源码派生更新；保存时磁盘内容仍是原始 Markdown 源码。
5. 若某个代码块语言未知、代码不完整或高亮失败，该代码块仍以普通转义代码块显示，不影响其他 Markdown 内容和其他代码块。

## 行为规则与边界情况

- Markdown 源码仍是唯一权威数据源；高亮 HTML 是可重建派生结果，不参与保存。
- info string 只用于选择高亮语言，不作为可执行指令；例如 <code>```ts title="x"</code> 应按 `ts` 识别，后续属性不进入 DOM。
- 语言匹配大小写不敏感；`TS`、`TypeScript`、`typescript` 行为一致。
- unknown、空 info string、带复杂属性但首 token 不认识的代码块，应退化为普通代码块。
- fenced `mermaid` 的优先级高于代码高亮，继续走现有 Mermaid 本地渲染、安全清洗和错误占位契约。
- 普通代码块中的 `<script>`、`<img onerror=...>`、`javascript:` 等内容必须以文本方式展示，不能执行、加载或导航。
- 高亮失败不能让整个 Markdown 预览失败；最多影响当前代码块，并退化为普通代码块。
- 多标签之间的预览派生结果不应串扰；切换标签后，每个 Markdown 标签仍根据自己的源码与预览开关状态显示。
- 50 MiB 文件上限沿用既有打开规则；如果单个代码块高亮明显卡顿，优先对该代码块退化为普通代码块，不阻塞源码编辑、保存或关闭保护。
- 不新增网络、shell、文件系统、远程页面或 Rust/Tauri capability。

## 验收条件

- [ ] Markdown 预览中受支持语言的 fenced code block 显示为语法着色代码块。
- [ ] JavaScript/TypeScript、JSON、HTML/CSS、Rust/Python/Java、Shell/SQL、TOML/YAML、Markdown 至少各有一个自动化覆盖样例或等价映射测试。
- [ ] 未知语言和空语言标记的 fenced code block 仍按普通转义代码块显示。
- [ ] 代码块中的原始 HTML、脚本和危险属性不会作为可执行 DOM 注入。
- [ ] fenced `mermaid` code block 仍渲染为图表，且错误退化行为不回退。
- [ ] Markdown 保存结果仍为源码，不包含高亮 span、样式类或 Mermaid SVG 预览产物。
- [ ] 多标签切换时，高亮预览结果不污染其他 Markdown 标签或非 Markdown 标签。
- [ ] 功能不引入新的网络、shell、文件系统、远程页面或 Rust/Tauri 权限。
- [ ] 自动化测试覆盖语言识别、高亮退化、安全转义、Mermaid 优先级和保存源码不受影响。

## 依赖与约束

- 依赖已完成的代码文本识别与最小语法高亮、Markdown 源码与本地预览左右分栏、Markdown fenced Mermaid 本地渲染。
- 遵守 `docs/ARCHITECTURE.md`：文本文档是编辑与保存的权威数据源，预览是可重建派生数据。
- 遵守最小权限原则：前端不得获得宽泛文件系统、shell、远程页面或任意网络能力。
- 优先复用现有 CodeMirror 语言包与高亮能力；若实现中需要提取适配层，应保持 Markdown 渲染模块与编辑器实例解耦。
- 不为本功能引入重量级远程渲染或外部运行时；如确需新增本地依赖，必须先说明体积、权限和安全影响。

## 决议记录

- 2026-08-10 确认首版范围：Markdown 预览普通 fenced code block 增加本地语法着色；Mermaid fence 继续渲染为图表；未知语言普通显示；不加入复制按钮、行号、主题配置、代码执行或导出能力。

## 实现拆分

Markdown 预览代码块语法着色按以下顺序拆成小切片，实现时优先保留现有 Markdown 预览、Mermaid 渲染、保存和多标签行为。`docs/tasks/current.md` 同一时间只保留下一个待执行切片。

1. **确认 Markdown 预览代码块语法着色规格**（本任务）：确定识别规则、支持语言、非范围、安全边界和验收方式；不修改生产代码。
2. **建立 Markdown 代码块高亮渲染契约并接入预览**：新增或提取本地高亮适配层，把非 Mermaid fenced code block 按 info string 渲染为安全高亮 HTML；未知或失败时退化为普通代码块；补齐 Markdown 渲染与 App 级测试。
3. **Markdown 代码块高亮集成验收与文档收尾**：完整自动化、前端构建、必要的 release 构建和真实 macOS 应用验收；确认保存源码、Mermaid 优先级和权限边界不回退，必要时同步 README。

## 验证记录

暂无实现验证。本规格确认任务仅修改文档，后续实现切片开始前应先在 `docs/tasks/current.md` 中把对应任务切换为“进行中”。
