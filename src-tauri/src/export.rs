//! Export destinations come exclusively from native save panels. Never reuse
//! document-save state or accept an arbitrary output path from the frontend.
use crate::ipc::DocumentStore;
use std::{
    fs::{self, File, OpenOptions},
    io::{Read, Write},
    path::{Path, PathBuf},
    sync::atomic::{AtomicBool, AtomicU64, Ordering},
};
use tauri::{Manager, WebviewWindow};
use tauri_plugin_dialog::DialogExt;

#[derive(Default)]
pub struct ExportState(AtomicBool);
struct ExportGuard<'a>(&'a AtomicBool);
impl Drop for ExportGuard<'_> {
    fn drop(&mut self) {
        self.0.store(false, Ordering::Release);
    }
}
impl ExportState {
    fn begin(&self) -> Result<ExportGuard<'_>, String> {
        self.0
            .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
            .map_err(|_| "Another export is already running".to_string())?;
        Ok(ExportGuard(&self.0))
    }
}
static NEXT_TEMP: AtomicU64 = AtomicU64::new(0);
struct TemporaryExport(PathBuf);
impl Drop for TemporaryExport {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.0);
    }
}
fn temporary_export(target: &Path) -> Result<TemporaryExport, String> {
    let parent = target.parent().ok_or("Output has no parent directory")?;
    for _ in 0..32 {
        let n = NEXT_TEMP.fetch_add(1, Ordering::Relaxed);
        let path = parent.join(format!(".textora-export-{}-{n}.tmp", std::process::id()));
        let mut options = OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        match options.open(&path) {
            Ok(_) => return Ok(TemporaryExport(path)),
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(_) => return Err("Cannot create an export file in this folder".into()),
        }
    }
    Err("Cannot allocate an export file".into())
}
fn validate_target(path: &Path, extension: &str) -> Result<(), String> {
    if !path.is_absolute()
        || !path
            .extension()
            .is_some_and(|ext| ext.eq_ignore_ascii_case(extension))
    {
        return Err(format!("Choose a .{extension} filename"));
    }
    if path.is_dir() {
        return Err("The output must be a file".into());
    }
    Ok(())
}
fn commit_export(temp: &TemporaryExport, target: &Path, signature: &[u8]) -> Result<(), String> {
    let mut file = File::open(&temp.0).map_err(|_| "Export output is missing")?;
    let mut header = vec![0; signature.len()];
    file.read_exact(&mut header)
        .map_err(|_| "Export output is incomplete")?;
    if header != signature {
        return Err("Export output has an invalid format".into());
    }
    file.sync_all()
        .map_err(|_| "Cannot synchronize export output")?;
    fs::rename(&temp.0, target)
        .map_err(|_| "Cannot save export to the selected location".to_string())
}
fn choose_target(
    window: &WebviewWindow,
    file_name: &str,
    extension: &str,
) -> Result<Option<PathBuf>, String> {
    if window.label() != "main" {
        return Err("Export is only available in the main window".into());
    }
    let suggested = Path::new(file_name)
        .file_name()
        .and_then(|x| x.to_str())
        .unwrap_or("Document");
    let selected = window
        .app_handle()
        .dialog()
        .file()
        .set_parent(window)
        .set_title(format!("Export {}", extension.to_uppercase()))
        .set_file_name(suggested)
        .add_filter(extension.to_uppercase(), &[extension])
        .blocking_save_file();
    let Some(selected) = selected else {
        return Ok(None);
    };
    let path = selected
        .into_path()
        .map_err(|_| "The selected location is unavailable")?;
    validate_target(&path, extension)?;
    Ok(Some(path))
}

#[tauri::command]
pub async fn export_markdown_pdf(
    window: WebviewWindow,
    file_name: String,
    exports: tauri::State<'_, ExportState>,
    documents: tauri::State<'_, DocumentStore>,
) -> Result<bool, String> {
    let _guard = exports.begin()?;
    let Some(target) = choose_target(&window, &file_name, "pdf")? else {
        return Ok(false);
    };
    documents.ensure_export_target_available(&target)?;
    let temp = temporary_export(&target)?;
    let output = temp.0.clone();
    let (send, mut receive) = tauri::async_runtime::channel(1);
    window
        .with_webview(move |view| {
            #[cfg(target_os = "macos")]
            let result = unsafe { print_pdf(view.inner(), &output, send.clone()) };
            #[cfg(not(target_os = "macos"))]
            let result: Result<(), String> = Err("PDF export requires macOS".into());
            if let Err(error) = result {
                let _ = send.try_send(Err(error));
            }
        })
        .map_err(|_| "The print view is unavailable")?;
    receive.recv().await.ok_or("The print view was closed")??;
    documents.ensure_export_target_available(&target)?;
    commit_export(&temp, &target, b"%PDF-")?;
    Ok(true)
}

