# TASK: T01 — 暗色模式活动标签可辨识

- **Task ID**：T01
- **层级**：单级 TASK
- **状态**：ready；实施与验收已完成（2026-10-24），见 `RESULT.md`（状态 complete，Codex 确认 pending）
- **修订**：1（2026-10-24）
- **规模**：Small；仅调整现有标签栏视觉状态及其必要回归
- **风险**：low；不涉及文档内容、文件写入、会话模型或跨进程接口，主要风险是外观、焦点与禁用状态的可辨性回退
- **Review**：实施者自检；按 Feature Spec 做 macOS 真实应用目视验收
- **项目根**：仓库根目录
- **关联 SPEC**：`docs/features/dark-mode-active-tab.md`，草案，规划依据 SHA-256 `469b341d82592990ad025b84c9bbc04788d8b2d0be3c933580d7ae4de894bb0c`；覆盖 FR-1～FR-3、BR-1～BR-4、AC-1～AC-5。若规格确认时修改了行为边界，应先复核本 TASK
- **代码基线**：Git HEAD `6dc6d50`；规划时工作区已有未提交改动，含 `src/App.tsx`、`src/App.test.tsx`、`docs/tasks/current.md` 与该未跟踪 Feature Spec。`src/App.css` 当前无未提交改动；实施前重新核对工作区并保护现有改动
- **前置依赖**：确认上述 Feature Spec；既有多标签会话能力已完成，见 `docs/features/multi-tab-session.md`
- **必要上下文**：上述 Feature Spec 的范围、行为规则及验收条件；`docs/ARCHITECTURE.md` 的 React 文档会话边界；`src/App.tsx` 标签渲染、`src/App.css` 标签样式与 `src/App.test.tsx` 现有标签状态测试

## 目标与非目标

使 macOS 暗色模式下的活动标签在静止、悬停、焦点、未保存及交互锁定状态中都能清楚辨认，并保持浅色模式与现有切换、关闭语义。非目标是改动标签布局、会话状态模型、文件操作、编辑器与预览主题，或增加用户主题配置。

## 技术方案

`src/App.tsx` 中每个 `.document-tab` 已根据 `tabSession.activeTabId` 设置唯一 `is-active` 类，选择按钮以 `aria-current="page"` 标识活动项；`src/App.test.tsx` 已覆盖标签切换、关闭、模态锁定以及部分打开/恢复路径。`src/App.css` 的浅色样式以背景和下边框区分标签；暗色媒体查询仅将非活动背景设为 `#2c2824`，活动项沿用 `--surface: #292621`，两者过近。

优先只在 `src/App.css` 现有标签规则和 `@media (prefers-color-scheme: dark)` 中建立更明确的活动表面、边界或强调标识，并让非活动项退后。选中、悬停、键盘焦点和禁用样式应分别可辨，不能让通用 `:disabled` 透明度或悬停背景冲淡活动状态。保留长标题省略、关闭按钮和 `.dirty-dot` 的可读性。具体色值与标识形式由实施者通过真实 macOS 外观验证确定；不要新增 JS 外观状态、持久化、依赖或 Rust 接口。

只有当现有活动类或 `aria-current` 在验证中与编辑内容不一致时，才在同一任务中最小修正 `src/App.tsx` 并补对应 `src/App.test.tsx` 回归；若属于会话模型缺陷，应暂停本视觉任务并单独规划。CSS 视觉效果主要由真实应用目视验收，自动化测试只覆盖可观察的状态和交互，不以测试硬编码色值或复制样式实现。

## 涉及文件

| 路径/符号 | 计划操作和作用 |
| --- | --- |
| `src/App.css`：`.tab-strip`、`.document-tab`、`.document-tab-select`、`.document-tab-close`、`:disabled`、暗色媒体查询 | 调整活动、非活动及交互状态的视觉层级；主要实施文件 |
| `src/App.tsx`：标签渲染与 `aria-current` | 核对状态来源；仅在发现状态不一致时最小修正 |
| `src/App.test.tsx`：多标签与模态相关测试 | 复用现有测试；仅在行为或语义修正时补有意义的断言 |
| `docs/features/dark-mode-active-tab.md`、`docs/tasks/current.md` | 按实际确认与实施结果更新状态和验证事实，不改写需求 |

## 实施步骤

1. 确认 Feature Spec 与本 TASK 的边界；进入实施时先按 `AGENTS.md` 将本任务加入 `docs/tasks/current.md` 并置为唯一“进行中”，填写开始日期和真实进度，然后才修改代码。
2. 核对活动类、`aria-current`、交互锁定与现有 CSS 层叠关系；在现有 CSS 结构内调整暗色标签视觉层级，必要时微调浅色与焦点样式。
3. 执行前端回归与构建，在 macOS 真实应用中逐项检查暗色、浅色和运行中切换外观。对照 AC-1～AC-5 记录实际证据；完成后更新 `current.md` 与规格状态。

## 验收与验证

| 编号 | 关联 SPEC | 可观察结果 | 验证方法与预期 |
| --- | --- | --- | --- |
| T-AC-1 | AC-1、BR-2 | 暗色模式三个以上标签静止并列时，活动项无需悬停即可明确识别，其他项不会被误认 | macOS 真实应用目视；必要，已通过（2026-10-24） |
| T-AC-2 | AC-2、BR-1 | 新建、切换、打开、关闭和恢复后，唯一视觉活动项、`aria-current` 与编辑内容一致 | 既有 `src/App.test.tsx` 回归加真实应用抽查；必要，已通过（2026-10-24） |
| T-AC-3 | AC-3、BR-3～BR-4 | 长名称、脏标记、悬停、键盘焦点及模态锁定时，活动状态和可操作控件仍可辨 | macOS 真实应用目视与键盘操作；必要，已通过（2026-10-24） |
| T-AC-4 | AC-4、FR-3 | 运行时在浅色、暗色之间切换，两种外观都能辨认活动项且切换、关闭语义不变 | macOS 系统外观切换并操作标签；必要，已通过（2026-10-24） |
| T-AC-5 | AC-5 | 相关前端回归与生产构建通过 | 仓库根执行 `npm run check`、`npm run build`、`npm run tauri -- build`；必要，已通过（2026-10-24）；证据见 `RESULT.md` |

完成时另在仓库根执行 `git diff --check`、`git diff --cached --check`，检查 staged、unstaged 和未跟踪文件。以上命令已于 2026-10-24 实际执行并通过，证据见 `RESULT.md`。

## 约束与允许的局部选择

- 使用现有 `prefers-color-scheme` 和 `is-active` 来源，不新增主题状态或改变多标签数据流。
- 保留 `aria-current`、按钮禁用规则、关闭与未保存标记；不得为了颜色对比隐藏或弱化这些信号。
- 允许实施者在现有视觉语言中决定具体色值、边界及强调标识；验收以真实 WebKit/macOS 表现为准。
- 当前 `src/App.tsx` 与 `src/App.test.tsx` 有其他未提交工作，实施前需按差异重新确认，不能覆盖。

## 未决项

Feature Spec 已于 2026-10-24 确认，无阻塞技术决策。
