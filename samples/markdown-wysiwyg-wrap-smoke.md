# 长文本软换行冒烟样例

> 用于「Markdown WYSIWYG 长文本软换行 macOS 窄窗口视觉验收」：在 release `Textora.app` 中打开本文件 → 切到 `WYSIWYG` → 把窗口缩到最小宽度（720px）→ 观察各可编辑块是否软换行、完整可见可编辑、marker/复选框与首行对齐，且保存后源码不产生额外换行。

## 标题（H2）这是一个非常非常非常非常非常非常长的中文标题用来验证窄窗口下的自动软换行是否完整可见

### 三级标题同样需要验证 This Is A Rather Long English Heading Without Any Breaks Whatsoever

- 这是一个非常非常非常非常非常非常非常非常非常非常非常长的无空格中文列表项文本用来验证窄窗口下软换行不会向源码注入额外换行且高度自动扩展事发当时发的顺丰
- SupercalifragilisticexpialidociousAndThenSomeMoreWordsWithoutAnyBreaksHereGoesEvenLongerNow
- [ ] 这是一个未勾选的任务项其文本同样非常非常非常非常非常非常非常长需要软换行后仍保持复选框与首行对齐且可编辑
- [x] 已勾选任务项长文本ThisIsAnotherLongEnglishRunToVerifyCheckboxAlignmentWithFirstWrappedLineIndeed

1. 有序列表同样需要验证长文本ThisIsAVeryLongEnglishSentenceWithoutAnySpacesAtAllQuiteLongIndeed
2. 第二条有序列表项继续测试换行与高度扩展以及保存源码不产生额外换行的行为
3. 第三条这是一个非常非常非常非常非常非常非常非常长的中文有序列表项用来确认序号与首行对齐

> 引用块中的长文本同样需要软换行：这是一个非常非常非常非常非常非常非常非常长的引用文本用来验证引用区在窄窗口下也能完整查看与编辑而不会被裁切。

普通段落：这段普通正文同样很长，目的是确认段落控件在窄窗口内也能自动软换行并随内容扩展高度，而不是只显示一行后把剩余内容裁切掉。Here is a long English run without spaces SupercalifragilisticexpialidociousAndThenSomeMoreWordsWithoutAnyBreaksHere.

```json
{"longField":"这是一个非常非常非常非常非常非常非常非常长的 JSON 字符串值用来验证 fenced code block 的代码区在窄窗口下也能软换行并完整查看编辑","another":"value"}
```

```python
def long_function_name_here(parameter_one, parameter_two, parameter_three):
    # 这是一个非常非常非常非常非常非常非常非常长的注释用来验证非 JSON 代码语言标记与代码区的软换行
    return parameter_one + parameter_two + parameter_three
```

| 表头A | 表头B |
| --- | --- |
| 这是一个非常长的源码岛表格单元格内容用来确认表格作为源码岛也能完整查看与编辑 | 另一个长单元格 |