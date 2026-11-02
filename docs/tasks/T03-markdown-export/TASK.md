# T03：Markdown 导出

- 状态 ready；r1，2026-11-02；规模 Medium，风险 medium（原生输出与覆盖保护，现有文件核心不改）。用户明确授权实施 PDF 与 DOCX。
- 基线 fe44de8，已有 T02 与编号修复未提交，保留；规格 `docs/features/markdown-export.md`。
- 共享契约：前端对当前 Markdown 快照复用 renderMarkdownPreview/renderMermaidPreview；两个格式消费同一安全 HTML。PDF 仅打印独立快照根，复用 Preview CSS，macOS NSPrintOperation 保存至用户选定位置；DOCX 用 docx 库转换该 HTML 的语义与安全本地图表。输出走独立受限命令、原生保存面板和临时文件原子替换；拒绝已打开文档目标，不进入普通保存/恢复链路。
- 依赖：01 PDF 垂直切片（完成，见 T03-01-pdf/RESULT.md）→02 DOCX 垂直切片及两格式组合验收（完成，见 T03-02-docx/RESULT.md）。按各步骤更新 current，同一时间只有一个进行中；本次用户授权顺序完成两项。
- 入口：App.tsx、独立 markdownExport.ts、App.css、platform.ts、src-tauri/src/export.rs；按需新增仅 macOS 的 objc2 原生打印依赖及 docx。
- 模块门禁：前端全套与 build；Rust fmt/test/check、原生 bundle；生成多页中文/表格/代码/图表 PDF/DOCX 样例检查内容与分页；验证取消、失败、原文/旧目标保护。父 RESULT 仅在必要两项证据齐全后 complete。

模块完成确认与证据索引：`RESULT.md`。
