//! 已打开文档的外部文件变化监听。
//!
//! 监听器只接收 [`DocumentStore`] 已建立的可信路径，并监听其父目录以覆盖编辑器常见的
//! “写临时文件后原子替换”保存方式。原始文件事件只作为复核提示；真正的变化分类仍由
//! 文档核心重新读取并校验，前端不会收到路径。

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, mpsc};
use std::time::Duration;

use notify::{RecommendedWatcher, RecursiveMode, Watcher};
use tauri::{AppHandle, Emitter, Manager};

use crate::ipc::DocumentStore;

pub const EXTERNAL_DOCUMENT_CHANGED_EVENT: &str = "textora-external-document-changed";

#[derive(Default)]
struct WatchedPaths {
    documents: HashMap<String, HashSet<PathBuf>>,
    directory_references: HashMap<PathBuf, usize>,
}

impl WatchedPaths {
    fn document_ids(&self) -> Vec<String> {
        self.documents.keys().cloned().collect()
    }
}

pub struct ExternalWatchService {
    watcher: Mutex<RecommendedWatcher>,
    paths: Arc<Mutex<WatchedPaths>>,
}

impl ExternalWatchService {
    pub fn new(app: AppHandle) -> notify::Result<Self> {
        let paths = Arc::new(Mutex::new(WatchedPaths::default()));
        let worker_paths = Arc::clone(&paths);
        let (event_tx, event_rx) = mpsc::channel::<()>();
        let watcher = notify::recommended_watcher(move |event: notify::Result<notify::Event>| {
            if event.is_ok() {
                let _ = event_tx.send(());
            }
        })?;

        std::thread::Builder::new()
            .name("textora-external-watch".to_owned())
            .spawn(move || {
                while event_rx.recv().is_ok() {
                    // 同一次外部保存通常产生多条 create/write/rename 事件；短暂归并后只复核一次。
                    while event_rx.recv_timeout(Duration::from_millis(120)).is_ok() {}
                    let ids = worker_paths
                        .lock()
                        .expect("external watch paths lock poisoned")
                        .document_ids();
                    let store = app.state::<DocumentStore>();
                    for document_id in ids {
                        if let Some(change) = store.external_change_signal(&document_id) {
                            let _ = app.emit(EXTERNAL_DOCUMENT_CHANGED_EVENT, change);
                        }
                    }
                }
            })
            .expect("failed to start external file watcher thread");

        Ok(Self {
            watcher: Mutex::new(watcher),
            paths,
        })
    }

    /// 关联或重关联文档。监听父目录而不是单个 inode，确保原子替换后继续收到事件。
    pub fn associate(&self, document_id: &str, path: &Path) {
        let mut desired_directories = HashSet::new();
        if let Some(directory) = path.parent() {
            desired_directories.insert(directory.to_path_buf());
        }
        if let Ok(resolved) = std::fs::canonicalize(path)
            && let Some(directory) = resolved.parent()
        {
            desired_directories.insert(directory.to_path_buf());
        }
        if desired_directories.is_empty() {
            return;
        }
        let mut paths = self
            .paths
            .lock()
            .expect("external watch paths lock poisoned");
        let previous = paths.documents.remove(document_id).unwrap_or_default();
        if previous == desired_directories {
            paths.documents.insert(document_id.to_owned(), previous);
            return;
        }

        let mut watcher = self.watcher.lock().expect("external watcher lock poisoned");
        for directory in previous.difference(&desired_directories) {
            Self::release_directory(&mut paths, &mut watcher, directory);
        }

        let mut accepted = previous
            .intersection(&desired_directories)
            .cloned()
            .collect::<HashSet<_>>();
        for directory in desired_directories.difference(&previous) {
            let references = paths
                .directory_references
                .entry(directory.clone())
                .or_default();
            if *references == 0
                && watcher
                    .watch(directory, RecursiveMode::NonRecursive)
                    .is_err()
            {
                paths.directory_references.remove(directory);
                continue;
            }
            *references += 1;
            accepted.insert(directory.clone());
        }
        if !accepted.is_empty() {
            paths.documents.insert(document_id.to_owned(), accepted);
        }
    }

    pub fn remove(&self, document_id: &str) {
        let mut paths = self
            .paths
            .lock()
            .expect("external watch paths lock poisoned");
        let Some(directories) = paths.documents.remove(document_id) else {
            return;
        };
        let mut watcher = self.watcher.lock().expect("external watcher lock poisoned");
        for directory in directories {
            Self::release_directory(&mut paths, &mut watcher, &directory);
        }
    }

    fn release_directory(
        paths: &mut WatchedPaths,
        watcher: &mut RecommendedWatcher,
        directory: &Path,
    ) {
        let Some(references) = paths.directory_references.get_mut(directory) else {
            return;
        };
        *references -= 1;
        if *references == 0 {
            paths.directory_references.remove(directory);
            let _ = watcher.unwatch(directory);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn document_ids_are_unique_even_when_documents_share_a_directory() {
        let mut paths = WatchedPaths::default();
        paths
            .documents
            .insert("a".to_owned(), HashSet::from([PathBuf::from("/tmp")]));
        paths
            .documents
            .insert("b".to_owned(), HashSet::from([PathBuf::from("/tmp")]));
        assert_eq!(
            paths
                .document_ids()
                .into_iter()
                .collect::<HashSet<_>>()
                .len(),
            2
        );
    }
}
