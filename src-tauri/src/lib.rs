use base64::Engine;
use rand::Rng;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::io::{Read, Write};
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::Manager;
use tauri_plugin_dialog::DialogExt;

/// Debug logging macro — only prints in debug builds
macro_rules! dbg_log {
    ($($arg:tt)*) => {
        if cfg!(debug_assertions) {
            eprintln!("[auradeck] {}", format!($($arg)*))
        }
    };
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const GLOBAL_CSS_START: &str = "/* === AURADECK GLOBAL CSS === */";
const GLOBAL_CSS_END: &str = "/* === END GLOBAL CSS === */";

const DEFAULT_SLIDE_HTML: &str = r#"<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Slide - Title</title>
<style>
  *, *::before, *::after { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { width: 100%; height: 100%; overflow: hidden; background: #0f0c29; }
  .slide {
    width: 100vw; height: 100vh;
    overflow: hidden; font-family: 'Segoe UI', system-ui, sans-serif;
    color: #fff; display: flex; flex-direction: column;
    align-items: center; justify-content: center; text-align: center;
  }
  h1 { font-size: 5vmin; font-weight: 700; }
  p.subtitle { font-size: 2.4vmin; color: #aaa; margin-top: 2vmin; }
</style>
</head>
<body>
<div class="slide">
  <h1>New Presentation</h1>
  <p class="subtitle">Click to edit</p>
</div>
</body>
</html>"#;

// ---------------------------------------------------------------------------
// Data types
// ---------------------------------------------------------------------------

/// Presentation source — either a folder on disk or an in-memory zip
enum PresentationSource {
    Folder(PathBuf),
    Zip {
        path: PathBuf,
        files: HashMap<String, Vec<u8>>,
    },
}

struct AppState {
    source: Option<PresentationSource>,
    manifest: Option<Manifest>,
    is_scratch: bool,
}

#[derive(Clone, Deserialize, Serialize)]
struct RecentEntry {
    path: String,
    title: String,
    last_opened: String,
}

impl Default for AppState {
    fn default() -> Self {
        Self {
            source: None,
            manifest: None,
            is_scratch: false,
        }
    }
}

impl AppState {
    fn loaded_mut(&mut self) -> Result<(&mut PresentationSource, &mut Manifest), String> {
        match (&mut self.source, &mut self.manifest) {
            (Some(s), Some(m)) => Ok((s, m)),
            _ => Err("No presentation loaded".to_string()),
        }
    }
}

#[derive(Clone, Deserialize, Serialize)]
struct Manifest {
    #[serde(default = "default_version")]
    version: String,
    title: String,
    author: Author,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    created: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    modified: Option<String>,
    description: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    tags: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    aspect_ratio: Option<String>,
    slides: Vec<SlideEntry>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    theme: Option<Theme>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    images: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    global_css: Option<String>,
}

fn default_version() -> String {
    "1.0.0".to_string()
}

#[derive(Clone, Deserialize, Serialize)]
struct Author {
    name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    email: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    url: Option<String>,
}

#[derive(Clone, Deserialize, Serialize)]
struct SlideEntry {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    index: Option<usize>,
    file: String,
    title: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    notes: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    transition: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    duration_seconds: Option<f64>,
}

#[derive(Clone, Deserialize, Serialize)]
struct Theme {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    background: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    foreground: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    accent: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    secondary: Option<String>,
}

#[derive(Serialize)]
struct PresentationInfo {
    title: String,
    author: String,
    description: String,
    total_slides: usize,
    theme: Option<Theme>,
}

#[derive(Serialize)]
struct SlideInfo {
    title: String,
    notes: Option<String>,
    transition: Option<String>,
}

#[derive(Serialize)]
struct SlideRawInfo {
    html: String,
    global_css: String,
    title: String,
    notes: Option<String>,
    transition: Option<String>,
}

// ---------------------------------------------------------------------------
// File I/O helpers
// ---------------------------------------------------------------------------

/// Read a file from the presentation source
fn read_file(source: &PresentationSource, name: &str) -> Result<Vec<u8>, String> {
    match source {
        PresentationSource::Folder(folder) => {
            let path = folder.join(name);
            std::fs::read(&path).map_err(|e| format!("Failed to read {}: {}", path.display(), e))
        }
        PresentationSource::Zip { files, .. } => {
            let normalized = name.strip_prefix("./").unwrap_or(name);
            files
                .get(normalized)
                .or_else(|| files.get(&format!("./{}", normalized)))
                .cloned()
                .ok_or_else(|| format!("File not found in archive: {}", name))
        }
    }
}

/// Read a text file from the presentation source
fn read_file_string(source: &PresentationSource, name: &str) -> Result<String, String> {
    let bytes = read_file(source, name)?;
    String::from_utf8(bytes).map_err(|e| format!("Invalid UTF-8 in {}: {}", name, e))
}

/// Write a file to the presentation source
fn write_file(source: &mut PresentationSource, name: &str, data: &[u8]) -> Result<(), String> {
    match source {
        PresentationSource::Folder(folder) => {
            let path = folder.join(name);
            if let Some(parent) = path.parent() {
                std::fs::create_dir_all(parent)
                    .map_err(|e| format!("Failed to create directory: {}", e))?;
            }
            std::fs::write(&path, data)
                .map_err(|e| format!("Failed to write {}: {}", path.display(), e))
        }
        PresentationSource::Zip { files, .. } => {
            let normalized = name.strip_prefix("./").unwrap_or(name);
            files.insert(normalized.to_string(), data.to_vec());
            Ok(())
        }
    }
}

/// Write a text file to the presentation source
fn write_file_string(
    source: &mut PresentationSource,
    name: &str,
    content: &str,
) -> Result<(), String> {
    write_file(source, name, content.as_bytes())
}

/// Delete a file from the presentation source
fn delete_file_from_source(source: &mut PresentationSource, name: &str) -> Result<(), String> {
    match source {
        PresentationSource::Folder(folder) => {
            let path = folder.join(name);
            if path.exists() {
                std::fs::remove_file(&path)
                    .map_err(|e| format!("Failed to delete {}: {}", path.display(), e))
            } else {
                Ok(())
            }
        }
        PresentationSource::Zip { files, .. } => {
            let normalized = name.strip_prefix("./").unwrap_or(name);
            files.remove(normalized);
            files.remove(&format!("./{}", normalized));
            Ok(())
        }
    }
}

/// Generate a random 8-character alphanumeric filename for slides
fn generate_slide_filename() -> String {
    let mut rng = rand::thread_rng();
    let chars: &[u8] = b"abcdefghijklmnopqrstuvwxyz0123456789";
    let name: String = (0..8)
        .map(|_| chars[rng.gen_range(0..36)] as char)
        .collect();
    format!("{}.html", name)
}

/// Serialize and write manifest.json to the source
fn save_manifest_to_source(
    source: &mut PresentationSource,
    manifest: &Manifest,
) -> Result<(), String> {
    let json = serde_json::to_string_pretty(manifest)
        .map_err(|e| format!("Failed to serialize manifest: {}", e))?;
    write_file_string(source, "manifest.json", &json)
}

// ---------------------------------------------------------------------------
// Recent files persistence
// ---------------------------------------------------------------------------

fn recent_files_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to resolve app data dir: {}", e))?;
    std::fs::create_dir_all(&dir)
        .map_err(|e| format!("Failed to create app data dir: {}", e))?;
    Ok(dir.join("recent_files.json"))
}

fn load_recent_entries(app: &tauri::AppHandle) -> Vec<RecentEntry> {
    let path = match recent_files_path(app) {
        Ok(p) => p,
        Err(_) => return vec![],
    };
    let bytes = match std::fs::read(&path) {
        Ok(b) => b,
        Err(_) => return vec![],
    };
    serde_json::from_slice(&bytes).unwrap_or_default()
}

fn save_recent_entries(app: &tauri::AppHandle, entries: &[RecentEntry]) -> Result<(), String> {
    let path = recent_files_path(app)?;
    let json =
        serde_json::to_string_pretty(entries).map_err(|e| format!("Serialize error: {}", e))?;
    std::fs::write(&path, json).map_err(|e| format!("Failed to write recent files: {}", e))
}

fn path_still_exists(path: &str) -> bool {
    let p = std::path::Path::new(path);
    if p.is_dir() {
        p.join("manifest.json").exists()
    } else {
        p.exists()
    }
}

/// Rebuild a .adsl zip archive from in-memory files
fn rebuild_adsl(path: &PathBuf, files: &HashMap<String, Vec<u8>>) -> Result<(), String> {
    let file = std::fs::File::create(path)
        .map_err(|e| format!("Failed to create {}: {}", path.display(), e))?;
    let mut zip_writer = zip::ZipWriter::new(file);
    let options = zip::write::SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated);

    // Sort keys for deterministic output
    let mut keys: Vec<&String> = files.keys().collect();
    keys.sort();

    for name in keys {
        let data = &files[name];
        zip_writer
            .start_file(name.as_str(), options)
            .map_err(|e| format!("Failed to add {} to archive: {}", name, e))?;
        zip_writer
            .write_all(data)
            .map_err(|e| format!("Failed to write {} to archive: {}", name, e))?;
    }

    zip_writer
        .finish()
        .map_err(|e| format!("Failed to finish archive: {}", e))?;
    Ok(())
}

/// Write a zip archive to a specific path from an arbitrary file source
fn write_adsl_from_source(
    dest: &PathBuf,
    source: &PresentationSource,
    manifest: &Manifest,
) -> Result<(), String> {
    match source {
        PresentationSource::Folder(folder) => {
            let file = std::fs::File::create(dest)
                .map_err(|e| format!("Failed to create {}: {}", dest.display(), e))?;
            let mut zip_writer = zip::ZipWriter::new(file);
            let options = zip::write::SimpleFileOptions::default()
                .compression_method(zip::CompressionMethod::Deflated);

            // Write manifest
            let json = serde_json::to_string_pretty(manifest)
                .map_err(|e| format!("Failed to serialize manifest: {}", e))?;
            zip_writer
                .start_file("manifest.json", options)
                .map_err(|e| format!("zip: {}", e))?;
            zip_writer
                .write_all(json.as_bytes())
                .map_err(|e| format!("zip: {}", e))?;

            // Write slide files
            for slide in &manifest.slides {
                let path = folder.join(&slide.file);
                if let Ok(data) = std::fs::read(&path) {
                    zip_writer
                        .start_file(&slide.file, options)
                        .map_err(|e| format!("zip: {}", e))?;
                    zip_writer
                        .write_all(&data)
                        .map_err(|e| format!("zip: {}", e))?;
                }
            }

            // Write images
            let images_dir = folder.join("images");
            if images_dir.exists() {
                if let Ok(entries) = std::fs::read_dir(&images_dir) {
                    for entry in entries.flatten() {
                        if entry.file_type().map(|t| t.is_file()).unwrap_or(false) {
                            let rel = format!("images/{}", entry.file_name().to_string_lossy());
                            if let Ok(data) = std::fs::read(entry.path()) {
                                zip_writer
                                    .start_file(&rel, options)
                                    .map_err(|e| format!("zip: {}", e))?;
                                zip_writer
                                    .write_all(&data)
                                    .map_err(|e| format!("zip: {}", e))?;
                            }
                        }
                    }
                }
            }

            // Write global.css if it exists
            let gcss = folder.join("global.css");
            if gcss.exists() {
                if let Ok(data) = std::fs::read(&gcss) {
                    zip_writer
                        .start_file("global.css", options)
                        .map_err(|e| format!("zip: {}", e))?;
                    zip_writer
                        .write_all(&data)
                        .map_err(|e| format!("zip: {}", e))?;
                }
            }

            zip_writer
                .finish()
                .map_err(|e| format!("Failed to finish archive: {}", e))?;
            Ok(())
        }
        PresentationSource::Zip { files, .. } => rebuild_adsl(dest, files),
    }
}

// ---------------------------------------------------------------------------
// Global CSS helpers
// ---------------------------------------------------------------------------

/// Strip injected global CSS block from slide HTML
fn strip_global_css(html: &str) -> String {
    if let Some(start) = html.find(GLOBAL_CSS_START) {
        if let Some(end_offset) = html[start..].find(GLOBAL_CSS_END) {
            let end = start + end_offset + GLOBAL_CSS_END.len();
            // Also strip trailing newline
            let end = if html.len() > end && html.as_bytes()[end] == b'\n' {
                end + 1
            } else {
                end
            };
            return format!("{}{}", &html[..start], &html[end..]);
        }
    }
    html.to_string()
}

/// Inject global CSS into slide HTML after <style> tag
fn inject_global_css(html: &str, css: &str) -> String {
    if css.trim().is_empty() {
        return html.to_string();
    }

    let injection = format!("{}\n{}\n{}\n", GLOBAL_CSS_START, css, GLOBAL_CSS_END);

    // Try to inject after <style> tag
    if let Some(pos) = html.find("<style>") {
        let insert_pos = pos + "<style>".len();
        return format!(
            "{}\n{}{}",
            &html[..insert_pos],
            injection,
            &html[insert_pos..]
        );
    }

    // If no <style> tag, inject before </head>
    if let Some(pos) = html.find("</head>") {
        return format!(
            "{}<style>\n{}</style>\n{}",
            &html[..pos],
            injection,
            &html[pos..]
        );
    }

    html.to_string()
}

// ---------------------------------------------------------------------------
// Image inlining
// ---------------------------------------------------------------------------

fn mime_from_ext(ext: &str) -> &'static str {
    match ext {
        "svg" => "image/svg+xml",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        _ => "application/octet-stream",
    }
}

fn inline_images(html: &str, source: &PresentationSource) -> String {
    // Normalize bare images/ refs to ./images/ so the loop below catches both
    let mut result = html.replace("src=\"images/", "src=\"./images/");
    let pattern = "src=\"./images/";

    while let Some(start) = result.find(pattern) {
        let quote_start = start + 5;
        let Some(quote_end) = result[quote_start..].find('"') else {
            break;
        };
        let rel_path = &result[quote_start..quote_start + quote_end].to_string();

        if let Ok(bytes) = read_file(source, rel_path) {
            let ext = rel_path.rsplit('.').next().unwrap_or("png");
            let mime = mime_from_ext(ext);
            let b64 = base64::engine::general_purpose::STANDARD.encode(&bytes);
            let data_uri = format!("data:{};base64,{}", mime, b64);
            dbg_log!("inlined image: {} ({} bytes)", rel_path, bytes.len());
            result = format!(
                "{}src=\"{}\"{}",
                &result[..start],
                data_uri,
                &result[quote_start + quote_end + 1..]
            );
        } else {
            dbg_log!("failed to read image: {}", rel_path);
            // Replace src= with data-missing-img= to avoid re-matching the pattern
            result = format!(
                "{}data-missing-img=\"{}\"{}",
                &result[..start],
                rel_path,
                &result[quote_start + quote_end + 1..]
            );
        }
    }

    result
}

// ---------------------------------------------------------------------------
// Zip loading
// ---------------------------------------------------------------------------

fn load_zip(path: &PathBuf) -> Result<HashMap<String, Vec<u8>>, String> {
    let file = std::fs::File::open(path)
        .map_err(|e| format!("Failed to open {}: {}", path.display(), e))?;
    let mut archive =
        zip::ZipArchive::new(file).map_err(|e| format!("Invalid .adsl archive: {}", e))?;

    let mut files = HashMap::new();
    for i in 0..archive.len() {
        let mut entry = archive
            .by_index(i)
            .map_err(|e| format!("Failed to read archive entry: {}", e))?;
        if entry.is_dir() {
            continue;
        }
        let name = entry.name().to_string();
        let mut buf = Vec::new();
        entry
            .read_to_end(&mut buf)
            .map_err(|e| format!("Failed to read {}: {}", name, e))?;
        dbg_log!("zip entry: {} ({} bytes)", name, buf.len());
        files.insert(name, buf);
    }

    Ok(files)
}

fn is_adsl_file(path: &PathBuf) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .map(|e| e.eq_ignore_ascii_case("adsl"))
        .unwrap_or(false)
}

