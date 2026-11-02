# T03-02 RESULT

状态 complete；TASK r1；2026-11-02；父 T03；基线 fe44de8 + 未提交差异。只实施本模块，保留 T02 与编号修复。

## 实际交付

- `src/markdownWordExport.ts`：同一安全 Preview HTML → docx 9.5.1 OOXML；可编辑标题/正文/粗斜体/删除线/行内代码、列表/任务项、引用、表格及带语法色的代码容器。A4、中文字体、表头行标记、列宽和 Preview 配色。安全 Mermaid SVG 本地 canvas 栅格化为嵌入 PNG，15秒失败超时；不读取或加载用户图片/链接。图表替代文字只取标签，不输出 SVG CSS。
- `src/App.tsx` / CSS：`Export…` 原生选择菜单内含 PDF、Word；源码/Preview/WYSIWYG 都可用；使用当前内容快照，准备/导出时锁定，错误与取消释放锁定。720px 窄窗压缩工具栏布局，暗色样式只作用屏幕，打印保持浅色。
- `platform.ts` / `src-tauri/src/export.rs`：DOCX 原始二进制 IPC，ASCII header 编码 UTF-8 建议文件名；原生保存面板授予路径，100MiB上限及 ZIP 签名，复用临时完整输出/原子替换、已打开/候选文档保护、并发导出门禁。普通保存/编码/会话恢复核心不变；未扩大前端 capability。

## 验收证据

| SPEC / 验证 | 结果 |
| --- | --- |
| AC-1 | PASS：App 自动化覆盖两格式入口、非Markdown无入口、未保存快照、导出锁定、取消与失败恢复、脏状态/源码不变；后端覆盖目标保护和失败不损坏旧文件 |
| AC-3 | PASS：5项 OOXML 测试覆盖可编辑语义、唯一标题样式、原文/被动URL、媒体嵌入、空文档与列表；真实无头浏览器运行实际转换和 SVG→PNG 代码，以真实 Mermaid 生成 DOCX |
| AC-4 | PASS：最终 `npm run check` 28 files / 640 tests；`npm run tauri -- build --bundles app`（含前端build与release构建）；`cargo test --manifest-path src-tauri/Cargo.toml --offline` 176 tests；Rust fmt、diff/cached diff检查。均在项目根执行、退出0 |
| 样例视觉 | PASS：原生 WebKit PDF 4页；DOCX经 bundled render_docx.py + LibreOffice兼容渲染6页，逐页查看中文/代码/表格/真实Mermaid。输出文本/图表无缺失，无应用工具栏、无裁出页面的PDF文字；DOCX解包确认媒体与可编辑文字 |
| 本地签名 | PASS：修正既有 linker ad hoc 无资源封装问题，执行 codesign --force --deep --sign - 后 codesign --verify --deep --strict 退出0；仅本地开发签名，不代表公证/分发签名 |

最终 app：`src-tauri/target/release/bundle/macos/Textora.app`；签名后二进制 SHA-256 `8a2a225883c11af864fc5b10915556aa8f2563bba96bef47dfcba3e376234d71`。初次打包未替换安装版，未提交/推送；后续安装事实见下。

样例/页图及中间 harness 保存在 `/tmp/textora-export-qa`，日志 `/tmp/textora-export-check.log`、`/tmp/textora-export-rust-tests.log`、`/tmp/textora-export-app-build.log`；均为本轮临时材料，不冒充永久归档。视觉证据对应最终绘制/分页代码；之后仅收窄 SVG 替代文字与显示错误原因，不改变可视内容，可复用上述渲染证据。

## 偏差、限制与 Review

- 初轮 DOCX 兼容渲染缺少字体：macOS中文字体位于 AssetsV2，验证工具旧 fontconfig 未包含该路径；设置仅 QA 使用的临时 fontconfig 后重渲染，中文正常。产品不要求用户安装该配置。
- 修复自检发现的内置 Heading 样式重复ID，改为库的 default heading 覆盖并新增唯一性回归。代码块使用有内边距的单元格容器，仍为可编辑文字。初轮 TypeScript readonly/样式字段错误已修正，最终检查通过。
- PDF由系统WebKit分页，不保证续页重复表头；DOCX分页由Word兼容排版引擎决定，不承诺逐像素等同PDF。提供真实 DOCX，未提供旧二进制DOC。继承Preview不加载图片/链接的安全范围。
- NOT_RUN：打包应用内系统保存面板的手工端到端点击与 Microsoft Word 本体打开；使用 App/Rust 自动化 + 实际浏览器生成 + 原生PDF + Word兼容渲染器交叉验证，不冒充手工验收。

Codex 完成确认：复核新增转换模块、App/IPC差异、原生输出及打开文件保护、媒体/被动关系、UTF-8/Raw边界、取消/失败清理、样例与最终候选关联；上述实际问题已关闭，无剩余可执行修复问题，无需生成额外修复说明。两子任务可计入父模块验收，后续表格任务不在本轮范围。

## 安装与启动验证（2026-11-02）

用户明确授权替换并启动，并确认放弃两个未保存标签的修改。旧应用正常退出后，已将同 SHA-256 的签名包替换到 `/Applications/Textora.app`；安装后 codesign 严格校验及二进制哈希匹配通过。已启动安装版，通过原生 AX 确认主窗口、文档会话恢复及新版 `Export…` 菜单可见；未执行导出保存面板的完整操作。旧包临时保留在 `/private/tmp/Textora-before-update-20261102-1793598713266896000.app`，非永久归档。