#[tauri::command]
pub async fn export_markdown_docx(
    window: WebviewWindow,
    request: tauri::ipc::Request<'_>,
    exports: tauri::State<'_, ExportState>,
    documents: tauri::State<'_, DocumentStore>,
) -> Result<bool, String> {
    let _guard = exports.begin()?;
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
        return Err("Word export requires binary content".into());
    };
    validate_docx_bytes(bytes)?;
    let encoded = request
        .headers()
        .get("textora-export-filename")
        .and_then(|value| value.to_str().ok())
        .filter(|value| value.len() <= 2048)
        .ok_or("Invalid output filename")?;
    let file_name = percent_encoding::percent_decode_str(encoded)
        .decode_utf8()
        .map_err(|_| "Invalid output filename")?;
    let Some(target) = choose_target(&window, &file_name, "docx")? else {
        return Ok(false);
    };
    documents.ensure_export_target_available(&target)?;
    let temp = temporary_export(&target)?;
    let mut file = OpenOptions::new()
        .write(true)
        .truncate(true)
        .open(&temp.0)
        .map_err(|_| "Cannot create Word export")?;
    file.write_all(bytes)
        .map_err(|_| "Cannot write Word export")?;
    file.sync_all()
        .map_err(|_| "Cannot synchronize Word export")?;
    drop(file);
    documents.ensure_export_target_available(&target)?;
    commit_export(&temp, &target, b"PK\x03\x04")?;
    Ok(true)
}
fn validate_docx_bytes(bytes: &[u8]) -> Result<(), String> {
    if bytes.len() > 100 * 1024 * 1024 {
        return Err("Word export exceeds the 100 MiB output limit".into());
    }
    if !bytes.starts_with(b"PK\x03\x04") || bytes.len() < 22 {
        return Err("Invalid Word export content".into());
    }
    Ok(())
}

#[cfg(target_os = "macos")]
mod native_print {
    use objc2::{
        DefinedClass, MainThreadOnly, define_class, msg_send, rc::Retained, runtime::Bool,
    };
    use objc2_foundation::{MainThreadMarker, NSObject, NSObjectProtocol};
    use std::cell::RefCell;
    pub struct PrintIvars {
        pub sender: RefCell<Option<tauri::async_runtime::Sender<Result<(), String>>>>,
    }
    define_class!(
        #[unsafe(super = NSObject)]
        #[thread_kind = MainThreadOnly]
        #[ivars = PrintIvars]
        pub struct PrintDelegate;
        unsafe impl NSObjectProtocol for PrintDelegate {}
        impl PrintDelegate {
            #[unsafe(method(textoraPrintOperation:didRun:contextInfo:))]
            fn finished(&self, _operation: &objc2_app_kit::NSPrintOperation, success: Bool, context: *mut std::ffi::c_void) {
                if let Some(sender) = self.ivars().sender.borrow_mut().take() {
                    let result = if success.as_bool() { Ok(()) } else { Err("PDF generation was cancelled or failed".into()) };
                    let _ = sender.try_send(result);
                }
                // Balance the retained context handed to AppKit. The native
                // delegate is deliberately kept alive until this callback.
                unsafe { drop(Retained::from_raw(context.cast::<PrintDelegate>())); }
            }
        }
    );
    impl PrintDelegate {
        pub fn new(
            mtm: MainThreadMarker,
            sender: tauri::async_runtime::Sender<Result<(), String>>,
        ) -> Retained<Self> {
            let this = Self::alloc(mtm).set_ivars(PrintIvars {
                sender: RefCell::new(Some(sender)),
            });
            unsafe { msg_send![super(this), init] }
        }
    }
}