// ---------------------------------------------------------------------------
// Tauri commands — Viewer (existing)
// ---------------------------------------------------------------------------

#[tauri::command]
fn load_presentation(
    folder: String,
    state: tauri::State<'_, Mutex<AppState>>,
) -> Result<PresentationInfo, String> {
    dbg_log!("load_presentation called with: {:?}", folder);

    let path = PathBuf::from(&folder);

    let source = if is_adsl_file(&path) {
        dbg_log!("loading .adsl archive: {}", path.display());
        PresentationSource::Zip {
            path: path.clone(),
            files: load_zip(&path)?,
        }
    } else {
        dbg_log!("loading folder: {}", path.display());
        PresentationSource::Folder(path)
    };

    let data = read_file_string(&source, "manifest.json")?;

    let manifest: Manifest =
        serde_json::from_str(&data).map_err(|e| format!("Invalid manifest.json: {}", e))?;

    dbg_log!(
        "loaded: \"{}\" with {} slides",
        manifest.title,
        manifest.slides.len()
    );

    let info = PresentationInfo {
        title: manifest.title.clone(),
        author: manifest.author.name.clone(),
        description: manifest.description.clone(),
        total_slides: manifest.slides.len(),
        theme: manifest.theme.clone(),
    };

    let mut app_state = state.lock().map_err(|e| e.to_string())?;
    app_state.source = Some(source);
    app_state.manifest = Some(manifest);
    app_state.is_scratch = false;

    Ok(info)
}

