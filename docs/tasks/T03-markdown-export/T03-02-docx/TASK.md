# T03-02：将 Markdown 另存为可编辑 DOCX

- 状态 ready（前置 PDF 垂直切片已交付，结果见 01 RESULT）；r1，2026-11-02；父 T03；风险 medium：格式转换/图片栅格化及受限输出，需聚焦 Review。
- 来源：用户追加要求 Word doc 或 docx，选择现代 DOCX；规格 FR-1/3/4、BR-1～3、AC-1/3/4。
- 目标：同一安全 Preview 快照生成真实 OOXML DOCX；保留可编辑标题、段落、粗斜体/删除线/代码、列表、引用、表格；Mermaid 嵌 PNG，不加载远程/本地用户资源。不假装旧二进制 DOC，不承诺 Word 与 PDF 分页逐像素一致。
- 实施：新增 markdownWordExport.ts，使用 docx 9.5.1（锁定依赖）映射 DOM 语义/颜色/字体，图表通过安全 SVG→canvas PNG；App 同一导出编排，新增 Word 入口。Rust 仅接收受限 Raw DOCX bytes（限额、签名），原生选择 docx 目标、复用临时原子替换和打开文件保护，不发前端任意路径写权限。
- 验证：解包 DOCX 核对正文/样式/列表/表格/媒体且无外链关系；单元/组件/App 取消失败、忙碌与源码不变；真实样例用 Word 兼容渲染器打开并检查每页；完整 npm check/build、Rust fmt/test/check、Tauri app bundle。PDF 复用 01 实测证据，涉及共享 CSS/IPC 时补跑受影响项。输出和 Review 写同目录 RESULT；不得未经验证标父完成。
- 粒度：一个 Word 导出垂直切片；原生写入和 HTML 快照已由 01 验证，复用而不另立技术层任务。最终组合验收仅验证两种格式/共享锁定与构建，无新增主要行为。
