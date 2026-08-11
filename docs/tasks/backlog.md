# Backlog

这里保存尚未承诺实施的候选事项，不代表优先级或开发计划。事项进入 `current.md` 前，应先明确范围；涉及用户可观察行为时创建 Feature Spec。

## 产品与技术发现

- 明确 Markdown fenced code block 编辑辅助的触发语义：自动闭合 fence 是否只在 Markdown 模式生效；格式化是手动触发还是输入时自动触发；无效 JSON/代码如何提示且不破坏源码。
- 评估超过 50 MiB 文件的只读或分块编辑方案。

## 候选垂直切片

- 增加 Markdown fenced code block 自动闭合：在 Markdown 中输入类似 <code>```json</code> 后回车，自动补齐结束 <code>```</code>，并把光标放到代码块内容区。
- 增加 Markdown fenced code block 上下文识别：根据光标位置识别所在 fenced code block 的语言、内容范围和边界，为后续格式化或编辑命令提供稳定契约。
- 增加 Markdown fenced JSON 格式化首版：当光标位于 `json` fenced code block 内时，通过明确按钮或快捷键格式化该代码块内容；无效 JSON 时非阻塞提示且不改写源码。
- 增加其他传统编码与 GB18030 支持。

多标签会话、列块编辑、代码文本识别及最小语法高亮、Markdown 源码与本地预览左右分栏、Mermaid 本地编辑与预览、Markdown 预览代码块语法着色和 Markdown 所见即所得模式均已完成。Markdown fenced code block 编辑辅助仍是候选方向，不代表已承诺计划；任何候选进入 `current.md` 前仍需形成对应 Feature Spec 并确认范围。