#[tauri::command]
fn get_slide(index: usize, state: tauri::State<'_, Mutex<AppState>>) -> Result<String, String> {
    dbg_log!("get_slide called with index: {}", index);

    let app_state = state.lock().map_err(|e| e.to_string())?;
    let manifest = app_state
        .manifest
        .as_ref()
        .ok_or("No presentation loaded")?;
    let source = app_state
        .source
        .as_ref()
        .ok_or("No presentation loaded")?;

    let slide = manifest
        .slides
        .get(index)
        .ok_or(format!("Slide index {} out of range", index))?;

    dbg_log!("reading slide file: {}", slide.file);
    let html = read_file_string(source, &slide.file)?;

    Ok(inline_images(&html, source))
}

#[tauri::command]
fn get_slide_info(
    index: usize,
    state: tauri::State<'_, Mutex<AppState>>,
) -> Result<SlideInfo, String> {
    let app_state = state.lock().map_err(|e| e.to_string())?;
    let manifest = app_state
        .manifest
        .as_ref()
        .ok_or("No presentation loaded")?;

    let slide = manifest
        .slides
        .get(index)
        .ok_or(format!("Slide index {} out of range", index))?;

    Ok(SlideInfo {
        title: slide.title.clone(),
        notes: slide.notes.clone(),
        transition: slide.transition.clone(),
    })
}

