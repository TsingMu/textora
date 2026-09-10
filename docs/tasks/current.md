# 当前任务

个人项目同时最多一个任务处于进行中。此文件只保留已承诺、可执行的近期工作，不保存候选想法；“最近完成”按完成时间倒序最多保留 3 个任务，旧记录由 Git 历史承载。

## 进行中

（无）

## 已承诺待办

### 确认 Markdown fenced code block 通用格式化规格

- **状态**：待开始
- **Feature Spec**：`docs/features/markdown-fenced-code-formatting.md`
- **目标**：把现有 `Format JSON` 扩展候选整理为可实施、可分阶段验收的通用 `Format` 规格，确定首期语言集合、别名、固定输出风格、本地格式化器与失败保护。
- **范围**：复核现有 fence 上下文、Editor 命令、工具栏与撤销链路；调查 JSON、JavaScript、TypeScript、YAML、SQL、Java、Python 与 Shell 的浏览器内本地格式化方案；评估依赖体积、许可证、macOS WebKit 兼容性和异常/性能边界；确认 Preview/WYSIWYG、只读/忙碌、多标签与保存边界；把实现拆为可独立交付的后续任务。
- **非范围**：不修改生产代码、实现性测试、依赖、构建配置或 Tauri capability；不承诺所有候选语言必须同批实现；不执行 release 构建或真实应用功能验收。
- **依赖**：已完成的 Markdown fenced code block 编辑辅助及其 `Format JSON` 能力；开始前先收口当前尚未提交的中文 IME 修复工作树，避免把两个主题混入同一提交。
- **拆分检查**：本任务只交付规格与实现拆分，不交付格式化用户行为；各语言实现、组合回归、release 构建和 macOS 真实应用验收将在规格确认后按依赖与可观察结果分别进入 `current.md`。
- **实施要点**：优先复用纯浏览器、本地且确定性的库；若某语言只能依赖外部进程、远程服务、明显过大的运行时或维护状态不可靠的库，应从首期移除并记录理由；明确旧 `Format JSON` 迁移兼容与可回退路径。
- **完成标准**：Feature Spec 达到“已确认”，不存在阻止首个实现切片的开放问题；每个首期语言都有明确别名、格式化器、输出规则和失败语义；依赖取舍有可复核依据；后续任务满足 `docs/tasks/TEMPLATE.md` 的颗粒度规则并写入 `current.md`；本任务只改规划文档，运行 `git diff --check`。

## 最近完成

### 部署中文输入法组合文本修复

- **状态**：已完成
- **开始日期**：2026-08-24
- **完成日期**：2026-08-24
- **Feature Spec**：`docs/features/editor-column-ruler-and-cursor-position.md`
- **目标**：把已完成的中文 IME 预编辑折行修复构建为 release `Textora.app`，安全部署到 `/Applications/Textora.app` 并确认可启动。
- **范围**：执行 Tauri release 构建；核对 bundle 标识与可执行文件；完成本地 ad-hoc 签名和严格校验；替换现有 `/Applications/Textora.app`，启动部署版本并确认进程存在。
- **非范围**：不再修改编辑器行为、测试、依赖、Tauri capability、系统输入法设置或用户文档。
- **依赖**：已完成的「修复中文输入法组合文本被宽字符单元格折行」及其自动化与前端构建验证。
- **拆分检查**：本任务只负责一个已有修复的 release 产物部署与启动确认，不包含新行为或额外功能验收。
- **完成标准**：`npm run tauri -- build` 成功；生成 bundle 的标识与可执行文件正确；签名严格校验通过；`/Applications/Textora.app` 更新为本次产物并可正常启动；`git diff --check` 通过。
- **结果**：release `Textora.app` 已部署到 `/Applications/Textora.app` 并启动。安装版本 `CFBundleIdentifier=com.tsingmu.textora`、`CFBundleExecutable=textora`；安装前后可执行文件 SHA-256 一致。原安装版本保留在 `/private/tmp/Textora.app.codex-deploy-backup` 作为临时回滚副本，未做不可恢复删除。
- **验证记录**：`npm run tauri -- build` 通过并生成 release bundle；工作区 bundle 经 `codesign --force --deep --sign -` 后，`codesign --verify --deep --strict` 通过；部署后的 `/Applications/Textora.app` 再次通过严格签名校验；源/安装可执行文件 SHA-256 均为 `e2d6e34ac891d817bc613ed104b412e89b38497e6f5741174998d309b63e1451`；`/usr/bin/open -n /Applications/Textora.app` 启动成功，`pgrep -x textora` 返回进程 `51970`；`git diff --check` 通过。

### 修复中文输入法组合文本被宽字符单元格折行

