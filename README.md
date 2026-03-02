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

AuraDeck supports two formats:

- **Folder** — a directory with `manifest.json`, slide HTML files, and an `images/` folder
- **`.adsl` archive** — a zip file containing the same structure

### Folder structure

```
my-presentation/
  manifest.json        # slide order, metadata, author, theme
  a1b2c3d4.html        # slide files (random alphanumeric names)
  e5f6g7h8.html
  images/              # image assets referenced by slides
    hero-bg.svg
    chart.png
  global.css           # optional shared CSS injected into all slides
```

Each slide is a self-contained HTML file with inline CSS and JS, rendered at 16:9 aspect ratio.

See `example/extracted/` for a sample deck, or `example/example.adsl` for the archived version.

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