#[tauri::command]
fn get_total_slides(state: tauri::State<'_, Mutex<AppState>>) -> Result<usize, String> {
    let app_state = state.lock().map_err(|e| e.to_string())?;
    let manifest = app_state
        .manifest
        .as_ref()
        .ok_or("No presentation loaded")?;

    Ok(manifest.slides.len())
}

// ---------------------------------------------------------------------------
// Tauri commands — Editor: Presentation lifecycle
// ---------------------------------------------------------------------------

#[tauri::command]
fn create_presentation(
    folder: String,
    title: String,
    author: String,
    state: tauri::State<'_, Mutex<AppState>>,
) -> Result<PresentationInfo, String> {
    dbg_log!("create_presentation: folder={}, title={}", folder, title);

    let folder_path = PathBuf::from(&folder);

    // Create directory structure
    std::fs::create_dir_all(&folder_path)
        .map_err(|e| format!("Failed to create folder: {}", e))?;
    std::fs::create_dir_all(folder_path.join("images"))
        .map_err(|e| format!("Failed to create images dir: {}", e))?;

    // Generate first slide
    let slide_filename = generate_slide_filename();
    let now = chrono::Utc::now().to_rfc3339();

    let manifest = Manifest {
        version: "1.0.0".to_string(),
        title: title.clone(),
        author: Author {
            name: author.clone(),
            email: None,
            url: None,
        },
        created: Some(now.clone()),
        modified: Some(now),
        description: String::new(),
        tags: Vec::new(),
        aspect_ratio: Some("auto".to_string()),
        slides: vec![SlideEntry {
            index: Some(0),
            file: slide_filename.clone(),
            title: "Title".to_string(),
            notes: None,
            transition: Some("fade".to_string()),
            duration_seconds: None,
        }],
        theme: Some(Theme {
            background: Some("#0f0c29".to_string()),
            foreground: Some("#ffffff".to_string()),
            accent: Some("#e94560".to_string()),
            secondary: Some("#533483".to_string()),
        }),
        images: Vec::new(),
        global_css: None,
    };

    // Write files
    let mut source = PresentationSource::Folder(folder_path);
    write_file_string(&mut source, &slide_filename, DEFAULT_SLIDE_HTML)?;
    save_manifest_to_source(&mut source, &manifest)?;

    let info = PresentationInfo {
        title: manifest.title.clone(),
        author: manifest.author.name.clone(),
        description: manifest.description.clone(),
        total_slides: manifest.slides.len(),
        theme: manifest.theme.clone(),
    };

    let mut app_state = state.lock().map_err(|e| e.to_string())?;
    app_state.source = Some(source);
    app_state.manifest = Some(manifest);
    app_state.is_scratch = false;

    Ok(info)
}

// ---------------------------------------------------------------------------
// Tauri commands — Editor: Slide CRUD
// ---------------------------------------------------------------------------

#[tauri::command]
fn get_slide_raw(
    index: usize,
    state: tauri::State<'_, Mutex<AppState>>,
) -> Result<SlideRawInfo, String> {
    dbg_log!("get_slide_raw: index={}", index);

    let app_state = state.lock().map_err(|e| e.to_string())?;
    let manifest = app_state
        .manifest
        .as_ref()
        .ok_or("No presentation loaded")?;
    let source = app_state
        .source
        .as_ref()
        .ok_or("No presentation loaded")?;

    let slide = manifest
        .slides
        .get(index)
        .ok_or(format!("Slide index {} out of range", index))?;

    let raw_html = read_file_string(source, &slide.file)?;
    let clean_html = strip_global_css(&raw_html);

    // Read global CSS
    let global_css = read_file_string(source, "global.css").unwrap_or_default();

    Ok(SlideRawInfo {
        html: clean_html,
        global_css,
        title: slide.title.clone(),
        notes: slide.notes.clone(),
        transition: slide.transition.clone(),
    })
}

#[tauri::command]
fn save_slide(
    index: usize,
    html: String,
    title: String,
    notes: Option<String>,
    transition: Option<String>,
    state: tauri::State<'_, Mutex<AppState>>,
) -> Result<(), String> {
    dbg_log!("save_slide: index={}", index);

    let mut app_state = state.lock().map_err(|e| e.to_string())?;
    let (source, manifest) = app_state.loaded_mut()?;

    let slide = manifest
        .slides
        .get_mut(index)
        .ok_or(format!("Slide index {} out of range", index))?;

    // Read global CSS and inject into the HTML
    let global_css = read_file_string(source, "global.css").unwrap_or_default();
    let final_html = inject_global_css(&html, &global_css);

    // Write slide file
    write_file_string(source, &slide.file, &final_html)?;

    // Update manifest entry
    slide.title = title;
    slide.notes = notes;
    slide.transition = transition;

    // Update modified timestamp
    manifest.modified = Some(chrono::Utc::now().to_rfc3339());

    // Persist manifest
    save_manifest_to_source(source, manifest)?;

    // For zip sources, flush to disk so changes aren't lost
    if let PresentationSource::Zip { path, files } = source {
        rebuild_adsl(path, files)?;
    }

    Ok(())
}

