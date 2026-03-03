const { invoke } = window.__TAURI__.core;
const { getCurrentWindow } = window.__TAURI__.window;

const viewport = document.getElementById("viewport");
const editorDiv = document.getElementById("editor");
const frameA = document.getElementById("frame-a");
const frameB = document.getElementById("frame-b");
const counter = document.getElementById("counter");

let currentIndex = -1;
let totalSlides = 0;
let activeFrame = frameA;
let bufferFrame = frameB;
let isTransitioning = false;
let currentMode = "editor"; // "viewer" | "editor"
let loadedPath = null; // Track the currently loaded presentation path

function log(...args) {
  console.log("[auradeck]", ...args);
}

function logError(...args) {
  console.error("[auradeck]", ...args);
}

// --- Simple toast for main.js (independent of Editor) ---
function showToast(message, type) {
  const container = document.getElementById("toast-container");
  if (!container) return;
  const t = document.createElement("div");
  t.className = `toast ${type || "info"}`;
  t.textContent = message;
  container.appendChild(t);
  setTimeout(() => {
    t.style.opacity = "0";
    t.style.transition = "opacity 0.3s";
    setTimeout(() => t.remove(), 300);
  }, 3000);
}

// --- Mode switching ---

function showViewer() {
  currentMode = "viewer";
  viewport.classList.remove("hidden");
  editorDiv.classList.add("hidden");
  initPenIcon();
}

function showEditor() {
  currentMode = "editor";
  viewport.classList.add("hidden");
  editorDiv.classList.remove("hidden");
  hidePenIcon();
}

// Global function: create new scratch and open editor
window.returnToWelcome = async function () {
  try {
    await invoke("cleanup_scratch");
    const info = await invoke("create_scratch_presentation");
    loadedPath = null;
    showEditor();
    if (typeof Editor !== "undefined" && Editor && Editor.openEditor) {
      await Editor.openEditor(info);
    }
    getCurrentWindow().setTitle("AuraDeck").catch(() => {});
  } catch (e) {
    logError("returnToWelcome (scratch) failed:", e);
  }
};

// Global function for editor to enter viewer from editor
window.enterViewerFromEditor = async function (startSlide) {
  showViewer();
  currentIndex = -1;
  totalSlides = await invoke("get_total_slides");
  await showSlide(startSlide || 0);
};

// Expose editFile/editFolder on window for editor.js File tab
window.editFile = editFile;
window.editFolder = editFolder;

// --- Presenter mode ---

let presenterWindow = null;
let isAudienceMode = false;

let presenterUnlisten = null;

window.enterPresenterMode = async function (startSlide) {
  try {
    const { WebviewWindow } = window.__TAURI__.webviewWindow;
    const { emit, listen } = window.__TAURI__.event;

    log("launching presenter window...");

    // Open presenter view in a new window
    presenterWindow = new WebviewWindow("presenter", {
      url: `presenter.html?slide=${startSlide || 0}`,
      title: "AuraDeck — Presenter",
      width: 1200,
      height: 700,
      resizable: true,
    });

    presenterWindow.once("tauri://created", () => {
      log("presenter window created — move it to your second monitor and press F to fullscreen");
    });

    presenterWindow.once("tauri://error", (e) => {
      logError("presenter window error:", e);
    });

    // If presenter window is closed externally (X button, killed, etc.), exit audience mode
    presenterWindow.once("tauri://destroyed", async () => {
      log("presenter window destroyed");
      if (isAudienceMode) {
        await exitPresenterMode();
      }
    });

    // Listen for commands from presenter window via Tauri events
    presenterUnlisten = await listen("presenter-cmd", async (event) => {
      const data = event.payload;
      if (data.cmd === "slide") {
        await showSlide(data.index);
      } else if (data.cmd === "exit") {
        await exitPresenterMode();
      }
    });

    // Enter audience mode (fullscreen viewer)
    isAudienceMode = true;
    showViewer();
    currentIndex = -1;
    totalSlides = await invoke("get_total_slides");
    await showSlide(startSlide || 0);
    const appWindow = getCurrentWindow();
    await appWindow.setFullscreen(true);
  } catch (e) {
    logError("enterPresenterMode failed:", e);
  }
};

async function exitPresenterMode() {
  if (!isAudienceMode) return;
  isAudienceMode = false;
  if (presenterUnlisten) { presenterUnlisten(); presenterUnlisten = null; }
  try {
    const appWindow = getCurrentWindow();
    await appWindow.setFullscreen(false);
  } catch (_) {}
  if (presenterWindow) {
    try { await presenterWindow.close(); } catch (_) {}
    presenterWindow = null;
  }
  showEditor();
}

// --- Pen (edit) icon in viewer mode ---

let penTimeout = null;
let penIcon = null;

