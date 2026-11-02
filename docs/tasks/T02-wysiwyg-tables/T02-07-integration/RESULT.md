# RESULT: T02-07 — 表格能力组合验收与文档收尾

- **状态**：complete（Codex 聚焦 Review 与 release WebKit 补充验收通过）；TASK r1，父 T02；2026-11-02。
- **代码基线**：HEAD `fe44de8dd25b98e8537eca107b0f35fd530adf4a`；开始时工作区含 T02-01～06 及其他任务的既有未提交改动（见各前置 RESULT），本任务未提交、未暂存、未推送。本任务新增/修改见下。

## 实际变更

- `samples/markdown-wysiwyg-table-smoke.md`（新增）：可重复验收样例；正常/格式/四种对齐、仅表头、宽表长路径、转义/HTML/空单元、不齐与列表内源码岛。解析验证：4 个受支持 table 块（3x4、0x2、2x3、4x2）+ 3 个源码岛（不齐表、列表内表、代码围栏）。
- `src/App.test.tsx`（新增 1 测试，3208 区段后）：组合回归 "interleaves cell, row, column and alignment edits across modes, save and reopen without touching other fragments"——空单元输入 `中|文`（转义回写）→ 插末行 → 插第 4 列（规范化重建）→ 新列居中 → Preview 断言（4 列/3 数据行/居中 style/code 管道解码）→ 切回 WYSIWYG → 保存（含不齐 padding 表格的精确全文断言）→ 卸载重开（4 列 3 行、不置脏、编辑值保留）→ 编辑非表格尾段再保存（两表与引用块逐字保留）→ 源码模式全文一致。

## 验收与验证

| 项 | 结果 |
| --- | --- |
| 07-AC-1（V-07 交错组合/不回退） | PASS：上述 App 组合测试、全套 735 测试与下述 release 交错/会话/磁盘全文验证 |
| 07-AC-2（V-MAC 完整清单） | PASS：Codex 本轮使用原生 Computer Use 对已构建 release 执行下述清单；辅助访问当前可用，原先 NOT_RUN 已解除 |
| 07-AC-3（V-Q 构建/diff/文档） | PASS：自动化与构建证据如下；本轮补齐平台验收、规格/README、current 与父 RESULT |

执行目录均为项目根；完整日志在 `/private/tmp/textora-t02-07-*.log`：

- V-07 组合定向：`npm run test -- src/App.test.tsx -t "interleaves cell"` 退出 0，1 passed（开发期 3 次失败为测试自身修正：第二表单元数误计、对齐目标列误选、重开误用已卸载 root；实现行为未改）。
- V-07 全套：`npm run check` 退出 0，30 files / 735 tests（+1 组合测试）。
- V-07/V-Q 构建：`npm run build` 退出 0（仅既有 chunk 体积提示）。
- V-07 bundle：`npm run tauri -- build --bundles app` 退出 0（54.62s，经 rsproxy 临时镜像，配置已删除）；`src-tauri/target/release/bundle/macos/Textora.app`，ad hoc 重签后 `codesign --verify --deep --strict` 退出 0，主二进制 SHA-256 前 16 位 `8dfd6900f4c04caa`，15 MB，macOS 26.5。
- V-Q diff：`git diff --check`、`git diff --cached --check` 退出 0；新增未跟踪文件（样例、本 RESULT）已检查行尾与末换行。
- 真实平台（仅启动冒烟，非 V-MAC）：release bundle 启动、会话恢复 8 标签、Markdown 渲染、工具栏完整、暗色可读、无弹窗崩溃（截图 `/private/tmp/textora-t02-07-launch.png`）。

## 偏差、未测项与剩余

- 初交付时 V-MAC 全部 NOT_RUN；本轮实际 Computer Use 能读取并操作 release 应用，已解除该环境判断。无需再等待用户手工执行整份清单。原始测试预期修正仍如上保留。
- Rust/IPC/权限无改动；`npm run tauri -- build` 仅作为 release 产物门禁，未跑无关全量 cargo test（父矩阵未要求，N/A）。
- 对后续影响：无接口变更；组合测试与样例可直接复用于回归。

## Codex Review / 完成确认

2026-11-02：Codex 聚焦 Review 通过，07-AC-1～3 确认完成。审查新增 App 组合测试、smoke 样例、前置 01～06 RESULT/Review、最终候选与构建日志；无待修可执行问题，无需生成修复说明。本轮仅补充验收与文档，未修改业务代码、未提交/推送或覆盖安装版。

### V-MAC 补充验收（真实 release）

- 环境：macOS 26.5，Textora 0.1.0，使用仓库 `src-tauri/target/release/bundle/macos/Textora.app`；主二进制完整 SHA-256 `8dfd6900f4c04caa1e0587ec86697699146f8f09fb1b71915e0e8476ad3b67b1`，本轮 `codesign --verify --deep --strict` 退出 0。生产源码未变，复用现有最终构建，不用独立宿主冒充 release。
- 操作方式：Computer Use 原生 AX/截图、点击、键盘、拖动；所有写入只用 `/private/tmp/textora-t02-07-review/` 下公开样例副本。原始用户标签/文件未编辑；外观由原始“自动”临时切浅色后恢复“自动”；窗口从 1120 缩至约 723（截图宽 1446 像素，2×），结束恢复原宽。Caps 切输入源，测试结束回到英文。
- 证据：本次聊天的原生 AX 状态/截图和以下具体操作结果；临时文件保留在上述目录，不承诺永久归档。保存后的 `smoke.md` 与构造的 `expected.md` 全文比较相等；只含三个表格中的有意编辑，其他表格 cell token、正文、引用、fence 与末尾换行逐字保留。另有 `second.md`、`readonly.md` 与保存锁定测试文件。代码/产物识别及操作事实保存在本 RESULT，不依赖临时清单永久存在。