#[tauri::command]
fn add_slide(
    after_index: i32,
    html: String,
    title: String,
    state: tauri::State<'_, Mutex<AppState>>,
) -> Result<usize, String> {
    dbg_log!("add_slide: after_index={}", after_index);

    let mut app_state = state.lock().map_err(|e| e.to_string())?;
    let (source, manifest) = app_state.loaded_mut()?;

    let filename = generate_slide_filename();

    // Inject global CSS
    let global_css = read_file_string(source, "global.css").unwrap_or_default();
    let final_html = inject_global_css(&html, &global_css);

    // Write slide file
    write_file_string(source, &filename, &final_html)?;

    // Determine insertion index
    let insert_at = if after_index < 0 {
        0
    } else {
        (after_index as usize + 1).min(manifest.slides.len())
    };

    let entry = SlideEntry {
        index: Some(insert_at),
        file: filename,
        title,
        notes: None,
        transition: Some("fade".to_string()),
        duration_seconds: None,
    };

    manifest.slides.insert(insert_at, entry);

    // Re-index slides
    for (i, slide) in manifest.slides.iter_mut().enumerate() {
        slide.index = Some(i);
    }

    manifest.modified = Some(chrono::Utc::now().to_rfc3339());
    save_manifest_to_source(source, manifest)?;

    Ok(insert_at)
}

#[tauri::command]
fn delete_slide(
    index: usize,
    state: tauri::State<'_, Mutex<AppState>>,
) -> Result<(), String> {
    dbg_log!("delete_slide: index={}", index);

    let mut app_state = state.lock().map_err(|e| e.to_string())?;
    let (source, manifest) = app_state.loaded_mut()?;

    if manifest.slides.len() <= 1 {
        return Err("Cannot delete the last slide".to_string());
    }

    let slide = manifest
        .slides
        .get(index)
        .ok_or(format!("Slide index {} out of range", index))?;

    let filename = slide.file.clone();

    // Remove slide file
    let _ = delete_file_from_source(source, &filename);

    // Remove from manifest
    manifest.slides.remove(index);

    // Re-index
    for (i, slide) in manifest.slides.iter_mut().enumerate() {
        slide.index = Some(i);
    }

    manifest.modified = Some(chrono::Utc::now().to_rfc3339());
    save_manifest_to_source(source, manifest)?;

    Ok(())
}

#[tauri::command]
fn duplicate_slide(
    index: usize,
    state: tauri::State<'_, Mutex<AppState>>,
) -> Result<usize, String> {
    dbg_log!("duplicate_slide: index={}", index);

    let mut app_state = state.lock().map_err(|e| e.to_string())?;
    let (source, manifest) = app_state.loaded_mut()?;

    let slide = manifest
        .slides
        .get(index)
        .ok_or(format!("Slide index {} out of range", index))?;

    // Read original slide HTML
    let html = read_file_string(source, &slide.file)?;
    let new_filename = generate_slide_filename();

    // Write duplicate
    write_file_string(source, &new_filename, &html)?;

    let new_entry = SlideEntry {
        index: Some(index + 1),
        file: new_filename,
        title: format!("{} (copy)", slide.title),
        notes: slide.notes.clone(),
        transition: slide.transition.clone(),
        duration_seconds: slide.duration_seconds,
    };

    manifest.slides.insert(index + 1, new_entry);

    // Re-index
    for (i, slide) in manifest.slides.iter_mut().enumerate() {
        slide.index = Some(i);
    }

    manifest.modified = Some(chrono::Utc::now().to_rfc3339());
    save_manifest_to_source(source, manifest)?;

    Ok(index + 1)
}

#[tauri::command]
fn reorder_slides(
    new_order: Vec<usize>,
    state: tauri::State<'_, Mutex<AppState>>,
) -> Result<(), String> {
    dbg_log!("reorder_slides: {:?}", new_order);

    let mut app_state = state.lock().map_err(|e| e.to_string())?;
    let (source, manifest) = app_state.loaded_mut()?;

    if new_order.len() != manifest.slides.len() {
        return Err("New order length doesn't match slide count".to_string());
    }

    let old_slides = manifest.slides.clone();
    let mut new_slides = Vec::with_capacity(old_slides.len());

    for &old_idx in &new_order {
        let slide = old_slides
            .get(old_idx)
            .ok_or(format!("Invalid index {} in new_order", old_idx))?;
        new_slides.push(slide.clone());
    }

    // Re-index
    for (i, slide) in new_slides.iter_mut().enumerate() {
        slide.index = Some(i);
    }

    manifest.slides = new_slides;
    manifest.modified = Some(chrono::Utc::now().to_rfc3339());
    save_manifest_to_source(source, manifest)?;

    Ok(())
}

// ---------------------------------------------------------------------------
// Tauri commands — Editor: Save & Export
// ---------------------------------------------------------------------------

#[tauri::command]
fn save_presentation(state: tauri::State<'_, Mutex<AppState>>) -> Result<(), String> {
    dbg_log!("save_presentation");

    let mut app_state = state.lock().map_err(|e| e.to_string())?;
    let (source, manifest) = app_state.loaded_mut()?;

    manifest.modified = Some(chrono::Utc::now().to_rfc3339());
    save_manifest_to_source(source, manifest)?;

    // For zip sources, flush to disk
    if let PresentationSource::Zip { path, files } = source {
        rebuild_adsl(path, files)?;
    }

    Ok(())
}

