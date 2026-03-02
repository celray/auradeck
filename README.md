# AuraDeck

A lightweight presentation editor and viewer built with Tauri 2. Create, edit, and present HTML slide decks with a ribbon-style editor, live preview, presenter mode, and export to PDF/PPTX.

## Prerequisites

- [Rust](https://rustup.rs/) (stable)
- [Node.js](https://nodejs.org/) (v18+)
- System webview dependencies (see [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/))

## Getting Started

```bash
npm install
npm run tauri dev
```

To open a presentation directly from the CLI:

```bash
npm run tauri dev -- -- ./example/extracted
# or an .adsl archive:
npm run tauri dev -- -- ./example/example.adsl
```

## Building

```bash
npm run tauri build
```

The compiled binary will be in `src-tauri/target/release/`. Tauri produces a single native binary with all web assets embedded.

## Installing (Linux)

After building, run the install script to add AuraDeck to your desktop:

```bash
./linux/install-mime.sh          # install release binary
./linux/install-mime.sh --debug  # install debug binary
```

This installs the binary to `~/.local/bin/`, registers the `.adsl` MIME type, and adds a desktop entry with icons.

## Keyboard Shortcuts

### Editor

| Key | Action |
|-----|--------|
| Ctrl+S | Save current slide |
| Ctrl+N | New slide |
| Ctrl+D | Duplicate slide |
| Ctrl+Space | Autocomplete (HTML/CSS/JS) |
| F5 | Present (fullscreen viewer) |
| F6 | Presenter Mode (dual screen) |

### Viewer

| Key | Action |
|-----|--------|
| Right / Down / Space | Next slide |
| Left / Up | Previous slide |
| Home | First slide |
| End | Last slide |
| F | Toggle fullscreen |
| Escape | Exit fullscreen / return to editor |

### Presenter Mode

| Key | Action |
|-----|--------|
| Right / Down / Space | Next slide |
| Left / Up | Previous slide |
| F | Toggle fullscreen (on presenter window) |
| Escape | Exit fullscreen, or close presenter |

## Presentation Format

AuraDeck supports two equivalent formats:

- **Folder** — a directory with `manifest.json`, slide HTML files, and an `images/` folder
- **`.adsl` archive** — a zip file containing the exact same structure

### `.adsl` File Format

An `.adsl` file is a standard **ZIP archive** (MIME type `application/x-auradeck-slides`) with the extension `.adsl`. You can create one with any zip tool:

```bash
cd my-presentation/
zip -r ../my-deck.adsl manifest.json *.html images/
```

Or rename any `.adsl` to `.zip` to inspect/extract it.

### Directory Structure

```
my-presentation/          # or the root of the .adsl zip
├── manifest.json         # REQUIRED — slide order, metadata, theme
├── a1b2c3d4.html         # slide files
├── e5f6g7h8.html
├── images/               # image assets referenced by slides
│   ├── hero-bg.svg
│   └── chart.png
└── global.css            # optional — shared CSS injected into all slides
```

### `manifest.json` Specification

The manifest is the only required metadata file. It controls slide order, presentation metadata, and theming.

#### Full Example

```json
{
  "version": "1.0.0",
  "title": "My Presentation",
  "author": {
    "name": "Jane Doe",
    "email": "jane@example.com",
    "url": "https://example.com"
  },
  "created": "2026-03-02T00:00:00Z",
  "modified": "2026-03-02T12:30:00Z",
  "description": "A presentation about interesting things.",
  "tags": ["demo", "tutorial"],
  "aspect_ratio": "auto",
  "slides": [
    {
      "index": 0,
      "file": "a1b2c3d4.html",
      "title": "Title Slide",
      "notes": "Welcome the audience. Introduce the topic.",
      "transition": "fade",
      "duration_seconds": 30.0
    },
    {
      "index": 1,
      "file": "e5f6g7h8.html",
      "title": "Overview",
      "notes": "Explain the agenda.",
      "transition": "slide-left"
    }
  ],
  "theme": {
    "background": "#0f0c29",
    "foreground": "#ffffff",
    "accent": "#e94560",
    "secondary": "#533483"
  },
  "images": [
    "images/hero-bg.svg",
    "images/chart.png"
  ],
  "global_css": "global.css"
}
```

#### Field Reference

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `version` | string | No | `"1.0.0"` | Manifest schema version. Currently `"1.0.0"`. |
| `title` | string | **Yes** | — | Presentation title. Shown in the title bar and metadata. |
| `author` | object | **Yes** | — | Author information (see [Author](#author-object)). |
| `description` | string | **Yes** | — | Short description of the presentation. Can be empty `""`. |
| `created` | string | No | — | ISO 8601 timestamp of creation (e.g. `"2026-03-02T00:00:00Z"`). |
| `modified` | string | No | — | ISO 8601 timestamp of last modification. Updated automatically on save. |
| `tags` | string[] | No | `[]` | Freeform tags for categorisation. |
| `aspect_ratio` | string | No | — | Slide aspect ratio. `"auto"`, `"16:9"`, or `"4:3"`. When omitted or `"auto"`, slides render at the viewport's natural ratio. |
| `slides` | array | **Yes** | — | Ordered list of slides (see [Slide Entry](#slide-entry-object)). |
| `theme` | object | No | — | Presentation-wide colour theme (see [Theme](#theme-object)). |
| `images` | string[] | No | `[]` | List of image asset paths relative to the manifest root (e.g. `"images/photo.png"`). Informational — images are loaded from slide HTML directly. |
| `global_css` | string | No | — | Path to a shared CSS file injected into every slide at render time. |

#### Author Object

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | **Yes** | Author's display name. |
| `email` | string | No | Contact email. |
| `url` | string | No | Website or profile URL. |

#### Slide Entry Object

Each entry in the `slides` array represents one slide in presentation order.

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `file` | string | **Yes** | — | Filename of the slide HTML file, relative to the manifest root (e.g. `"a1b2c3d4.html"`). |
| `title` | string | **Yes** | — | Human-readable slide title. Shown in the slide panel and presenter view. |
| `index` | integer | No | — | Display order index (0-based). When present, used for sorting; when omitted, array order is used. |
| `notes` | string | No | — | Speaker notes displayed in presenter mode. Plain text. |
| `transition` | string | No | — | Transition effect when entering this slide. Values: `"fade"`, `"slide-left"`, `"slide-right"`, `"none"`. |
| `duration_seconds` | number | No | — | Suggested duration for this slide in seconds. For pacing guidance in presenter mode. |

#### Theme Object

Optional colour scheme applied to the viewer chrome (not the slides themselves — slides control their own styling via inline CSS).

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `background` | string | No | Background colour (CSS value, e.g. `"#0f0c29"`). |
| `foreground` | string | No | Text colour (CSS value). |
| `accent` | string | No | Primary accent colour. |
| `secondary` | string | No | Secondary accent colour. |

### Slide HTML Files

Each slide is a **self-contained HTML document** with inline `<style>` and `<script>` tags. Slides are rendered in an iframe at the presentation's aspect ratio.

**Requirements:**
- Must be a complete HTML document (`<!DOCTYPE html>`, `<html>`, `<head>`, `<body>`)
- All CSS must be inline in `<style>` tags (no external stylesheets)
- All JS must be inline in `<script>` tags (no external scripts)
- Images should reference `./images/filename.ext` — AuraDeck inlines these as base64 `data:` URIs at load time
- Use viewport-relative units (`vw`, `vh`, `vmin`, `vmax`) for responsive sizing across display resolutions
- Set `overflow: hidden` on the slide container to prevent scrollbars

**Minimal slide:**

```html
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>My Slide</title>
<style>
  *, *::before, *::after { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { width: 100%; height: 100%; overflow: hidden; }
  .slide {
    width: 100vw; height: 100vh; overflow: hidden;
    font-family: system-ui, sans-serif;
    display: flex; align-items: center; justify-content: center;
    background: #0a1628; color: #fff;
  }
  h1 { font-size: 8vmin; }
</style>
</head>
<body>
  <div class="slide">
    <h1>Hello World</h1>
  </div>
</body>
</html>
```

**Tips:**
- CSS animations and JS run when the slide is displayed — use this for entrance effects
- Each slide has its own DOM — no state leaks between slides
- The full power of HTML/CSS/JS is available: Canvas, SVG, WebGL, CSS animations, etc.

See `example/extracted/` for a complete sample deck, or `example/example.adsl` for the archived version.

## File Structure

```
auradeck/
├── src/                          # Frontend (HTML/CSS/JS)
│   ├── index.html                # Main app shell — editor, viewer, modals
│   ├── main.js                   # App startup, viewer, presenter mode, navigation
│   ├── editor.js                 # Ribbon editor — slide CRUD, save/export, CodeMirror
│   ├── presenter.html            # Presenter mode window (notes, next slide, timer)
│   ├── templates.js              # Slide templates for new slide/presentation creation
│   ├── style.css                 # Global styles (viewer, viewport, overlays)
│   ├── editor.css                # Editor styles (ribbon, panels, modals, CodeMirror theme)
│   └── vendor/                   # Third-party libraries (vendored, no bundler)
│       ├── codemirror/           # CodeMirror 5 — code editor
│       │   ├── codemirror.min.js
│       │   ├── codemirror.min.css
│       │   ├── mode/            # Language modes (xml, css, javascript, htmlmixed)
│       │   └── addon/hint/      # Autocomplete (show-hint, html-hint, css-hint, etc.)
│       ├── html2canvas.min.js    # HTML-to-canvas rendering (for PDF/PPTX export)
│       ├── jspdf.umd.min.js      # PDF generation
│       └── pptxgenjs.bundle.min.js  # PowerPoint generation
│
├── src-tauri/                    # Rust backend (Tauri 2)
│   ├── src/
│   │   ├── main.rs               # Entry point
│   │   └── lib.rs                # All commands — load/save presentations, slide CRUD,
│   │                             #   image inlining, global CSS, scratch presentations,
│   │                             #   export helpers, file dialogs
│   ├── tauri.conf.json           # Tauri config — window, CSP, bundle icons
│   ├── capabilities/
│   │   └── default.json          # Permission grants (windows, events, dialogs)
│   ├── icons/                    # App & file-type icons
│   │   ├── icon.svg              # Source SVG icon
│   │   ├── icon.png              # 256x256 default icon
│   │   ├── icon-{32,64,128,256,512}x{...}.png  # Multi-size PNGs
│   │   └── adsl-file.svg         # .adsl file-type icon
│   ├── Cargo.toml                # Rust dependencies
│   └── build.rs                  # Tauri build script
│
├── example/                      # Sample presentation
│   ├── example.adsl              # Archived version (.adsl = zip)
│   └── extracted/                # Unpacked folder version
│       ├── manifest.json
│       ├── *.html                # Slide files
│       └── images/               # SVG assets
│
├── linux/                        # Linux desktop integration
│   ├── install-mime.sh           # Installer — binary, MIME type, icons, .desktop
│   ├── celray-auradeck.desktop   # XDG desktop entry
│   └── auradeck-adsl.xml        # MIME type definition for .adsl
│
├── package.json                  # Node.js — Tauri CLI dependency
├── to.do                         # Known issues / future work
├── LICENSE                       # MIT
└── README.md
```

## License

MIT — Copyright 2026 Celray James
