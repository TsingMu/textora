# T03-01：按 Preview 样式另存为 PDF

- 状态 ready；r1，2026-11-02；父 T03；medium 风险，原生打印与文件覆盖路径需 Review。
- 目标：Markdown 工具栏点击 Export PDF，对当前内容快照（含本地 Mermaid）生成分页 PDF，系统选择位置、取消不改变原文。SPEC FR-1/2/4、BR-1～3、AC-1/2/4。
- 方案：markdownExport.ts 生成安全 HTML；独立 DOM 根以 Preview class 呈现并使用 print CSS 隐藏应用 UI；受限 Rust 命令主线程使用 WKWebView printOperation+NSPrintInfo SaveJob 生成临时 PDF，成功后原子替换所选目标。App 锁定导出准备与原生导出期间操作，显示取消/错误/成功事实，不改文档会话。
- 验证：快照渲染、失败、print DOM、App 入口/锁定/会话回归；Rust 输出目标/扩展名/原子写与拒绝打开文件测试；npm run check/build、cargo fmt/test/check、macOS 原生分页样例。只实际执行才记录 PASS。
- 非范围：DOCX 实现在下一项，不改 T02 业务实现。当前任务含完整 PDF 垂直切片，可独立验收，后续只复用 HTML 和输出安全工具。