#[tauri::command]
fn export_to_folder(
    destination: String,
    state: tauri::State<'_, Mutex<AppState>>,
) -> Result<(), String> {
    dbg_log!("export_to_folder: {}", destination);

    let app_state = state.lock().map_err(|e| e.to_string())?;
    let manifest = app_state
        .manifest
        .as_ref()
        .ok_or("No presentation loaded")?;
    let source = app_state
        .source
        .as_ref()
        .ok_or("No presentation loaded")?;

    let dest = PathBuf::from(&destination);
    std::fs::create_dir_all(&dest)
        .map_err(|e| format!("Failed to create destination: {}", e))?;
    std::fs::create_dir_all(dest.join("images"))
        .map_err(|e| format!("Failed to create images dir: {}", e))?;

    // Write manifest
    let json = serde_json::to_string_pretty(manifest)
        .map_err(|e| format!("Failed to serialize manifest: {}", e))?;
    std::fs::write(dest.join("manifest.json"), &json)
        .map_err(|e| format!("Failed to write manifest: {}", e))?;

    // Copy all slides
    for slide in &manifest.slides {
        let data = read_file(source, &slide.file)?;
        std::fs::write(dest.join(&slide.file), &data)
            .map_err(|e| format!("Failed to write {}: {}", slide.file, e))?;
    }

    // Copy images
    match source {
        PresentationSource::Folder(folder) => {
            let images_dir = folder.join("images");
            if images_dir.exists() {
                if let Ok(entries) = std::fs::read_dir(&images_dir) {
                    for entry in entries.flatten() {
                        if entry.file_type().map(|t| t.is_file()).unwrap_or(false) {
                            let dest_file =
                                dest.join("images").join(entry.file_name());
                            let _ = std::fs::copy(entry.path(), dest_file);
                        }
                    }
                }
            }
        }
        PresentationSource::Zip { files, .. } => {
            for (name, data) in files {
                if name.starts_with("images/") || name.starts_with("./images/") {
                    let clean = name.strip_prefix("./").unwrap_or(name);
                    let dest_file = dest.join(clean);
                    if let Some(parent) = dest_file.parent() {
                        let _ = std::fs::create_dir_all(parent);
                    }
                    let _ = std::fs::write(dest_file, data);
                }
            }
        }
    }

    // Copy global.css
    if let Ok(css) = read_file_string(source, "global.css") {
        std::fs::write(dest.join("global.css"), &css)
            .map_err(|e| format!("Failed to write global.css: {}", e))?;
    }

    Ok(())
}

#[tauri::command]
async fn save_as_adsl(
    app: tauri::AppHandle,
    state: tauri::State<'_, Mutex<AppState>>,
) -> Result<Option<String>, String> {
    dbg_log!("save_as_adsl: showing save dialog...");

    let (tx, rx) = std::sync::mpsc::sync_channel::<Option<String>>(1);

    app.dialog()
        .file()
        .set_title("Save as .adsl")
        .add_filter("AuraDeck Slides", &["adsl"])
        .save_file(move |file| {
            let result = file.map(|f| f.to_string());
            let _ = tx.send(result);
        });

    let result = tauri::async_runtime::spawn_blocking(move || {
        rx.recv()
            .map_err(|e| format!("Dialog channel error: {}", e))
    })
    .await
    .map_err(|e| format!("Dialog task error: {}", e))??;

    if let Some(ref dest_str) = result {
        let dest = PathBuf::from(dest_str);
        let app_state = state.lock().map_err(|e| e.to_string())?;
        let manifest = app_state
            .manifest
            .as_ref()
            .ok_or("No presentation loaded")?;
        let source = app_state
            .source
            .as_ref()
            .ok_or("No presentation loaded")?;

        write_adsl_from_source(&dest, source, manifest)?;
        dbg_log!("saved as adsl: {}", dest.display());
    }

    Ok(result)
}

// ---------------------------------------------------------------------------
// Tauri commands — Editor: Global CSS
// ---------------------------------------------------------------------------

#[tauri::command]
fn get_global_css(state: tauri::State<'_, Mutex<AppState>>) -> Result<String, String> {
    let app_state = state.lock().map_err(|e| e.to_string())?;
    let source = app_state
        .source
        .as_ref()
        .ok_or("No presentation loaded")?;

    Ok(read_file_string(source, "global.css").unwrap_or_default())
}

#[tauri::command]
fn save_global_css(
    css: String,
    state: tauri::State<'_, Mutex<AppState>>,
) -> Result<(), String> {
    dbg_log!("save_global_css: {} bytes", css.len());

    let mut app_state = state.lock().map_err(|e| e.to_string())?;
    let (source, manifest) = app_state.loaded_mut()?;

    write_file_string(source, "global.css", &css)?;

    // Update the global_css field in manifest for reference
    manifest.global_css = if css.trim().is_empty() {
        None
    } else {
        Some("global.css".to_string())
    };

    // Re-inject global CSS into all slides
    for slide in &manifest.slides {
        let html = read_file_string(source, &slide.file)?;
        let stripped = strip_global_css(&html);
        let updated = inject_global_css(&stripped, &css);
        write_file_string(source, &slide.file, &updated)?;
    }

    manifest.modified = Some(chrono::Utc::now().to_rfc3339());
    save_manifest_to_source(source, manifest)?;

    Ok(())
}

// ---------------------------------------------------------------------------
// Tauri commands — Editor: Metadata
// ---------------------------------------------------------------------------

#[tauri::command]
fn update_manifest_metadata(
    title: Option<String>,
    description: Option<String>,
    author_name: Option<String>,
    tags: Option<Vec<String>>,
    theme: Option<Theme>,
    state: tauri::State<'_, Mutex<AppState>>,
) -> Result<(), String> {
    dbg_log!("update_manifest_metadata");

    let mut app_state = state.lock().map_err(|e| e.to_string())?;
    let (source, manifest) = app_state.loaded_mut()?;

    if let Some(t) = title {
        manifest.title = t;
    }
    if let Some(d) = description {
        manifest.description = d;
    }
    if let Some(a) = author_name {
        manifest.author.name = a;
    }
    if let Some(t) = tags {
        manifest.tags = t;
    }
    if let Some(t) = theme {
        manifest.theme = Some(t);
    }

    manifest.modified = Some(chrono::Utc::now().to_rfc3339());
    save_manifest_to_source(source, manifest)?;

    Ok(())
}

// ---------------------------------------------------------------------------
// Tauri commands — Editor: Images
// ---------------------------------------------------------------------------

