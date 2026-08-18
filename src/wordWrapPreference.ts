const WORD_WRAP_STORAGE_KEY = "textora.wordWrapEnabled";

/**
 * 同步读取软换行偏好：`localStorage` 键 `textora.wordWrapEnabled` 只接受 `"true"` /
 * `"false"`；缺失、值无效或读取抛错都回退为开启（保持现有行为）。必须在首次渲染的
 * 状态初始化阶段调用，使首个 CodeMirror 实例直接取得正确值，不先按默认值挂载再闪切。
 */
export function readStoredWordWrapPreference(): boolean {
  try {
    return window.localStorage.getItem(WORD_WRAP_STORAGE_KEY) !== "false";
  } catch {
    return true;
  }
}

/** best-effort 持久化偏好：写入失败时当前会话继续使用该值，仅下次启动可能回退。 */
export function persistWordWrapPreference(enabled: boolean): void {
  try {
    window.localStorage.setItem(
      WORD_WRAP_STORAGE_KEY,
      enabled ? "true" : "false",
    );
  } catch {
    // 忽略写入失败，不阻止编辑或改变会话状态。
  }
}
