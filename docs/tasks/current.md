# 当前任务

个人项目同时最多一个任务处于进行中。此文件只保留已承诺、可执行的近期工作，不保存候选想法；“最近完成”按完成时间倒序最多保留 3 个任务，旧记录由 Git 历史承载。

## 进行中

（无）

## 已承诺待办

（无）

## 最近完成

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

### 通用 Format 组合回归与文档收尾

- **状态**：已完成
- **开始日期**：2026-09-10
- **完成日期**：2026-09-10
- **Feature Spec**：`docs/features/markdown-fenced-code-formatting.md`
- **目标**：在完整回归与 macOS release 真实应用中确认通用 `Format` 的组合行为，并完成 Feature 验收与文档收尾。
- **范围**：运行完整前端检查、构建与 Tauri release 构建；在 macOS 真实应用中验收首期语言主要格式化流程与一次撤销；核对失败保护和 Preview/WYSIWYG、只读/忙碌、多标签及保存边界；同步 Feature Spec、README 与 backlog。
- **非范围**：新增语言、别名或任何格式化行为。
- **依赖**：已完成的通用入口/JSON 迁移、prettier、sql-formatter 与 shfmt WASM 接入。
- **拆分检查**：本任务只负责组合回归、真实平台确认与文档状态翻转，未新增主要行为。
- **完成标准**：完整自动化、前端构建与 release 构建通过；macOS 真实应用组合验收按实际能力完成并如实记录；Feature Spec 验收条件全部有真实结果；`git diff --check` 通过。
- **结果**：通用 `Format` 首期能力完成。实际 `.md` 文件在 release 应用中显示入口，JSON、JavaScript、TypeScript、YAML、SQL 与 Shell 均产生预期格式化输出；JSON 一次 `⌘Z` 恢复原文。临时 Untitled 的 Markdown 语法模式不开放格式专属入口，符合既有边界。因同时存在两个相同 bundle ID 的 Textora，Computer Use 无法稳定区分后续 UI 实例，故其余失败与模式边界采用完整自动化结果验收并如实记录；工作区验收实例已按进程路径结束，用户 `/Applications` 实例保持运行。
- **验证记录**：`npm run check` 通过（**531 passed / 0 failed**，24 个测试文件）；`npm run build` 通过；`npm run tauri -- build` 通过并生成 `src-tauri/target/release/bundle/macos/Textora.app`；真实应用覆盖六种语言的有效格式化、JSON 一次撤销与 Untitled 文件身份边界；自动化覆盖未知/未闭合/无效/超限/并发变化、只读/忙碌、多标签、WYSIWYG/Preview、保存与关闭保护；最终 `git diff --check` 通过。

### shfmt WASM 接入 Shell 格式化

- **状态**：已完成
- **开始日期**：2026-09-10
- **完成日期**：2026-09-10
- **Feature Spec**：`docs/features/markdown-fenced-code-formatting.md`
- **目标**：`Format` 能按规格固定风格格式化闭合的 Shell fenced code block。
- **范围**：新增 @wasm-fmt/shfmt 运行时依赖；注册 `sh`/`bash`/`zsh`/`shell`/`shellscript` 别名与规格固定选项；无效输入失败语义；vitest 下 WASM 加载策略；记录许可证与体积。
- **非范围**：其他语言；自定义 Shell 选项；简化改写（`-s` simplify）行为。
- **依赖**：完成「通用 Format 入口与 JSON 迁移」。
- **拆分检查**：独立依赖、独立可观察结果，单语言族一个任务。
- **完成标准**：Shell 别名映射单元覆盖、有效输入确定性输出断言、无效输入零修改通过；许可证与体积记录于验证记录；`npm run check` 与 `git diff --check` 通过。
- **结果**：`src/fenceFormatting.ts` 注册表追加 Shell 条目：5 个别名统一 displayName "Shell"，按 bash 变体解析（path `".bash"`）；固定选项仅 `indent: 2`，改写类开关全部显式关闭（binaryNextLine/switchCaseIndent/spaceRedirects/funcNextLine/minify/singleLine/simplify）。经包官方 `/vite` 入口动态导入，生产构建中 WASM 作为本地资产输出。vitest 加载策略：`shfmt.wasm?init` 胶水在 jsdom 下无法解析资源 URL（外置时报 default 导出缺失，inline 后报 URL 解析失败），最终经 vite.config.ts 的 `test.alias` 把该入口替换为 `src/shfmtVitestShim.ts`（re-export `/node` 入口的真实 `format` + 空 init），测试走同一 WASM 的 Node 路径，行为与生产一致。行为发现：shfmt 保留单行紧凑复合命令（只折行不改写）、输出恒以 `\n` 结尾、语法错误抛错归统一 `invalid-content` 语义。
- **验证记录**：@wasm-fmt/shfmt 0.2.7（MIT）安装成功；定向 `npm run test -- Editor.test.ts -t "shfmt"` 通过（3 passed | 104 skipped，含 5 个别名映射覆盖、大写 `BASH` 归一化、嵌套 func/if 与 pipeline 确定性输出、语法错误与未闭合字符串 `invalid-content` 零修改）；`npm run build` 通过，WASM 为本地资产 `dist/assets/shfmt-*.wasm` 400.84 kB（gzip 173.60 kB，无运行期网络请求）、胶水 chunk `shfmt_vite-*.js` 1.45 kB；`npm run check` 通过（typecheck 通过，**531 passed / 0 failed**，24 个测试文件）；`git diff --check` 通过。日志：`/private/tmp/textora-shfmt-test.log`、`/private/tmp/textora-shfmt-build.log`、`/private/tmp/textora-shfmt-check.log`。