#[tauri::command]
async fn import_image(
    app: tauri::AppHandle,
    state: tauri::State<'_, Mutex<AppState>>,
) -> Result<Option<String>, String> {
    dbg_log!("import_image: showing file dialog...");

    let (tx, rx) = std::sync::mpsc::sync_channel::<Option<String>>(1);

    app.dialog()
        .file()
        .set_title("Import Image")
        .add_filter("Images", &["png", "jpg", "jpeg", "gif", "webp", "svg"])
        .pick_file(move |file| {
            let result = file.map(|f| f.to_string());
            let _ = tx.send(result);
        });

    let result = tauri::async_runtime::spawn_blocking(move || {
        rx.recv()
            .map_err(|e| format!("Dialog channel error: {}", e))
    })
    .await
    .map_err(|e| format!("Dialog task error: {}", e))??;

    if let Some(ref src_path_str) = result {
        let src_path = PathBuf::from(src_path_str);
        let file_name = src_path
            .file_name()
            .and_then(|f| f.to_str())
            .ok_or("Invalid filename")?
            .to_string();

        let image_data = std::fs::read(&src_path)
            .map_err(|e| format!("Failed to read image: {}", e))?;

        let rel_path = format!("images/{}", file_name);

        let mut app_state = state.lock().map_err(|e| e.to_string())?;
        let (source, manifest) = app_state.loaded_mut()?;

        write_file(source, &rel_path, &image_data)?;

        // Add to manifest images list if not already there
        if !manifest.images.contains(&rel_path) {
            manifest.images.push(rel_path.clone());
            save_manifest_to_source(source, manifest)?;
        }

        return Ok(Some(format!("./{}", rel_path)));
    }

    Ok(None)
}

// ---------------------------------------------------------------------------
// Tauri commands — Editor: Preview helper
// ---------------------------------------------------------------------------

#[tauri::command]
fn inline_slide_images(
    html: String,
    state: tauri::State<'_, Mutex<AppState>>,
) -> Result<String, String> {
    let app_state = state.lock().map_err(|e| e.to_string())?;
    let source = app_state
        .source
        .as_ref()
        .ok_or("No presentation loaded")?;
    Ok(inline_images(&html, source))
}

// ---------------------------------------------------------------------------
// Tauri commands — Export helpers
// ---------------------------------------------------------------------------

#[tauri::command]
async fn save_export_file(
    app: tauri::AppHandle,
    data: Vec<u8>,
    default_name: String,
    filter_name: String,
    filter_ext: Vec<String>,
) -> Result<Option<String>, String> {
    dbg_log!("save_export_file: {} ({} bytes)", default_name, data.len());

    let (tx, rx) = std::sync::mpsc::sync_channel::<Option<String>>(1);

    let ext_refs: Vec<&str> = filter_ext.iter().map(|s| s.as_str()).collect();
    app.dialog()
        .file()
        .set_title("Export")
        .set_file_name(&default_name)
        .add_filter(&filter_name, &ext_refs)
        .save_file(move |file| {
            let result = file.map(|f| f.to_string());
            let _ = tx.send(result);
        });

    let result = tauri::async_runtime::spawn_blocking(move || {
        rx.recv()
            .map_err(|e| format!("Dialog channel error: {}", e))
    })
    .await
    .map_err(|e| format!("Dialog task error: {}", e))??;

    if let Some(ref dest_str) = result {
        std::fs::write(dest_str, &data)
            .map_err(|e| format!("Failed to write file: {}", e))?;
        dbg_log!("exported to: {}", dest_str);
    }

    Ok(result)
}

// ---------------------------------------------------------------------------
// Tauri commands — Scratch presentation
// ---------------------------------------------------------------------------

#[tauri::command]
fn create_scratch_presentation(
    state: tauri::State<'_, Mutex<AppState>>,
) -> Result<PresentationInfo, String> {
    dbg_log!("create_scratch_presentation");

    let mut rng = rand::thread_rng();
    let suffix: String = (0..8)
        .map(|_| b"abcdefghijklmnopqrstuvwxyz0123456789"[rng.gen_range(0..36)] as char)
        .collect();
    let folder_path = std::env::temp_dir().join(format!("auradeck-scratch-{}", suffix));

    // Create directory structure
    std::fs::create_dir_all(&folder_path)
        .map_err(|e| format!("Failed to create scratch folder: {}", e))?;
    std::fs::create_dir_all(folder_path.join("images"))
        .map_err(|e| format!("Failed to create images dir: {}", e))?;

    // Generate first slide
    let slide_filename = generate_slide_filename();
    let now = chrono::Utc::now().to_rfc3339();

    let manifest = Manifest {
        version: "1.0.0".to_string(),
        title: "Untitled Presentation".to_string(),
        author: Author {
            name: "Unknown".to_string(),
            email: None,
            url: None,
        },
        created: Some(now.clone()),
        modified: Some(now),
        description: String::new(),
        tags: Vec::new(),
        aspect_ratio: Some("auto".to_string()),
        slides: vec![SlideEntry {
            index: Some(0),
            file: slide_filename.clone(),
            title: "Title".to_string(),
            notes: None,
            transition: Some("fade".to_string()),
            duration_seconds: None,
        }],
        theme: Some(Theme {
            background: Some("#0f0c29".to_string()),
            foreground: Some("#ffffff".to_string()),
            accent: Some("#e94560".to_string()),
            secondary: Some("#533483".to_string()),
        }),
        images: Vec::new(),
        global_css: None,
    };

    // Write files
    let mut source = PresentationSource::Folder(folder_path);
    write_file_string(&mut source, &slide_filename, DEFAULT_SLIDE_HTML)?;
    save_manifest_to_source(&mut source, &manifest)?;

    let info = PresentationInfo {
        title: manifest.title.clone(),
        author: manifest.author.name.clone(),
        description: manifest.description.clone(),
        total_slides: manifest.slides.len(),
        theme: manifest.theme.clone(),
    };

    let mut app_state = state.lock().map_err(|e| e.to_string())?;
    app_state.source = Some(source);
    app_state.manifest = Some(manifest);
    app_state.is_scratch = true;

    Ok(info)
}

#[tauri::command]
fn cleanup_scratch(state: tauri::State<'_, Mutex<AppState>>) -> Result<(), String> {
    dbg_log!("cleanup_scratch");

    let mut app_state = state.lock().map_err(|e| e.to_string())?;

    if app_state.is_scratch {
        if let Some(PresentationSource::Folder(ref path)) = app_state.source {
            let scratch_path = path.clone();
            dbg_log!("removing scratch folder: {}", scratch_path.display());
            let _ = std::fs::remove_dir_all(&scratch_path);
        }
        app_state.is_scratch = false;
    }

    Ok(())
}

