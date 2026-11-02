# T03-01 RESULT

状态 complete；TASK r1；2026-11-02；父 T03。基线 fe44de8 + 未提交差异，保留既有 T02/编号修复。

交付：Markdown 工具栏 Export PDF；对当前未保存内容生成独立安全 Preview 快照；等待 Mermaid 后调用受限原生命令；macOS NSPrintOperation 异步保存至系统面板所选目标，经临时文件签名校验与原子替换。禁覆盖已打开/候选文档，取消不改原文，准备/输出期间锁定交互。无前端宽泛打印/文件权限。

验证：npm check 27 files / 632 tests、npm build、cargo check/test（175 tests）、cargo fmt 通过；定向快照/App 179 tests 通过。原生 AppKit/WebKit 同 API 的独立合成样例实测生成 4 页 A4 PDF（约60KB），渲染全部页面检查中文、标题、列表、引用、代码、表格；pdfplumber 检查所有文字位于页面内、无应用工具栏。样例及图像在 /tmp/textora-export-qa，仅本地临时证据。测试为原生打印路径 + App 自动化组合，未冒充已点击打包应用的系统保存面板端到端验收。

发现并修复：同步 runOperation 导致空白页无限输出，已停止进程并删除巨大临时产物；改为 runOperationModal + 完成 delegate 保持快照到结束；移除 CSS @page margin:0，防止与 AppKit 页边距冲突造成顶部文字裁切。沙箱不能访问 WebKit 图形服务的首轮验证失败，随后在授权的本地图形验证环境完成。初轮 Objective-C 字典 key 类型错误已修正并编译通过。

规划细化：跨页重复表头不作为系统 WebKit 可以保证的能力；保留表格内容/样式、A4分页和不裁字。SPEC 同步说明系统分页限制，不宣称完整浏览器印刷排版等价。

Review：聚焦输出授权/签名/临时清理/打开文件拒绝、异步 delegate 生命周期、快照/锁定/取消恢复和权限边界；已关闭上述实际发现，无剩余可执行修复问题，无需额外修复说明。DOCX 和最终打包组合验证由 02 承接；未提交、未覆盖已安装应用。