#[cfg(target_os = "macos")]
unsafe fn print_pdf(
    view: *mut std::ffi::c_void,
    target: &Path,
    sender: tauri::async_runtime::Sender<Result<(), String>>,
) -> Result<(), String> {
    use objc2::{
        msg_send,
        rc::Retained,
        runtime::{AnyObject, ProtocolObject},
        sel,
    };
    use objc2_app_kit::{
        NSPrintInfo, NSPrintJobSavingURL, NSPrintOperation, NSPrintSaveJob,
        NSPrintingPaginationMode, NSWindow,
    };
    use objc2_foundation::{MainThreadMarker, NSCopying, NSSize, NSString, NSURL};
    unsafe {
        let mtm = MainThreadMarker::new().ok_or("Printing requires the main thread")?;
        let info = NSPrintInfo::sharedPrintInfo().copy();
        info.setPaperSize(NSSize::new(595.28, 841.89));
        info.setTopMargin(36.0);
        info.setBottomMargin(36.0);
        info.setLeftMargin(36.0);
        info.setRightMargin(36.0);
        info.setHorizontallyCentered(false);
        info.setVerticallyCentered(false);
        info.setHorizontalPagination(NSPrintingPaginationMode::Fit);
        info.setJobDisposition(NSPrintSaveJob);
        let url = NSURL::fileURLWithPath(&NSString::from_str(
            target.to_str().ok_or("Invalid output path")?,
        ));
        info.dictionary()
            .setObject_forKey(url.as_ref(), ProtocolObject::from_ref(NSPrintJobSavingURL));
        let webview = &*(view as *const AnyObject);
        let window: Option<Retained<NSWindow>> = msg_send![webview, window];
        let window = window.ok_or("The print window is unavailable")?;
        let operation: Retained<NSPrintOperation> =
            msg_send![webview, printOperationWithPrintInfo: &*info];
        operation.setShowsPrintPanel(false);
        operation.setShowsProgressPanel(false);
        operation.setCanSpawnSeparateThread(true);
        let delegate = Retained::into_raw(native_print::PrintDelegate::new(mtm, sender));
        operation.runOperationModalForWindow_delegate_didRunSelector_contextInfo(
            &window,
            Some(&*delegate),
            Some(sel!(textoraPrintOperation:didRun:contextInfo:)),
            delegate.cast(),
        );
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn dir() -> PathBuf {
        let path = std::env::temp_dir().join(format!(
            "textora-export-test-{}-{}",
            std::process::id(),
            NEXT_TEMP.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir(&path).unwrap();
        path
    }
    #[test]
    fn word_export_requires_bounded_zip_bytes() {
        assert!(validate_docx_bytes(b"not a document").is_err());
        assert!(validate_docx_bytes(b"PK\x03\x04").is_err());
        let mut zip = vec![0u8; 22];
        zip[..4].copy_from_slice(b"PK\x03\x04");
        assert!(validate_docx_bytes(&zip).is_ok());
    }
    #[test]
    fn validates_extensions_and_absolute_paths() {
        assert!(validate_target(Path::new("/tmp/report.pdf"), "pdf").is_ok());
        assert!(validate_target(Path::new("/tmp/report.PDF"), "pdf").is_ok());
        assert!(validate_target(Path::new("report.pdf"), "pdf").is_err());
        assert!(validate_target(Path::new("/tmp/report.md"), "pdf").is_err());
    }
    #[test]
    fn invalid_output_preserves_existing_target_and_cleans_temp() {
        let dir = dir();
        let target = dir.join("report.pdf");
        fs::write(&target, b"original").unwrap();
        let path;
        {
            let temp = temporary_export(&target).unwrap();
            path = temp.0.clone();
            fs::write(&temp.0, b"wrong").unwrap();
            assert!(commit_export(&temp, &target, b"%PDF-").is_err());
        }
        assert_eq!(fs::read(&target).unwrap(), b"original");
        assert!(!path.exists());
        fs::remove_dir_all(dir).unwrap();
    }
    #[test]
    fn successful_output_atomically_replaces_target() {
        let dir = dir();
        let target = dir.join("report.pdf");
        fs::write(&target, b"original").unwrap();
        let temp = temporary_export(&target).unwrap();
        fs::write(&temp.0, b"%PDF-new").unwrap();
        commit_export(&temp, &target, b"%PDF-").unwrap();
        assert_eq!(fs::read(&target).unwrap(), b"%PDF-new");
        fs::remove_dir_all(dir).unwrap();
    }
    #[test]
    fn duplicate_export_is_rejected_and_guard_is_released() {
        let state = ExportState::default();
        {
            let _guard = state.begin().unwrap();
            assert!(state.begin().is_err());
        }
        assert!(state.begin().is_ok());
    }
}
