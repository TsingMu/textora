//! 启动文件恢复清单的版本化、校验与原子持久化契约。
//!
//! 本模块只管理应用自有的最小路径清单，不读取用户文件，也不接受前端路径。路径必须由
//! [`crate::ipc::DocumentStore`] 的可信活动文档投影产生；启动采用留给后续垂直切片。

use std::collections::HashSet;
use std::fs::{File, OpenOptions};
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::sync::atomic::{AtomicU64, Ordering};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, Runtime};

const MANIFEST_VERSION: u32 = 1;
const MANIFEST_FILE_NAME: &str = "open-files-session.json";
const MAX_RESTORABLE_FILES: usize = 1_024;
static NEXT_TEMP_TAG: AtomicU64 = AtomicU64::new(1);

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RestoreManifest {
    version: u32,
    files: Vec<PathBuf>,
    #[serde(skip_serializing_if = "Option::is_none")]
    active_index: Option<usize>,
}

impl RestoreManifest {
    pub(crate) fn new(
        files: Vec<PathBuf>,
        active_index: Option<usize>,
    ) -> Result<Self, ManifestValidationError> {
        let manifest = Self {
            version: MANIFEST_VERSION,
            files,
            active_index,
        };
        manifest.validate()?;
        Ok(manifest)
    }

    pub(crate) fn files(&self) -> &[PathBuf] {
        &self.files
    }

    pub(crate) fn active_index(&self) -> Option<usize> {
        self.active_index
    }

