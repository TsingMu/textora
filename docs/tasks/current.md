# 当前任务

个人项目同时最多一个任务处于进行中。此文件只保留已承诺、可执行的近期工作，不保存候选想法；“最近完成”按完成时间倒序最多保留 3 个任务，旧记录由 Git 历史承载。

## 进行中

（无）

## 已承诺待办

（无）

## 最近完成

### 修复 Markdown 不完整标题解析死循环

- **状态**：已完成
- **开始日期**：2026-10-27
- **完成日期**：2026-10-27
- **Feature Spec**：`docs/features/markdown-split-preview.md`、`docs/features/markdown-wysiwyg-mode.md`；用户明确授权直接修复。
- **目标与范围**：修复 Preview / WYSIWYG 处理 `## `、Tab 等标题输入中间态的零进度循环；不扩展语法范围或改变文件保存流程。
- **结果**：两个解析器内部统一标题解析与块起点规则，段落兜底改为至少消费当前行；新增 20 项回归，覆盖 1–6 级标题、空格/Tab、多行混排、有效标题、块映射、受控 WYSIWYG 编辑与新建文档的 Preview/WYSIWYG 切换和继续编辑。
- **验证记录**：在项目根目录执行，退出码均为 0：定向 `npm run test -- src/markdownPreview.test.ts src/markdownBlockMap.test.ts src/markdownWysiwyg.test.ts src/MarkdownWysiwygEditor.test.tsx src/App.test.tsx`（5 files / 228 tests）；`npm run check`（24 files / 562 tests）；`npm run build`；`git diff --check`、`git diff --cached --check`。将当前解析器打包至临时目录，独立 Node 子进程设置 3 秒超时，预览、块映射和 WYSIWYG 各 168 组输入全部正常返回（含 CRLF），块映射无零长度区间。生产构建只有既有 chunk 体积提示。
- **自检**：核对局部 diff、主线程入口与已有未提交改动，未发现新增可执行问题，无需生成修复说明；保留用户既有修改。
- **后续打包验证**（2026-10-27）：`npm run tauri -- build --bundles app` 通过；修复 linker ad hoc 签名缺少 bundle 资源封装的问题，重新本地签名后 `codesign --verify --deep --strict` 通过。已替换并启动 `/Applications/Textora.app`，安装前后二进制 SHA-256 一致，原生 WebView 可见且会话标签恢复。按用户要求清理 target、dist、Vite 缓存与本轮诊断/旧包临时产物。NOT_RUN：针对死循环场景的 macOS 原生手工逐键复验；此前模式编辑验证为自动化测试。

### 暗色模式活动标签可辨识（T01）

- **状态**：已完成
- **开始日期**：2026-10-24
- **完成日期**：2026-10-24
- **Feature Spec**：`docs/features/dark-mode-active-tab.md`（已确认 2026-10-24）
- **目标**：macOS 暗色模式下活动标签在静止、悬停、焦点、未保存及交互锁定状态中都能清楚辨认，浅色模式与既有切换、关闭语义保持不变。
- **范围**：`src/App.css` 标签栏浅色/暗色视觉层级；仅当状态来源与编辑内容不一致时才改 `src/App.tsx`（核对后未触发）。
- **非范围**：标签布局与顺序、会话状态模型、文件操作、编辑器/预览主题、用户主题配置。
- **结果**：活动标签新增 2px accent 顶边（明暗共用）与暗色更亮边框，非活动标签暗色下压暗并弱化文字，新增非活动悬停微亮与标签按钮 focus-visible 焦点环；`src/App.tsx`/测试未改动。实施细节见 `docs/tasks/T01-dark-mode-active-tab/`。
- **验证记录**：`npm run check` 通过（24 files / 542 tests）；`npm run build`、`npm run tauri -- build` 通过；重新 ad hoc 签名后 `codesign --verify --deep --strict` 通过；`git diff --check` 与 `--cached` 通过；2026-10-24 用户在 macOS 真实应用目视验收 AC-1～AC-4 全部通过。


### macOS 文件入口集成验收与文档收尾

- **状态**：已完成
- **开始日期**：2026-10-23
- **完成日期**：2026-10-24
- **Feature Spec**：`docs/features/open-files-from-macos.md`
- **目标**：组合验证窗口拖放与 Finder `.md` 打开方式，并完成规格与项目状态收尾。
- **范围**：完整前后端回归、release bundle、Info.plist 检查、macOS 真实拖放与冷/热启动打开验收、必要小修和文档同步。
- **非范围**：新增批量打开、其他文件关联或新的主要行为。
- **结果**：全部验收条件通过。期间发现并修复冷启动 `Opened` 事件同步重建默认窗口导致同名 WebView 崩溃的问题（改为下一事件循环显示窗口）。用户手工完成 Finder 到主窗口真实拖放（AC-1），规格、README 与 current 状态已同步收尾。
- **验证记录**：`npm run check` 通过（24 files / 542 tests）；`cargo test --manifest-path src-tauri/Cargo.toml` 通过（170 tests）；Rust 格式检查通过；release `.app` 构建成功，重新 ad hoc 签名后通过 `codesign --verify --deep --strict`；`Info.plist` 文件关联字段完整；隔离 bundle 的 Finder 冷/热启动打开通过；2026-10-24 用户手工拖放通过 AC-1。