// ---------------------------------------------------------------------------
// Tauri commands — Dialogs & Startup
// ---------------------------------------------------------------------------

fn resolve_path(arg: &str) -> Option<PathBuf> {
    let path = PathBuf::from(arg);

    if is_adsl_file(&path) {
        if path.exists() {
            return std::fs::canonicalize(&path).ok().or(Some(path));
        }
        if let Ok(cwd) = std::env::current_dir() {
            if let Some(parent) = cwd.parent() {
                let resolved = parent.join(arg);
                if resolved.exists() {
                    return std::fs::canonicalize(&resolved).ok().or(Some(resolved));
                }
            }
        }
        return None;
    }

    if path.join("manifest.json").exists() {
        return std::fs::canonicalize(&path).ok().or(Some(path));
    }
    if let Ok(cwd) = std::env::current_dir() {
        if let Some(parent) = cwd.parent() {
            let resolved = parent.join(arg);
            if resolved.join("manifest.json").exists() {
                return std::fs::canonicalize(&resolved).ok().or(Some(resolved));
            }
        }
    }

    None
}

#[tauri::command]
fn get_initial_path() -> Option<String> {
    let args: Vec<String> = std::env::args().collect();
    dbg_log!("CLI args: {:?}", args);

    if let Ok(cwd) = std::env::current_dir() {
        dbg_log!("CWD: {}", cwd.display());
    }

    for arg in args.iter().skip(1) {
        if arg.starts_with('-') {
            continue;
        }

        if let Some(resolved) = resolve_path(arg) {
            dbg_log!("initial path resolved: {}", resolved.display());
            return Some(resolved.to_string_lossy().into_owned());
        }

        dbg_log!("arg {:?} is not a presentation, skipping", arg);
    }

    dbg_log!("no initial path found");
    None
}

#[tauri::command]
async fn open_presentation_dialog(app: tauri::AppHandle) -> Result<Option<String>, String> {
    dbg_log!("open_presentation_dialog: showing native dialog...");

    let (tx, rx) = std::sync::mpsc::sync_channel::<Option<String>>(1);

    app.dialog()
        .file()
        .set_title("Open Presentation")
        .add_filter("AuraDeck Slides", &["adsl"])
        .pick_file(move |file| {
            let result = file.map(|f| f.to_string());
            let _ = tx.send(result);
        });

    let result = tauri::async_runtime::spawn_blocking(move || {
        rx.recv()
            .map_err(|e| format!("Dialog channel error: {}", e))
    })
    .await
    .map_err(|e| format!("Dialog task error: {}", e))??;

    match &result {
        Some(f) => dbg_log!("dialog returned: {:?}", f),
        None => dbg_log!("dialog was cancelled"),
    }

    Ok(result)
}

#[tauri::command]
async fn open_folder_dialog(app: tauri::AppHandle) -> Result<Option<String>, String> {
    dbg_log!("open_folder_dialog: showing native dialog...");

    let (tx, rx) = std::sync::mpsc::sync_channel::<Option<String>>(1);

    app.dialog()
        .file()
        .set_title("Open Presentation Folder")
        .pick_folder(move |folder| {
            let result = folder.map(|f| f.to_string());
            let _ = tx.send(result);
        });

    let result = tauri::async_runtime::spawn_blocking(move || {
        rx.recv()
            .map_err(|e| format!("Dialog channel error: {}", e))
    })
    .await
    .map_err(|e| format!("Dialog task error: {}", e))??;

    match &result {
        Some(f) => dbg_log!("dialog returned: {:?}", f),
        None => dbg_log!("dialog was cancelled"),
    }

    Ok(result)
}

// ---------------------------------------------------------------------------
// Tauri commands — Recent files
// ---------------------------------------------------------------------------

#[tauri::command]
fn get_recent_files(app: tauri::AppHandle) -> Result<Vec<RecentEntry>, String> {
    let mut entries = load_recent_entries(&app);
    let before = entries.len();
    entries.retain(|e| path_still_exists(&e.path));
    if entries.len() != before {
        let _ = save_recent_entries(&app, &entries);
    }
    Ok(entries)
}

#[tauri::command]
fn add_recent_file(app: tauri::AppHandle, path: String, title: String) -> Result<(), String> {
    let mut entries = load_recent_entries(&app);
    entries.retain(|e| e.path != path);
    entries.insert(
        0,
        RecentEntry {
            path,
            title,
            last_opened: chrono::Utc::now().to_rfc3339(),
        },
    );
    entries.truncate(15);
    save_recent_entries(&app, &entries)
}

#[tauri::command]
fn remove_recent_file(app: tauri::AppHandle, path: String) -> Result<(), String> {
    let mut entries = load_recent_entries(&app);
    entries.retain(|e| e.path != path);
    save_recent_entries(&app, &entries)
}

// ---------------------------------------------------------------------------
// App entry point
// ---------------------------------------------------------------------------

pub fn run() {
    dbg_log!("starting AuraDeck");

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(Mutex::new(AppState::default()))
        .invoke_handler(tauri::generate_handler![
            // Viewer
            load_presentation,
            get_slide,
            get_slide_info,
            get_total_slides,
            get_initial_path,
            open_presentation_dialog,
            open_folder_dialog,
            // Editor: lifecycle
            create_presentation,
            create_scratch_presentation,
            cleanup_scratch,
            // Editor: slide CRUD
            get_slide_raw,
            save_slide,
            add_slide,
            delete_slide,
            duplicate_slide,
            reorder_slides,
            // Editor: save/export
            save_presentation,
            export_to_folder,
            save_as_adsl,
            // Editor: global CSS
            get_global_css,
            save_global_css,
            // Editor: metadata
            update_manifest_metadata,
            // Editor: images
            import_image,
            // Editor: preview
            inline_slide_images,
            // Export
            save_export_file,
            // Recent files
            get_recent_files,
            add_recent_file,
            remove_recent_file,
        ])
        .run(tauri::generate_context!())
        .expect("error while running AuraDeck");
}