    fn validate(&self) -> Result<(), ManifestValidationError> {
        if self.version != MANIFEST_VERSION {
            return Err(ManifestValidationError::UnsupportedVersion);
        }
        if self.files.len() > MAX_RESTORABLE_FILES {
            return Err(ManifestValidationError::TooManyFiles);
        }
        if self
            .active_index
            .is_some_and(|index| index >= self.files.len())
        {
            return Err(ManifestValidationError::InvalidActiveIndex);
        }

        let mut unique = HashSet::with_capacity(self.files.len());
        for path in &self.files {
            if !path.is_absolute() {
                return Err(ManifestValidationError::NonAbsolutePath);
            }
            if !unique.insert(path.clone()) {
                return Err(ManifestValidationError::DuplicatePath);
            }
        }
        Ok(())
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum ManifestValidationError {
    UnsupportedVersion,
    TooManyFiles,
    InvalidActiveIndex,
    NonAbsolutePath,
    DuplicatePath,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum ManifestProjectionError {
    UnknownDocument,
    DuplicateDocumentId,
    ActiveDocumentNotInList,
    InvalidManifest(ManifestValidationError),
}

/// 各变体载荷仅供诊断；错误以整体被匹配，不向外读取字段内容。
#[derive(Debug)]
pub(crate) enum ManifestStoreError {
    Io(#[allow(dead_code)] io::Error),
    Serialize(#[allow(dead_code)] serde_json::Error),
    Invalid(#[allow(dead_code)] ManifestValidationError),
    AppDataDirectoryUnavailable,
}

impl From<io::Error> for ManifestStoreError {
    fn from(value: io::Error) -> Self {
        Self::Io(value)
    }
}

impl From<serde_json::Error> for ManifestStoreError {
    fn from(value: serde_json::Error) -> Self {
        Self::Serialize(value)
    }
}

impl From<ManifestValidationError> for ManifestStoreError {
    fn from(value: ManifestValidationError) -> Self {
        Self::Invalid(value)
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum ManifestLoadOutcome {
    Missing,
    Ready(RestoreManifest),
    Invalid,
    ReadFailed,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum ManifestUpdateOutcome {
    Written,
    Stale,
}

/// 持有单个进程内的 generation 门禁。锁覆盖完整写入过程，使并发调用无论取得锁的
/// 顺序如何，都只有最大的已成功 generation 能继续覆盖磁盘。
pub(crate) struct SessionManifestStore {
    path: PathBuf,
    last_generation: Mutex<u64>,
}

impl SessionManifestStore {
    pub(crate) fn from_app<R: Runtime>(app: &AppHandle<R>) -> Result<Self, ManifestStoreError> {
        let directory = app
            .path()
            .app_data_dir()
            .map_err(|_| ManifestStoreError::AppDataDirectoryUnavailable)?;
        Ok(Self::at_path(directory.join(MANIFEST_FILE_NAME)))
    }

    pub(crate) fn at_path(path: PathBuf) -> Self {
        Self {
            path,
            last_generation: Mutex::new(0),
        }
    }

    pub(crate) fn load(&self) -> ManifestLoadOutcome {
        load_manifest(&self.path)
    }

    pub(crate) fn update(
        &self,
        generation: u64,
        manifest: &RestoreManifest,
    ) -> Result<ManifestUpdateOutcome, ManifestStoreError> {
        self.update_with_hook(generation, manifest, || Ok(()))
    }

    fn update_with_hook<F>(
        &self,
        generation: u64,
        manifest: &RestoreManifest,
        before_replace: F,
    ) -> Result<ManifestUpdateOutcome, ManifestStoreError>
    where
        F: FnOnce() -> io::Result<()>,
    {
        manifest.validate()?;
        let mut last_generation = self
            .last_generation
            .lock()
            .expect("session manifest generation lock poisoned");
        if generation <= *last_generation {
            return Ok(ManifestUpdateOutcome::Stale);
        }

        write_manifest_atomically(&self.path, manifest, before_replace)?;
        *last_generation = generation;
        Ok(ManifestUpdateOutcome::Written)
    }
}

fn load_manifest(path: &Path) -> ManifestLoadOutcome {
    let bytes = match std::fs::read(path) {
        Ok(bytes) => bytes,
        Err(error) if error.kind() == io::ErrorKind::NotFound => {
            return ManifestLoadOutcome::Missing;
        }
        Err(_) => return ManifestLoadOutcome::ReadFailed,
    };
    if bytes.is_empty() {
        return ManifestLoadOutcome::Invalid;
    }
    let manifest = match serde_json::from_slice::<RestoreManifest>(&bytes) {
        Ok(manifest) => manifest,
        Err(_) => return ManifestLoadOutcome::Invalid,
    };
    match manifest.validate() {
        Ok(()) => ManifestLoadOutcome::Ready(manifest),
        Err(_) => ManifestLoadOutcome::Invalid,
    }
}

fn write_manifest_atomically<F>(
    target: &Path,
    manifest: &RestoreManifest,
    before_replace: F,
) -> Result<(), ManifestStoreError>
where
    F: FnOnce() -> io::Result<()>,
{
    let parent = target.parent().unwrap_or_else(|| Path::new("."));
    std::fs::create_dir_all(parent)?;
    let bytes = serde_json::to_vec(manifest)?;
    let (temp_path, mut file) = create_temp_exclusive(parent, target)?;

    let result = (|| -> Result<(), ManifestStoreError> {
        file.write_all(&bytes)?;
        file.sync_all()?;
        drop(file);
        before_replace()?;
        std::fs::rename(&temp_path, target)?;
        // macOS 支持目录 sync；此处为 best-effort，因为 rename 已经原子提交，目录 sync
        // 失败时不能安全回滚到旧清单。
        if let Ok(directory) = File::open(parent) {
            let _ = directory.sync_all();
        }
        Ok(())
    })();

    if result.is_err() {
        let _ = std::fs::remove_file(&temp_path);
    }
    result
}

fn create_temp_exclusive(parent: &Path, target: &Path) -> io::Result<(PathBuf, File)> {
    loop {
        let file_name = target
            .file_name()
            .map(|name| name.to_string_lossy().into_owned())
            .unwrap_or_else(|| "session".to_owned());
        let tag = NEXT_TEMP_TAG.fetch_add(1, Ordering::Relaxed);
        let temp_path = parent.join(format!(
            ".{file_name}.textora-session.{}.{tag}.tmp",
            std::process::id()
        ));
        match OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temp_path)
        {
            Ok(file) => return Ok((temp_path, file)),
            Err(error) if error.kind() == io::ErrorKind::AlreadyExists => continue,
            Err(error) => return Err(error),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::document::test_support::TestDir;

    fn absolute_file(dir: &TestDir, name: &str) -> PathBuf {
        dir.join(name)
    }

    fn manifest(dir: &TestDir) -> RestoreManifest {
        RestoreManifest::new(
            vec![absolute_file(dir, "a.txt"), absolute_file(dir, "b.md")],
            Some(1),
        )
        .expect("valid manifest")
    }

    #[test]
    fn writes_and_loads_a_versioned_manifest_in_order() {
        let dir = TestDir::new();
        let store = SessionManifestStore::at_path(dir.join("state/session.json"));
        let expected = manifest(&dir);

        assert_eq!(
            store.update(1, &expected).expect("persist manifest"),
            ManifestUpdateOutcome::Written
        );
        assert_eq!(store.load(), ManifestLoadOutcome::Ready(expected));
    }

    #[test]
    fn rejects_stale_and_duplicate_generations_without_overwriting() {
        let dir = TestDir::new();
        let store = SessionManifestStore::at_path(dir.join("session.json"));
        let newest = manifest(&dir);
        let older = RestoreManifest::new(vec![absolute_file(&dir, "old.txt")], Some(0))
            .expect("valid old manifest");

        assert_eq!(
            store.update(8, &newest).expect("write newest"),
            ManifestUpdateOutcome::Written
        );
        assert_eq!(
            store.update(7, &older).expect("reject older"),
            ManifestUpdateOutcome::Stale
        );
        assert_eq!(
            store.update(8, &older).expect("reject duplicate"),
            ManifestUpdateOutcome::Stale
        );
        assert_eq!(store.load(), ManifestLoadOutcome::Ready(newest));
    }

    #[test]
    fn failed_replace_preserves_previous_manifest_and_cleans_temp_file() {
        let dir = TestDir::new();
        let path = dir.join("session.json");
        let store = SessionManifestStore::at_path(path.clone());
        let previous = manifest(&dir);
        store.update(1, &previous).expect("write previous");
        let replacement = RestoreManifest::new(vec![absolute_file(&dir, "new.txt")], Some(0))
            .expect("valid replacement");

        let error = store
            .update_with_hook(2, &replacement, || {
                Err(io::Error::other("simulated replace failure"))
            })
            .expect_err("replace must fail");
        assert!(matches!(error, ManifestStoreError::Io(_)));
        assert_eq!(store.load(), ManifestLoadOutcome::Ready(previous));
        let entries = std::fs::read_dir(dir.path())
            .expect("read temp directory")
            .map(|entry| entry.expect("directory entry").file_name())
            .collect::<Vec<_>>();
        assert_eq!(entries, vec![path.file_name().expect("manifest name")]);

        // 失败 generation 不被消费，同一 generation 可在重试时成功。
        assert_eq!(
            store.update(2, &replacement).expect("retry replacement"),
            ManifestUpdateOutcome::Written
        );
    }

    #[test]
    fn missing_empty_corrupt_and_unknown_versions_fall_back_safely() {
        let dir = TestDir::new();
        let path = dir.join("session.json");
        let store = SessionManifestStore::at_path(path.clone());
        assert_eq!(store.load(), ManifestLoadOutcome::Missing);

        std::fs::write(&path, b"").expect("write empty manifest");
        assert_eq!(store.load(), ManifestLoadOutcome::Invalid);
        std::fs::write(&path, b"{not-json").expect("write corrupt manifest");
        assert_eq!(store.load(), ManifestLoadOutcome::Invalid);
        std::fs::write(&path, br#"{"version":99,"files":[]}"#).expect("write unknown version");
        assert_eq!(store.load(), ManifestLoadOutcome::Invalid);
    }

    #[test]
    fn validates_active_index_absolute_paths_and_duplicates() {
        let dir = TestDir::new();
        assert_eq!(
            RestoreManifest::new(vec![absolute_file(&dir, "a")], Some(1)),
            Err(ManifestValidationError::InvalidActiveIndex)
        );
        assert_eq!(
            RestoreManifest::new(vec![PathBuf::from("relative.txt")], None),
            Err(ManifestValidationError::NonAbsolutePath)
        );
        let path = absolute_file(&dir, "same.txt");
        assert_eq!(
            RestoreManifest::new(vec![path.clone(), path], None),
            Err(ManifestValidationError::DuplicatePath)
        );
    }
}
