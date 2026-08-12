# Backlog

这里保存尚未承诺实施的候选事项，不代表优先级或开发计划。事项进入 `current.md` 前，应先明确范围；涉及用户可观察行为时创建 Feature Spec。

## 产品与技术发现

- 评估超过 50 MiB 文件的只读或分块编辑方案。

## 候选垂直切片

- 为 Markdown Preview 左右分栏增加同步滚动：源码区滚动时预览区跟随到对应段落，预览区滚动时源码区跟随到对应 Markdown 位置，避免双向滚动循环。
- 为 Markdown opening fence 增加本地语言候选提示：输入 <code>```j</code> 时推荐 `java`、`javascript`、`json` 等候选，支持键盘选择、过滤和关闭，不作用于 WYSIWYG 或非 Markdown 文档。
- 增加其他传统编码与 GB18030 支持。

外部文件变更实时同步、多标签会话、列块编辑、代码文本识别及最小语法高亮、Markdown 源码与本地预览左右分栏、Mermaid 本地编辑与预览、Markdown 预览代码块语法着色、Markdown 所见即所得模式和 Markdown fenced code block 编辑辅助均已完成；其余候选仍不代表已承诺计划。