function createPenIcon() {
  if (penIcon) return penIcon;
  penIcon = document.createElement("div");
  penIcon.id = "pen-icon";
  penIcon.innerHTML = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.83 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="m15 5 4 4"/></svg>`;
  penIcon.title = "Edit this presentation";
  penIcon.addEventListener("click", () => {
    if (loadedPath) {
      loadPresentationForEditing(loadedPath);
    }
  });
  viewport.appendChild(penIcon);
  return penIcon;
}

function initPenIcon() {
  createPenIcon();
  penIcon.classList.remove("visible");

  // Show pen on mouse move, hide after 5s
  viewport.addEventListener("mousemove", onViewerMouseMove);
}

function hidePenIcon() {
  if (penIcon) penIcon.classList.remove("visible");
  viewport.removeEventListener("mousemove", onViewerMouseMove);
  clearTimeout(penTimeout);
}

function onViewerMouseMove() {
  if (currentMode !== "viewer" || !penIcon) return;
  penIcon.classList.add("visible");
  clearTimeout(penTimeout);
  penTimeout = setTimeout(() => {
    if (penIcon) penIcon.classList.remove("visible");
  }, 5000);
}

// --- File open handlers ---

async function editFile() {
  try {
    log("opening file dialog for editing...");
    const file = await invoke("open_presentation_dialog");
    log("edit dialog returned:", file);
    if (file) {
      await loadPresentationForEditing(file);
    }
  } catch (e) {
    logError("editFile failed:", e);
    showToast("Failed to open for editing: " + e, "error");
  }
}

async function editFolder() {
  try {
    log("opening folder dialog for editing...");
    const folder = await invoke("open_folder_dialog");
    log("edit folder dialog returned:", folder);
    if (folder) {
      await loadPresentationForEditing(folder);
    }
  } catch (e) {
    logError("editFolder failed:", e);
    showToast("Failed to open for editing: " + e, "error");
  }
}

// --- Load presentation (editor mode) ---

async function loadPresentationForEditing(folder) {
  try {
    log("loading presentation for editing:", folder);
    await invoke("cleanup_scratch");
    const info = await invoke("load_presentation", { folder });
    log("loaded for editing:", info);
    loadedPath = folder;

    showEditor();

    if (typeof Editor !== "undefined" && Editor && Editor.openEditor) {
      await Editor.openEditor(info);
    } else {
      logError("Editor module not available");
      showToast("Editor failed to initialize. Check console for errors.", "error");
    }
  } catch (e) {
    logError("loadPresentationForEditing failed:", e);
    showToast("Failed to open for editing: " + e, "error");
  }
}

// --- Viewer slide display ---

async function showSlide(index) {
  if (index < 0 || index >= totalSlides) return;
  if (isTransitioning) return;

  isTransitioning = true;
  currentIndex = index;

  try {
    log("showing slide", index);
    const html = await invoke("get_slide", { index });
    const slideInfo = await invoke("get_slide_info", { index });

    log("slide loaded:", slideInfo.title, `(${html.length} chars)`);

    bufferFrame.srcdoc = html;

    bufferFrame.onload = async () => {
      log("iframe loaded for slide", index);
      bufferFrame.classList.add("active");
      activeFrame.classList.remove("active");

      // Notify the slide it is now visible so JS animations can start.
      try { bufferFrame.contentWindow.postMessage({ type: "auradeck-visible" }, "*"); } catch (_) {}

      try {
        const appWindow = getCurrentWindow();
        await appWindow.setTitle(
          `AuraDeck — ${slideInfo.title} (${index + 1}/${totalSlides})`
        );
      } catch (e) {
        logError("setTitle failed:", e);
      }

      counter.textContent = `${index + 1} / ${totalSlides}`;

      const temp = activeFrame;
      activeFrame = bufferFrame;
      bufferFrame = temp;

      document.body.focus();

      setTimeout(() => {
        isTransitioning = false;
      }, 450);
    };
  } catch (e) {
    logError("showSlide failed:", e);
    isTransitioning = false;
  }
}

function nextSlide() {
  if (currentIndex < totalSlides - 1) {
    showSlide(currentIndex + 1);
  }
}

function prevSlide() {
  if (currentIndex > 0) {
    showSlide(currentIndex - 1);
  }
}

async function toggleFullscreen() {
  try {
    const appWindow = getCurrentWindow();
    const isFull = await appWindow.isFullscreen();
    await appWindow.setFullscreen(!isFull);
  } catch (e) {
    logError("toggleFullscreen failed:", e);
  }
}

// --- Keyboard events ---

document.addEventListener("keydown", async (e) => {
  // Viewer-mode shortcuts (disabled when presenter is in control)
  if (currentMode === "viewer" && !isAudienceMode) {
    switch (e.key) {
      case "ArrowRight":
      case "ArrowDown":
      case " ":
        e.preventDefault();
        nextSlide();
        break;
      case "ArrowLeft":
      case "ArrowUp":
        e.preventDefault();
        prevSlide();
        break;
      case "Home":
        e.preventDefault();
        showSlide(0);
        break;
      case "End":
        e.preventDefault();
        showSlide(totalSlides - 1);
        break;
      case "f":
      case "F":
        e.preventDefault();
        await toggleFullscreen();
        break;
      case "Escape":
        e.preventDefault();
        try {
          const appWindow = getCurrentWindow();
          if (isAudienceMode) {
            await exitPresenterMode();
          } else if (await appWindow.isFullscreen()) {
            await appWindow.setFullscreen(false);
          } else {
            // Return to editor, not welcome
            showEditor();
          }
        } catch (e2) {
          logError("escape failed:", e2);
        }
        break;
    }
  }
});

// --- Startup ---

(async () => {
  try {
    log("checking for initial path...");
    const initialPath = await invoke("get_initial_path");
    log("initial path:", initialPath);
    if (initialPath) {
      // CLI arg: open directly in editor
      await loadPresentationForEditing(initialPath);
    } else {
      // No arg: create scratch presentation and open editor
      const info = await invoke("create_scratch_presentation");
      log("scratch presentation created:", info);
      showEditor();
      if (typeof Editor !== "undefined" && Editor && Editor.openEditor) {
        await Editor.openEditor(info);
      }
    }
  } catch (e) {
    logError("startup failed:", e);
  }
})();
