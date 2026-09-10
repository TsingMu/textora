# 当前任务

个人项目同时最多一个任务处于进行中。此文件只保留已承诺、可执行的近期工作，不保存候选想法；“最近完成”按完成时间倒序最多保留 3 个任务，旧记录由 Git 历史承载。

## 进行中

（无）

## 已承诺待办

（无）

## 最近完成

### Syntax 专属能力组合回归与发布收尾

- **状态**：已完成
- **开始日期**：2026-09-10
- **完成日期**：2026-09-10
- **Feature Spec**：`docs/features/unsaved-document-language-mode.md`
- **目标**：完成新能力的完整回归、release 构建、macOS 真实交互验收和文档收尾。
- **范围**：完整前后端验证、release bundle 构建与签名、真实应用验证 Untitled Markdown/Mermaid 主要流程、同步 README/Feature/current 状态并部署已验收版本。
- **非范围**：新增主要行为或扩大支持语言。
- **结果**：实现与全部自动化通过；新 release 已完成临时签名并部署到 `/Applications/Textora.app`。真实应用确认 Untitled 选择 Markdown 后可使用 Preview、WYSIWYG 与 fenced code Format，选择 Mermaid 后可渲染预览，且标签间 Syntax 和预览状态隔离。经用户授权，验收创建的 `Untitled` 与 `Untitled 2` 未保存临时标签已选择“不保存”关闭，原有四个已保存标签保持打开。
- **验证记录**：定向测试 **205 passed / 0 failed**；`npm run check` 独立复跑 **538 passed / 0 failed**；`npm run build`、`cargo fmt --manifest-path src-tauri/Cargo.toml --check`、Rust tests（**167 passed / 0 failed**）、`npm run tauri -- build`、release 与安装版本 `codesign --verify --deep --strict`、安装前后二进制 SHA-256 一致及 `git diff --check` 通过。安装版本 SHA-256 为 `6edc1315bc57f62fb1a975f801d7399fa72c68760c5844d10c6e03d9aaaf6c2e`，旧安装备份位于 `/private/tmp/Textora.app.syntax-capability-backup`。

### Untitled 复用所选 Syntax 的格式专属能力

- **状态**：已完成
- **开始日期**：2026-09-10
- **完成日期**：2026-09-10
- **Feature Spec**：`docs/features/unsaved-document-language-mode.md`
- **目标**：使用 `+` 新建 Untitled 标签并选择 Syntax 后，可使用与直接打开对应格式文件相同的已有功能。
- **范围**：统一未保存临时 Syntax 与已保存路径识别的有效语言判定；让 Markdown Preview/WYSIWYG/Format/编辑辅助及 Mermaid Preview 复用该判定；覆盖模式切换、标签隔离和异步格式化失效保护。
- **非范围**：新增语言或格式能力、允许 Syntax 覆盖已保存文件、持久化临时模式、改变首次保存建议与保存后按实际路径重识别规则、release 部署与人工验收。
- **结果**：新增有效文档语言契约，Untitled 使用标签 Syntax、已保存文档仍强制按实际路径识别；App 的源码语言、状态栏与 Markdown/Mermaid 专属入口统一采用该结果。自动化确认 Untitled Markdown 可预览、进入 WYSIWYG、格式化 fenced code，Untitled Mermaid 可本地预览；模式切换立即卸载旧能力且不改源码，多标签保持各自模式与预览状态，异步 Format 在 Syntax 离开 Markdown 后零修改且不残留提示。
- **验证记录**：定向 `npm test -- --run src/languageRecognition.test.ts src/App.test.tsx` 通过（**205 passed / 0 failed**）；`npm run check` 独立复跑通过（**538 passed / 0 failed**，24 个测试文件）；`npm run build` 通过；`git diff --check` 通过。一次将完整测试与生产构建并行执行时有 4 个无断言失败的 5 秒超时，独立复跑全部通过，判定为资源争用而非回归。

### 修复格式化异步提交竞态

- **状态**：已完成
- **开始日期**：2026-09-10
- **完成日期**：2026-09-10
- **Feature Spec**：`docs/features/markdown-fenced-code-formatting.md`
- **目标**：格式化器动态加载期间发生切换标签、进入 WYSIWYG、关闭标签、开始保存或文档转为只读时，格式化结果不得写入错误标签，也不得让未保存的格式化内容被标记为干净。
- **范围**：`handleFormatClick` 把格式化作为显式 in-flight 操作（防重入）；在 `view.dispatch` 前校验原始 tabId、document id、目标 fence 内容与当前可编辑状态；新增延迟格式化下的同内容标签切换和保存竞态集成测试。
- **非范围**：新增格式化语言、改变既有「格式化期间文档变化」的 fence 重定位语义、锁死保存/切标签入口。
- **结果**：App 捕获格式化发起标签与文档身份，并在异步结果提交前校验活动上下文、只读与交互锁；Editor 同时校验当前挂载视图，并沿用既有 fence 内容重定位保护。标签切换或 WYSIWYG 卸载后的迟到结果零修改，且不会把旧操作提示挂到新活动文档；保存挂起期间返回的结果被拒绝，避免磁盘旧内容与已清洁会话新内容不一致。测试闸门以格式化器开始/完成信号确定性复现两个竞态，临时诊断文件与调试日志已移除。
- **验证记录**：`npm run check` 通过（**533 passed / 0 failed**，24 个测试文件）；`npm run build` 通过；`cargo fmt --manifest-path src-tauri/Cargo.toml --check` 通过；`cargo test --manifest-path src-tauri/Cargo.toml` 通过（**167 passed / 0 failed**）；`git diff --check` 通过。
