//! 仅供测试共享的进程级唯一临时目录。

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

/// 进程级唯一临时目录。
///
/// 名称包含 PID、纳秒时间戳与进程内单调序号，避免多个 `cargo test` 进程并发时互相
/// 冲突（仅用进程内序号会在跨进程时撞名）。`Drop` 时递归清理目录。
pub(crate) struct TestDir {
    path: PathBuf,
}

impl TestDir {
    pub(crate) fn new() -> Self {
        static SEQ: AtomicU64 = AtomicU64::new(0);
        let seq = SEQ.fetch_add(1, Ordering::Relaxed);
        let pid = std::process::id();
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|duration| duration.as_nanos() as u64)
            .unwrap_or(0);
        let path = std::env::temp_dir().join(format!("textora-tests-{pid}-{nanos}-{seq}"));
        std::fs::create_dir_all(&path).expect("create test temp dir");
        TestDir { path }
    }

    pub(crate) fn path(&self) -> &Path {
        &self.path
    }

    pub(crate) fn join(&self, name: &str) -> PathBuf {
        self.path.join(name)
    }
}

impl Default for TestDir {
    fn default() -> Self {
        Self::new()
    }
}

impl Drop for TestDir {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.path);
    }
}