| 原清单项 | 结果与实际证据 |
| --- | --- |
| 1～4 展示/明暗/窄窗/长内容 | PASS：4 个结构化表、非矩形与列表内源码岛完整；查看浅色及自动暗色截图；约 723px 三组工具均可达。长 code 路径与中文软换行。额外在首表插四空列成为八列，聚焦第八列时仅表格内部横向移位，外部工具保持可达；删除四空列后恢复原列数 |
| 5～8 表头/格式/空单元/特殊字符 | PASS：第三表表头改为“功能改”，首表粗体改为“粗体改”且星号保留，空单元输入 `中|文`、反斜杠和反引号，列数及相邻内容不变；实际保存后检查对应转义。随后在同一单元测试多行粘贴 |
| 9 中文 IME | PASS：按用户说明用 Caps，空单元逐键输入 zhong，未确认时 AX 显示行/列/对齐全部禁用；按 1 选择第一候选后显示“中”，全部操作恢复。不是仅粘贴中文或派发模拟 composition |
| 10～12 撤销/重做/粘贴/删空 | PASS：粘贴“第一行\n第二行\t末尾”显示为单行“第一行 第二行 末尾”；⌘Z 恢复之前特殊字符输入，⇧⌘Z 恢复粘贴文本；删空粗体片段后仍可聚焦，再填回文字 |
| 13～15 行插删 | PASS：仅表头表插入首条空行，直接删除并恢复表头焦点；再插行填“删除验证”，非空确认后删末行恢复表头。首表非空行确认显示原行内容，默认聚焦取消，取消及切模式均不删除内容 |
| 16～19 列插删与确认失效 | PASS：前/后插列全部行及表头同步，新列默认；空列直接删；非空列预览含表头和各行，取消无删除。仅表头表确认删第二列后只剩一列，删除按钮禁用。行/列/对齐在待确认时全部禁用；切模式、标签或实际外部更新后确认不复活 |
| 20 Tab/Shift+Tab | PASS：粗体片段 Tab 到同单元下一文字片段，Shift+Tab 回前片段；末表最后单元 Tab 到表格外段落，不新增行。原生文本与系统编辑键保留 |
| 21～23 对齐 | PASS：新列依次选 left/center/right/default，每次当前按钮禁用；最后对首表第二列设置 right，保存源码只有目标 separator 为 `---:`，Preview 对应列右对齐 |
| 24～25 交错与双标签 | PASS：单元→行→列→对齐→源码/Preview/WYSIWYG→保存；磁盘全文与预期一致。second.md 中编辑后切新标签，旧确认清理；切回内容仍为本标签修改，smoke.md 不串写 |
| 26 真实保存锁定 | PASS：小文件保存/重开清洁且磁盘内容正确；为观察瞬态另用 41,871,425 字节公开临时文档，在表格改一个 cell 后点击保存。捕获到实际 `Saving…`，所有表格输入、行/列/对齐按钮及文件工具均禁用；完成后 Saved/操作恢复。文件最终 41,871,433 字节，只含目标 cell 变化且完整 fence 保留 |
| 27～29 关闭/只读/外部更新 | PASS：关闭脏标签出现 Save before closing，取消继续编辑。chmod 0444 副本显示 Read-only，cell 和结构按钮禁用。对干净 second.md 的实际磁盘改写自动重载、旧行确认消失；脏状态再外改触发冲突提示，表格全部禁用，Reload 后恢复新内容。额外将临时文件移走，出现 File missing on disk 模态，旧编辑不可达，恢复磁盘并 Keep content 可保留内容 |
| 30～31 安全显示 | PASS：点击链接只聚焦文字，URL 保持 tauri://localhost；HTML 片段显示 `<b>加粗</b>` 字面文字，无执行/导航。更广泛安全输入沿用最终自动化覆盖 |
| 32 同步滚动 | PASS：分屏源码定位首表，两侧为同一表；在源码面板向下滚动跨表格后，两侧均显示尾部不规则表/列表/引用/fence/尾段，未因结构变化丢失对应位置 |
| 33 保存关闭重开 | PASS：smoke.md 实际保存、关闭、用原生文件面板重开，WYSIWYG 显示编辑值、4 个表仍完整且 Save 禁用；后续只做测试列往返和目标对齐变化，再保存。全文逐字核对通过；组合自动化另外覆盖卸载后重开 |

补充边界：加载锁与迟到事件的精确时序继续由最终 App/组件自动化覆盖，未声称凭截图看到了每个瞬态；保存锁已单独捕获。已有上游 WebKit 原生输入证据仅作补充，不替代上表真实 release 操作。

### 最终验证与交接

- 独立复跑 `npm run test -- src/App.test.tsx -t 'interleaves cell'`，退出 0，1 passed / 193 skipped（定向筛选）；735 项全套、typecheck/build 和 release bundle 使用上述最终候选日志，没有把 skipped 算作通过。
- 文档收尾更新 SPEC、基础 WYSIWYG/内联规格的扩展范围、README 与 current；最近完成保留 07/06/05 三项，无进行中任务。父 T02 验收见 `../RESULT.md`。
- 最终检查 PASS（项目根）：`git diff --check`、`git diff --cached --check` 均退出 0；Python 检查 9 份 Review/收尾文档的末换行、行尾空白及正文 Markdown 本地链接，退出 0；7 个子 RESULT 均 complete，current 无进行中/待办、最近完成恰为三条。链接检查排除代码示例中的 `[label](destination)`。最终文件再次关闭重开后，第二列 right 当前项禁用、编辑文字完整且 Save 禁用。无需再执行用户手工整份清单，无新增待办。