- **状态**：已完成
- **开始日期**：2026-08-24
- **完成日期**：2026-08-24
- **Feature Spec**：`docs/features/editor-column-ruler-and-cursor-position.md`
- **目标**：在 macOS 源码编辑器中使用中文输入法时，拼音预编辑文本保持正常横向排版，同时继续让已提交的中文、全角字符与 emoji 按两个窄字符列宽显示。
- **范围**：调整 CodeMirror 宽字素视觉装饰与 IME 组合态的交互边界；覆盖单个宽字素仍至少占两个窄字符列、WebKit 临时把预编辑文本放入装饰节点时盒子可横向扩展，以及既有静态宽字符显示行为；执行定向前端测试、完整前端检查与构建，并按实际能力验证 macOS 应用。
- **非范围**：不改变 Unicode 显示列算法、列标尺刻度语义、自动换行偏好、Markdown WYSIWYG 输入控件、Rust/Tauri 文件核心或其他输入法功能。
- **依赖**：已完成的编辑器列标尺、光标位置与宽字符双列视觉单元格能力。
- **拆分检查**：本任务只修复一个可观察的 IME 排版回归；宽字符显示、组合态保护和回归测试共同构成同一最小垂直切片，不包含新入口、独立主要行为或其他平台改造。
- **完成标准**：自动化固定宽字符装饰采用 `min-width: 2ch` 且不再设置固定 `width`，既有宽字素标记与普通编辑更新仍通过；`npm run check`、`npm run build` 与 `git diff --check` 通过；可执行时完成 macOS 应用真实输入复验并如实记录。
- **结果**：将宽字素单元格样式从全局 CSS 收进 CodeMirror 主题，并把固定 `width: 2ch` 改为 `min-width: 2ch`。已提交的单个宽字素仍至少占两个窄字符列；若 macOS WebKit 在组合输入期间把原生预编辑文本临时放入该 mark，盒子可随内容横向扩展，不再把拼音锁在两字符宽度内折行。未监听或重派发 composition 事件，未修改文档、选择、撤销或保存链路。
- **验证记录**：定向 `npm run test -- Editor.test.tsx -t "wraps wide grapheme clusters"` 通过（1 passed）；`npm run check` 通过（**513 passed / 0 failed**，24 个测试文件）；`npm run build` 通过；`./script/build_and_run.sh --verify` 成功构建并启动 Tauri dev 应用，修复样式已在真实 macOS WebKit 实例加载；Computer Use 可输入并显示 ASCII，但该通道不能切换系统全局输入源且会过滤直接发送的非 ASCII 文本，因此未伪报中文候选窗真实复验通过；临时测试标签已不保存关闭，未修改用户文件；`git diff --check` 通过。

### 语法模式集成验收与文档收尾

- **状态**：已完成
- **开始日期**：2026-08-21
- **完成日期**：2026-08-21
- **Feature Spec**：`docs/features/unsaved-document-language-mode.md`
- **目标**：在 release `Textora.app` 中确认原生语法菜单、标签隔离与首次保存建议的完整组合行为，并完成该 Feature 的验证和文档收尾。
- **范围**：运行前后端完整自动化、格式检查、前端构建与 Tauri release 构建；在 macOS 真实应用中验收 `View > Syntax` 的可用/禁用与单选同步、多个 Untitled 标签隔离、Markdown/Mermaid 专属入口边界、带编号建议名、用户改名、取消/失败保留及成功后实际路径识别；按实际结果更新 Feature Spec、README、backlog 与当前任务；只处理验收阻塞所需的小修。
- **非范围**：不新增语法模式、后缀规则、格式专属能力或其他主要用户行为。
- **依赖**：已完成的临时语法模式/原生菜单、首次保存建议文件名与审查修复切片。
- **拆分检查**：本任务只负责已完成切片的组合回归、release/真实平台确认、必要小修和文档状态翻转，没有新增主要用户行为。
- **完成标准**：Feature Spec 验收条件全部有真实结果；完整自动化、前后端构建、release 构建、严格 bundle 校验及 macOS 真实应用组合验收通过；Feature Spec、README、backlog 和 `current.md` 同步。
- **结果**：完整回归暴露 `Editor.test.ts` 的 EOF opening fence 用例把 CodeMirror 增量解析调度当作产品契约，造成偶发 `null`；保留相邻用例对强制完成后的语法树路径覆盖，将该用例收窄为真实用户行为（树未追上时按生产契约回退文本扫描，仍应立即自动闭合），未修改生产逻辑。release `Textora.app` 成功生成，并在工作区内完成本地 ad-hoc bundle 签名与严格校验。Computer Use 真实应用确认已保存/锁定状态菜单禁用、Untitled 默认与 Java/SQL 标签隔离、Markdown/Mermaid 专属入口边界、`Untitled.java`/`Untitled 2.sql` 建议、取消保留、用户改名后按实际 `.md` 路径识别、后续 Save As 使用实际文件名，以及临时模式不触发干净标签关闭确认；验收临时文件已清理。
- **验证记录**：定向 EOF 自动闭合用例通过；`npm run check` 通过（**513 passed / 0 failed**，24 个测试文件）；`npm run build` 通过；`cargo fmt --manifest-path src-tauri/Cargo.toml --check` 通过；`cargo test --manifest-path src-tauri/Cargo.toml` 通过（**167 passed / 0 failed**）；`npm run tauri -- build` 通过；生成的 `src-tauri/target/release/bundle/macos/Textora.app` 经 `codesign --force --deep --sign -` 后，`codesign --verify --deep --strict` 通过；Computer Use 完成 release 真实应用组合验收；最终 `git diff --check` 通过。
