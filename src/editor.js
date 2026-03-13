/**
 * AuraDeck Editor
 *
 * Handles: ribbon, slide panel, code editing (CodeMirror), preview, properties,
 * slide CRUD, global CSS, image import, templates, drag-reorder, and keyboard shortcuts.
 */

const Editor = (() => {
  const { invoke } = window.__TAURI__.core;

  // --- State ---
  let currentSlideIndex = 0;
  let totalSlides = 0;
  let presentationInfo = null;
  let globalCssCodeMirror = null;
  let isCodeMode = true;
  let isDirty = false;
  let selectedTemplate = 0;
  let thumbnailsEnabled = true;

  // Structured editor: multiple CodeMirror instances
  let cmInstances = { body: null, css: null, js: null, raw: null };
  let activePane = "body";

  // PDF export size presets (px for rendering, mm for PDF page)
  const PDF_SIZES = [
    { label: "1440p (2560 \u00d7 1440)",  pxW: 2560, pxH: 1440, mmW: 677.333, mmH: 381 },
    { label: "1080p (1920 \u00d7 1080)",  pxW: 1920, pxH: 1080, mmW: 508,     mmH: 285.75 },
    { label: "720p (1280 \u00d7 720)",    pxW: 1280, pxH: 720,  mmW: 338.667, mmH: 190.5 },
    { label: "A4 Landscape",         pxW: 1122, pxH: 794,  mmW: 297,     mmH: 210 },
    { label: "A4 Portrait",          pxW: 794,  pxH: 1122, mmW: 210,     mmH: 297 },
    { label: "Letter Landscape",     pxW: 1056, pxH: 816,  mmW: 279.4,   mmH: 215.9 },
    { label: "Letter Portrait",      pxW: 816,  pxH: 1056, mmW: 215.9,   mmH: 279.4 },
  ];

  // --- DOM refs (lazily cached) ---
  const $ = (id) => document.getElementById(id);

  function el(id) {
    return document.getElementById(id);
  }



  // --- Logging ---
  function log(...args) {
    console.log("[editor]", ...args);
  }

  // --- Toast notifications ---
  function toast(message, type = "info") {
    const container = el("toast-container");
    const t = document.createElement("div");
    t.className = `toast ${type}`;
    t.textContent = message;
    container.appendChild(t);
    setTimeout(() => {
      t.style.opacity = "0";
      t.style.transition = "opacity 0.3s";
      setTimeout(() => t.remove(), 300);
    }, 3000);
  }

  // --- Dirty state tracking ---
  function markDirty() {
    if (!isDirty) {
      isDirty = true;
      const s = el("status-saved");
      if (s) {
        s.textContent = "Unsaved";
        s.className = "unsaved";
      }
    }
  }

  function markClean() {
    isDirty = false;
    const s = el("status-saved");
    if (s) {
      s.textContent = "Saved";
      s.className = "saved";
    }
  }

  // --- Save confirmation dialog ---
  function confirmSaveBeforeAction(callback) {
    if (!isDirty) {
      callback();
      return;
    }

    const modal = el("save-confirm-modal");
    modal.classList.remove("hidden");

    const onSave = async () => {
      cleanup();
      await saveCurrentSlide();
      await invoke("save_presentation");
      callback();
    };
    const onDiscard = () => {
      cleanup();
      markClean();
      callback();
    };
    const onCancel = () => {
      cleanup();
    };

    function cleanup() {
      modal.classList.add("hidden");
      el("save-confirm-save").removeEventListener("click", onSave);
      el("save-confirm-discard").removeEventListener("click", onDiscard);
      el("save-confirm-cancel").removeEventListener("click", onCancel);
    }

    el("save-confirm-save").addEventListener("click", onSave);
    el("save-confirm-discard").addEventListener("click", onDiscard);
    el("save-confirm-cancel").addEventListener("click", onCancel);
  }

  // --- HTML parsing / reassembly for structured editing ---

  function parseSlideHTML(html) {
    // Extract CSS from <style>
    const styleMatch = html.match(/<style>([\s\S]*?)<\/style>/);
    const css = styleMatch ? styleMatch[1].trim() : "";

    // Extract JS from <script> in body
    const scriptMatch = html.match(/<body>[\s\S]*?<script>([\s\S]*?)<\/script>[\s\S]*?<\/body>/);
    const js = scriptMatch ? scriptMatch[1].trim() : "";

    // Extract body inner HTML (without script tags)
    const bodyMatch = html.match(/<body>([\s\S]*?)<\/body>/);
    let body = bodyMatch ? bodyMatch[1].trim() : html;
    body = body.replace(/<script>[\s\S]*?<\/script>/g, "").trim();

    return { css, body, js };
  }

  function assembleSlideHTML(css, body, js) {
    const title = el("slide-title")?.value || "Slide";
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Slide - ${title}</title>
<style>
${css}
</style>
</head>
<body>
${body}${js.trim() ? `\n<script>\n${js}\n</script>` : ""}
</body>
</html>`;
  }

  // --- CodeMirror initialization ---

  const cmExtraKeys = {
    "Ctrl-S": () => saveCurrentSlide(),
    "Cmd-S": () => saveCurrentSlide(),
    "Ctrl-Space": "autocomplete",
    Tab: (cm) => {
      if (cm.somethingSelected()) {
        cm.indentSelection("add");
      } else {
        cm.replaceSelection("  ", "end");
      }
    },
  };

  /** Pick the right hint function for a given CodeMirror mode */
  function hintForMode(mode) {
    if (typeof CodeMirror === "undefined" || !CodeMirror.hint) return undefined;
    if (mode === "htmlmixed") return CodeMirror.hint.html;
    if (mode === "css") return CodeMirror.hint.css;
    if (mode === "javascript") return CodeMirror.hint.javascript;
    return CodeMirror.hint.html;
  }

  function createCM(textareaId, mode) {
    if (typeof CodeMirror === "undefined") return null;
    const textarea = el(textareaId);
    if (!textarea) return null;
    const hintFn = hintForMode(mode);
    const cm = CodeMirror.fromTextArea(textarea, {
      mode,
      lineNumbers: true,
      lineWrapping: true,
      indentUnit: 2,
      tabSize: 2,
      indentWithTabs: false,
      extraKeys: cmExtraKeys,
      hintOptions: hintFn ? { hint: hintFn, completeSingle: false } : undefined,
    });
    cm.on("change", () => markDirty());

    // Auto-trigger hints on '<' (tag open) for HTML modes, or on letter input
    if (hintFn) {
      cm.on("inputRead", (editor, change) => {
        if (change.origin !== "+input") return;
        const ch = change.text[0];
        if (!ch) return;
        // Trigger on '<' for HTML, or on letter for CSS/JS property completion
        if (ch === "<" || ch === "/" || (mode !== "htmlmixed" && /[a-zA-Z-]/.test(ch))) {
          CodeMirror.commands.autocomplete(editor, null, { completeSingle: false });
        }
      });
    }

    return cm;
  }

  function initCodeMirror() {
    cmInstances.body = createCM("editor-body", "htmlmixed");
    cmInstances.css = createCM("editor-css", "css");
    cmInstances.js = createCM("editor-js", "javascript");
    cmInstances.raw = createCM("code-editor", "htmlmixed");
    log("CodeMirror initialized (structured)");
  }

  function getActiveCM() {
    return cmInstances[activePane];
  }

  function getCMValue(pane) {
    const cm = cmInstances[pane];
    if (cm) return cm.getValue();
    const ids = { body: "editor-body", css: "editor-css", js: "editor-js", raw: "code-editor" };
    return el(ids[pane])?.value || "";
  }

  function setCMValue(pane, value) {
    const cm = cmInstances[pane];
    if (cm) {
      cm.setValue(value);
      cm.clearHistory();
    } else {
      const ids = { body: "editor-body", css: "editor-css", js: "editor-js", raw: "code-editor" };
      const textarea = el(ids[pane]);
      if (textarea) textarea.value = value;
    }
  }

  /** Get the full HTML from whichever mode is active */
  function getEditorContent() {
    if (activePane === "raw") {
      return getCMValue("raw");
    }
    // Structured: reassemble from parts
    return assembleSlideHTML(getCMValue("css"), getCMValue("body"), getCMValue("js"));
  }

  /** Load full HTML into all structured panes */
  function setEditorContent(html) {
    // Always populate raw pane
    setCMValue("raw", html);

    // Parse into structured panes
    const parts = parseSlideHTML(html);
    setCMValue("body", parts.body);
    setCMValue("css", parts.css);
    setCMValue("js", parts.js);

    // Refresh visible pane
    setTimeout(() => {
      const cm = getActiveCM();
      if (cm) cm.refresh();
    }, 10);
  }

  function insertAtCursor(text) {
    const cm = getActiveCM();
    if (cm) {
      const cursor = cm.getCursor();
      cm.replaceRange(text, cursor);
      cm.focus();
    }
    markDirty();
  }

  function wrapSelection(before, after) {
    const cm = getActiveCM();
    if (cm) {
      const sel = cm.getSelection();
      cm.replaceSelection(before + sel + after);
      cm.focus();
    }
    markDirty();
  }

  // --- Structured tab switching ---
  function initStructuredTabs() {
    const tabs = document.querySelectorAll(".struct-tab");
    const panes = document.querySelectorAll(".struct-pane");

    tabs.forEach((tab) => {
      tab.addEventListener("click", () => {
        const pane = tab.dataset.pane;

        // If switching from structured to raw, sync raw content
        if (pane === "raw" && activePane !== "raw") {
          setCMValue("raw", getEditorContent());
        }
        // If switching from raw to structured, re-parse
        if (pane !== "raw" && activePane === "raw") {
          const html = getCMValue("raw");
          const parts = parseSlideHTML(html);
          setCMValue("body", parts.body);
          setCMValue("css", parts.css);
          setCMValue("js", parts.js);
        }

        activePane = pane;
        tabs.forEach((t) => t.classList.remove("active"));
        panes.forEach((p) => p.classList.remove("active"));
        tab.classList.add("active");
        el(`pane-${pane}`)?.classList.add("active");

        // Refresh the newly visible CodeMirror
        const cm = cmInstances[pane];
        if (cm) setTimeout(() => cm.refresh(), 10);
      });
    });
  }

  // --- Preview ---
  async function updatePreview() {
    const html = getEditorContent();
    const preview = el("visual-preview");
    const sidePreview = el("slide-preview");

    // Inline images via Rust so ./images/ paths resolve in srcdoc
    let rendered = html;
    try {
      rendered = await invoke("inline_slide_images", { html });
    } catch (_) {
      // fallback to raw html if command fails
    }

    if (preview && !preview.classList.contains("hidden")) {
      preview.srcdoc = rendered;
    }

    // Update side panel preview
    if (sidePreview) {
      sidePreview.srcdoc = rendered;
      // Scale to fit container
      const container = sidePreview.parentElement;
      if (container) {
        const cw = container.clientWidth;
        const scale = cw / 960;
        sidePreview.style.transform = `scale(${scale})`;
      }
    }
  }

  function updatePreviewDebounced() {
    clearTimeout(updatePreviewDebounced._timer);
    updatePreviewDebounced._timer = setTimeout(updatePreview, 500);
  }

  // --- Mode toggle (Code / Visual / Split) ---
  let currentEditMode = "split"; // default to split view

  function setEditMode(mode) {
    currentEditMode = mode;
    const codeBtn = el("btn-mode-code");
    const visualBtn = el("btn-mode-visual");
    const splitBtn = el("btn-mode-split");
    const editorContent = el("editor-content");
    const structuredEditor = el("structured-editor");
    const visualPreview = el("visual-preview");

    // Clear active states
    if (codeBtn) codeBtn.classList.remove("active");
    if (visualBtn) visualBtn.classList.remove("active");
    if (splitBtn) splitBtn.classList.remove("active");
    if (editorContent) editorContent.classList.remove("split-mode");

    if (mode === "code") {
      isCodeMode = true;
      if (codeBtn) codeBtn.classList.add("active");
      if (structuredEditor) structuredEditor.style.display = "";
      if (visualPreview) visualPreview.classList.add("hidden");
      const cm = getActiveCM();
      if (cm) setTimeout(() => cm.refresh(), 10);
      el("status-mode").textContent = "HTML";
    } else if (mode === "visual") {
      isCodeMode = false;
      if (visualBtn) visualBtn.classList.add("active");
      if (structuredEditor) structuredEditor.style.display = "none";
      if (visualPreview) visualPreview.classList.remove("hidden");
      updatePreview();
      el("status-mode").textContent = "Visual";
    } else {
      // split mode: code left, preview right
      isCodeMode = true;
      if (splitBtn) splitBtn.classList.add("active");
      if (editorContent) editorContent.classList.add("split-mode");
      if (structuredEditor) structuredEditor.style.display = "";
      if (visualPreview) visualPreview.classList.remove("hidden");
      const cm = getActiveCM();
      if (cm) setTimeout(() => cm.refresh(), 10);
      updatePreview();
      el("status-mode").textContent = "Split";
    }
  }

  // --- Slide panel ---
  async function refreshSlidePanel() {
    const list = el("slide-list");
    if (!list) return;

    try {
      totalSlides = await invoke("get_total_slides");
    } catch (e) {
      log("get_total_slides error:", e);
      return;
    }

    list.innerHTML = "";

    for (let i = 0; i < totalSlides; i++) {
      try {
        const info = await invoke("get_slide_info", { index: i });
        const item = document.createElement("div");
        item.className = `slide-item${i === currentSlideIndex ? " active" : ""}`;
        item.dataset.index = i;
        item.draggable = true;

        if (thumbnailsEnabled) {
          item.classList.add("has-thumbnail");

          // Thumbnail
          const thumb = document.createElement("div");
          thumb.className = "slide-item-thumbnail";
          const iframe = document.createElement("iframe");
          try {
            const slideHtml = await invoke("get_slide", { index: i });
            iframe.srcdoc = slideHtml;
          } catch (_) {
            /* ignore thumbnail errors */
          }
          thumb.appendChild(iframe);
          item.appendChild(thumb);

          // Info row
          const infoRow = document.createElement("div");
          infoRow.className = "slide-item-info";
          const num = document.createElement("span");
          num.className = "slide-item-number";
          num.textContent = `${i + 1}`;
          const title = document.createElement("span");
          title.className = "slide-item-title";
          title.textContent = info.title || `Slide ${i + 1}`;
          infoRow.appendChild(num);
          infoRow.appendChild(title);
          item.appendChild(infoRow);
        } else {
          const num = document.createElement("span");
          num.className = "slide-item-number";
          num.textContent = `${i + 1}`;
          const title = document.createElement("span");
          title.className = "slide-item-title";
          title.textContent = info.title || `Slide ${i + 1}`;
          item.appendChild(num);
          item.appendChild(title);
        }

        // Click to select
        item.addEventListener("click", () => loadSlide(i));

        // Right-click context menu
        item.addEventListener("contextmenu", (e) => {
          e.preventDefault();
          showContextMenu(e.clientX, e.clientY, i);
        });

        // Drag events
        item.addEventListener("dragstart", (e) => {
          e.dataTransfer.setData("text/plain", String(i));
          e.dataTransfer.effectAllowed = "move";
          item.style.opacity = "0.5";
        });

        item.addEventListener("dragend", () => {
          item.style.opacity = "";
        });

        item.addEventListener("dragover", (e) => {
          e.preventDefault();
          e.dataTransfer.dropEffect = "move";
          item.classList.add("drag-over");
        });

        item.addEventListener("dragleave", () => {
          item.classList.remove("drag-over");
        });

        item.addEventListener("drop", async (e) => {
          e.preventDefault();
          item.classList.remove("drag-over");
          const fromIndex = parseInt(e.dataTransfer.getData("text/plain"), 10);
          const toIndex = i;
          if (fromIndex !== toIndex) {
            await reorderSlide(fromIndex, toIndex);
          }
        });

        list.appendChild(item);
      } catch (e) {
        log("slide panel error for index", i, e);
      }
    }

    el("status-slide").textContent = `Slide ${currentSlideIndex + 1} / ${totalSlides}`;
  }

  // --- Context menu ---
  function showContextMenu(x, y, slideIndex) {
    closeContextMenu();

    const menu = document.createElement("div");
    menu.className = "context-menu";
    menu.id = "context-menu";
    menu.style.left = `${x}px`;
    menu.style.top = `${y}px`;

    const items = [
      {
        label: "Duplicate",
        action: () => duplicateSlide(slideIndex),
      },
      { label: "Move Up", action: () => moveSlide(slideIndex, -1) },
      { label: "Move Down", action: () => moveSlide(slideIndex, 1) },
      { separator: true },
      {
        label: "Delete",
        action: () => deleteSlide(slideIndex),
        danger: true,
      },
    ];

    for (const item of items) {
      if (item.separator) {
        const sep = document.createElement("div");
        sep.className = "context-menu-separator";
        menu.appendChild(sep);
      } else {
        const el = document.createElement("div");
        el.className = `context-menu-item${item.danger ? " danger" : ""}`;
        el.textContent = item.label;
        el.addEventListener("click", () => {
          closeContextMenu();
          item.action();
        });
        menu.appendChild(el);
      }
    }

    document.body.appendChild(menu);

    // Adjust position if off-screen
    const rect = menu.getBoundingClientRect();
    if (rect.right > window.innerWidth) {
      menu.style.left = `${window.innerWidth - rect.width - 8}px`;
    }
    if (rect.bottom > window.innerHeight) {
      menu.style.top = `${window.innerHeight - rect.height - 8}px`;
    }

    // Close on click outside
    setTimeout(() => {
      document.addEventListener("click", closeContextMenu, { once: true });
    }, 0);
  }

  function closeContextMenu() {
    const menu = document.getElementById("context-menu");
    if (menu) menu.remove();
  }

  // --- Slide CRUD ---
  async function loadSlide(index) {
    if (isDirty) {
      await saveCurrentSlide();
    }

    try {
      const raw = await invoke("get_slide_raw", { index });
      currentSlideIndex = index;

      setEditorContent(raw.html);
      el("slide-title").value = raw.title || "";
      el("slide-notes").value = raw.notes || "";
      el("slide-transition").value = raw.transition || "";

      markClean();
      updatePreview();
      highlightActiveSlide();
      el("status-slide").textContent = `Slide ${index + 1} / ${totalSlides}`;

      log("loaded slide", index, raw.title);
    } catch (e) {
      log("loadSlide error:", e);
      toast("Failed to load slide: " + e, "error");
    }
  }

  async function saveCurrentSlide() {
    try {
      const html = getEditorContent();
      const title = el("slide-title").value || `Slide ${currentSlideIndex + 1}`;
      const notes = el("slide-notes").value || null;
      const transition = el("slide-transition").value || null;

      await invoke("save_slide", {
        index: currentSlideIndex,
        html,
        title,
        notes,
        transition,
      });

      markClean();
      toast("Slide saved", "success");
      updatePreview();
      refreshSlidePanelLazy();
      log("saved slide", currentSlideIndex);
    } catch (e) {
      log("saveCurrentSlide error:", e);
      toast("Failed to save: " + e, "error");
    }
  }

  async function addNewSlide(templateHtml) {
    try {
      if (isDirty) await saveCurrentSlide();

      const theme = presentationInfo?.theme || {};
      const html = resolveTemplate(templateHtml, theme);

      const newIndex = await invoke("add_slide", {
        afterIndex: currentSlideIndex,
        html,
        title: "New Slide",
      });

      totalSlides++;
      currentSlideIndex = newIndex;
      await refreshSlidePanel();
      await loadSlide(newIndex);
      toast("Slide added", "success");
    } catch (e) {
      log("addNewSlide error:", e);
      toast("Failed to add slide: " + e, "error");
    }
  }

  async function duplicateSlide(index) {
    try {
      if (isDirty) await saveCurrentSlide();

      const newIndex = await invoke("duplicate_slide", {
        index: index !== undefined ? index : currentSlideIndex,
      });

      totalSlides++;
      currentSlideIndex = newIndex;
      await refreshSlidePanel();
      await loadSlide(newIndex);
      toast("Slide duplicated", "success");
    } catch (e) {
      log("duplicateSlide error:", e);
      toast("Failed to duplicate: " + e, "error");
    }
  }

  async function deleteSlide(index) {
    const idx = index !== undefined ? index : currentSlideIndex;
    if (totalSlides <= 1) {
      toast("Cannot delete the last slide", "error");
      return;
    }

    try {
      if (isDirty) await saveCurrentSlide();

      await invoke("delete_slide", { index: idx });

      totalSlides--;
      if (currentSlideIndex >= totalSlides) {
        currentSlideIndex = totalSlides - 1;
      }
      if (idx < currentSlideIndex) {
        currentSlideIndex--;
      }

      await refreshSlidePanel();
      await loadSlide(currentSlideIndex);
      toast("Slide deleted", "success");
    } catch (e) {
      log("deleteSlide error:", e);
      toast("Failed to delete: " + e, "error");
    }
  }

  async function moveSlide(fromIndex, direction) {
    const toIndex = fromIndex + direction;
    if (toIndex < 0 || toIndex >= totalSlides) return;
    await reorderSlide(fromIndex, toIndex);
  }

  async function reorderSlide(fromIndex, toIndex) {
    try {
      if (isDirty) await saveCurrentSlide();

      // Build new order array
      const order = Array.from({ length: totalSlides }, (_, i) => i);
      const [moved] = order.splice(fromIndex, 1);
      order.splice(toIndex, 0, moved);

      await invoke("reorder_slides", { newOrder: order });

      // Update current index
      if (currentSlideIndex === fromIndex) {
        currentSlideIndex = toIndex;
      } else if (
        fromIndex < currentSlideIndex &&
        toIndex >= currentSlideIndex
      ) {
        currentSlideIndex--;
      } else if (
        fromIndex > currentSlideIndex &&
        toIndex <= currentSlideIndex
      ) {
        currentSlideIndex++;
      }

      await refreshSlidePanel();
      toast("Slides reordered", "success");
    } catch (e) {
      log("reorderSlide error:", e);
      toast("Failed to reorder: " + e, "error");
    }
  }

  function highlightActiveSlide() {
    const items = document.querySelectorAll(".slide-item");
    items.forEach((item) => {
      if (parseInt(item.dataset.index, 10) === currentSlideIndex) {
        item.classList.add("active");
        item.scrollIntoView({ block: "nearest" });
      } else {
        item.classList.remove("active");
      }
    });
  }

  // Debounced slide panel refresh (avoids excessive calls during batch operations)
  function refreshSlidePanelLazy() {
    clearTimeout(refreshSlidePanelLazy._timer);
    refreshSlidePanelLazy._timer = setTimeout(refreshSlidePanel, 200);
  }

  // --- Ribbon tab switching ---
  function initRibbon() {
    const tabs = document.querySelectorAll(".ribbon-tab");
    const panels = document.querySelectorAll(".ribbon-panel");

    tabs.forEach((tab) => {
      tab.addEventListener("click", () => {
        tabs.forEach((t) => t.classList.remove("active"));
        panels.forEach((p) => p.classList.remove("active"));
        tab.classList.add("active");
        const target = tab.dataset.tab;
        const panel = document.querySelector(
          `.ribbon-panel[data-tab="${target}"]`
        );
        if (panel) panel.classList.add("active");
      });
    });
  }

  // --- Ribbon button handlers ---
  function initRibbonButtons() {
    // Home tab - Clipboard
    el("btn-cut")?.addEventListener("click", () => {
      const cm = getActiveCM();
      if (cm) {
        const sel = cm.getSelection();
        if (sel) {
          navigator.clipboard.writeText(sel);
          cm.replaceSelection("");
        }
      }
    });

    el("btn-copy")?.addEventListener("click", () => {
      const cm = getActiveCM();
      if (cm) {
        const sel = cm.getSelection();
        if (sel) navigator.clipboard.writeText(sel);
      }
    });

    el("btn-paste")?.addEventListener("click", async () => {
      const text = await navigator.clipboard.readText();
      insertAtCursor(text);
    });

    // Home tab - Text formatting
    el("btn-bold")?.addEventListener("click", () =>
      wrapSelection("<strong>", "</strong>")
    );
    el("btn-italic")?.addEventListener("click", () =>
      wrapSelection("<em>", "</em>")
    );
    el("btn-underline")?.addEventListener("click", () =>
      wrapSelection("<u>", "</u>")
    );

    el("font-size")?.addEventListener("change", (e) => {
      const size = e.target.value;
      wrapSelection(`<span style="font-size: ${size}">`, "</span>");
    });

    el("text-color")?.addEventListener("change", (e) => {
      const color = e.target.value;
      wrapSelection(`<span style="color: ${color}">`, "</span>");
    });

    // Home tab - Slide operations
    el("btn-new-slide")?.addEventListener("click", () => showNewSlideModal());
    el("btn-duplicate")?.addEventListener("click", () => duplicateSlide());
    el("btn-delete-slide")?.addEventListener("click", () => deleteSlide());

    // Insert tab
    el("btn-insert-image")?.addEventListener("click", importImage);
    el("btn-insert-textbox")?.addEventListener("click", () => {
      insertAtCursor(
        '\n<div style="padding: 2vmin; font-size: 2vmin;">\n  Your text here\n</div>\n'
      );
    });
    el("btn-insert-list")?.addEventListener("click", () => {
      insertAtCursor(
        "\n<ul>\n  <li>Item one</li>\n  <li>Item two</li>\n  <li>Item three</li>\n</ul>\n"
      );
    });
    el("btn-insert-link")?.addEventListener("click", () => {
      insertAtCursor('<a href="#" style="color: #e94560;">Link text</a>');
    });

    // Design tab
    el("btn-global-css")?.addEventListener("click", openGlobalCSSModal);
    el("btn-apply-theme")?.addEventListener("click", applyTheme);

    // Transitions tab
    el("transition-type")?.addEventListener("change", (e) => {
      el("slide-transition").value = e.target.value;
      markDirty();
    });
    el("btn-apply-transition-all")?.addEventListener(
      "click",
      applyTransitionToAll
    );

    // View tab
    el("btn-present")?.addEventListener("click", presentMode);
    el("btn-presenter-mode")?.addEventListener("click", presenterMode);
    el("btn-preview-slide")?.addEventListener("click", () => {
      setEditMode("visual");
      updatePreview();
    });
    el("btn-mode-code")?.addEventListener("click", () => setEditMode("code"));
    el("btn-mode-visual")?.addEventListener("click", () =>
      setEditMode("visual")
    );
    el("btn-mode-split")?.addEventListener("click", () =>
      setEditMode("split")
    );

    // Persistent Present button (always visible in ribbon)
    el("btn-present-always")?.addEventListener("click", presentMode);

    // File tab buttons
    el("btn-file-new")?.addEventListener("click", () => {
      confirmSaveBeforeAction(() => {
        showNewPresentationModal();
      });
    });
    el("btn-file-open-adsl")?.addEventListener("click", () => {
      confirmSaveBeforeAction(() => {
        if (typeof window.editFile === "function") {
          window.editFile();
        }
      });
    });
    el("btn-file-open-folder")?.addEventListener("click", () => {
      confirmSaveBeforeAction(() => {
        if (typeof window.editFolder === "function") {
          window.editFolder();
        }
      });
    });
    el("btn-file-save-adsl")?.addEventListener("click", saveAsAdsl);
    el("btn-file-export-folder")?.addEventListener("click", exportToFolder);
    el("btn-file-export-pdf")?.addEventListener("click", showPdfExportModal);
    // TODO: Re-enable PPTX export once rendering is fixed
    // el("btn-file-export-pptx")?.addEventListener("click", exportToPptx);

    // PDF export modal buttons
    el("pdf-export-go")?.addEventListener("click", exportToPdf);
    el("pdf-export-cancel")?.addEventListener("click", () => {
      el("pdf-export-modal").classList.add("hidden");
    });
    el("pdf-export-close")?.addEventListener("click", () => {
      el("pdf-export-modal").classList.add("hidden");
    });
  }

  // --- Properties panel ---
  function initProperties() {
    el("slide-title")?.addEventListener("input", markDirty);
    el("slide-notes")?.addEventListener("input", markDirty);
    el("slide-transition")?.addEventListener("change", markDirty);
  }

  // --- Image import ---
  async function importImage() {
    try {
      const result = await invoke("import_image");
      if (result) {
        insertAtCursor(`<img src="${result}" alt="image" style="max-width: 100%;">`);
        toast("Image imported", "success");
      }
    } catch (e) {
      log("importImage error:", e);
      toast("Failed to import image: " + e, "error");
    }
  }

  // --- Global CSS ---
  async function openGlobalCSSModal() {
    try {
      const css = await invoke("get_global_css");
      const modal = el("global-css-modal");
      const editor = el("global-css-editor");

      if (globalCssCodeMirror) {
        globalCssCodeMirror.setValue(css);
      } else if (typeof CodeMirror !== "undefined") {
        globalCssCodeMirror = CodeMirror.fromTextArea(editor, {
          mode: "css",
          lineNumbers: true,
          lineWrapping: true,
          indentUnit: 2,
          tabSize: 2,
          indentWithTabs: false,
        });
        globalCssCodeMirror.setValue(css);
      } else {
        editor.value = css;
      }

      modal.classList.remove("hidden");
      if (globalCssCodeMirror) {
        setTimeout(() => globalCssCodeMirror.refresh(), 50);
      }
    } catch (e) {
      log("openGlobalCSSModal error:", e);
      toast("Failed to load global CSS: " + e, "error");
    }
  }

  function initGlobalCSSModal() {
    el("global-css-save")?.addEventListener("click", async () => {
      try {
        const css = globalCssCodeMirror
          ? globalCssCodeMirror.getValue()
          : el("global-css-editor").value;
        await invoke("save_global_css", { css });
        el("global-css-modal").classList.add("hidden");
        toast("Global CSS saved", "success");
        updatePreview();
      } catch (e) {
        toast("Failed to save global CSS: " + e, "error");
      }
    });

    el("global-css-cancel")?.addEventListener("click", () => {
      el("global-css-modal").classList.add("hidden");
    });

    el("global-css-close")?.addEventListener("click", () => {
      el("global-css-modal").classList.add("hidden");
    });
  }

  // --- Theme ---
  async function applyTheme() {
    try {
      const theme = {
        background: el("theme-bg").value,
        foreground: el("theme-fg").value,
        accent: el("theme-accent").value,
        secondary: el("theme-secondary").value,
      };

      await invoke("update_manifest_metadata", { theme });
      if (presentationInfo) {
        presentationInfo.theme = theme;
      }
      toast("Theme updated", "success");
    } catch (e) {
      toast("Failed to update theme: " + e, "error");
    }
  }

  function loadThemeToUI(theme) {
    if (!theme) return;
    if (theme.background) el("theme-bg").value = theme.background;
    if (theme.foreground) el("theme-fg").value = theme.foreground;
    if (theme.accent) el("theme-accent").value = theme.accent;
    if (theme.secondary) el("theme-secondary").value = theme.secondary;
  }

  // --- Transitions ---
  async function applyTransitionToAll() {
    try {
      const transition = el("transition-type").value || null;
      for (let i = 0; i < totalSlides; i++) {
        const raw = await invoke("get_slide_raw", { index: i });
        await invoke("save_slide", {
          index: i,
          html: raw.html,
          title: raw.title,
          notes: raw.notes,
          transition,
        });
      }
      el("slide-transition").value = transition || "";
      toast("Transition applied to all slides", "success");
    } catch (e) {
      toast("Failed to apply transition: " + e, "error");
    }
  }

  // --- Present mode ---
  function presentMode() {
    if (isDirty) saveCurrentSlide();
    if (typeof window.enterViewerFromEditor === "function") {
      window.enterViewerFromEditor(currentSlideIndex);
    }
  }

  function presenterMode() {
    if (isDirty) saveCurrentSlide();
    if (typeof window.enterPresenterMode === "function") {
      window.enterPresenterMode(currentSlideIndex);
    }
  }

  // --- Save/Export ---
  async function saveAsAdsl() {
    try {
      if (isDirty) await saveCurrentSlide();
      await invoke("save_presentation");
      const result = await invoke("save_as_adsl");
      if (result) {
        toast("Saved as " + result.split("/").pop(), "success");
      }
    } catch (e) {
      toast("Failed to save .adsl: " + e, "error");
    }
  }

  async function exportToFolder() {
    try {
      if (isDirty) await saveCurrentSlide();
      await invoke("save_presentation");

      const folder = await invoke("open_folder_dialog");
      if (folder) {
        await invoke("export_to_folder", { destination: folder });
        toast("Exported to folder", "success");
      }
    } catch (e) {
      toast("Failed to export: " + e, "error");
    }
  }

  // --- Slide rendering helper (shared by PDF & PPTX export) ---
  async function renderAllSlides(progressCb, pxW = 1920, pxH = 1080) {
    if (isDirty) await saveCurrentSlide();
    await invoke("save_presentation");

    const count = await invoke("get_total_slides");
    const images = [];

    // Render at half-size with 2x scale for better text anti-aliasing
    const renderW = Math.round(pxW / 2);
    const renderH = Math.round(pxH / 2);

    // Use an offscreen iframe with the render viewport size
    const iframe = document.createElement("iframe");
    iframe.style.cssText = `position:fixed;left:-9999px;top:0;width:${renderW}px;height:${renderH}px;border:none;`;
    document.body.appendChild(iframe);

    for (let i = 0; i < count; i++) {
      if (progressCb) progressCb(i + 1, count);
      const html = await invoke("get_slide", { index: i });

      const iframeDoc = iframe.contentDocument || iframe.contentWindow.document;
      iframeDoc.open();
      iframeDoc.write(html);
      iframeDoc.close();

      // Wait for images to load
      await new Promise((r) => setTimeout(r, 300));

      // Finish all running animations so elements reach their end state
      // (makes fade-in, slide-in etc. fully visible for capture)
      try {
        const anims = iframeDoc.getAnimations({ subtree: true });
        anims.forEach((a) => a.finish());
      } catch (_) {
        // Fallback: force via CSS if getAnimations is unavailable
      }
      const freezeStyle = iframeDoc.createElement("style");
      freezeStyle.textContent = `*, *::before, *::after {
        animation-delay: 0s !important;
        animation-duration: 0s !important;
        animation-fill-mode: both !important;
        transition-duration: 0s !important;
        transition-delay: 0s !important;
      }`;
      iframeDoc.head.appendChild(freezeStyle);

      // Let the browser apply the forced end-states
      await new Promise((r) => setTimeout(r, 100));

      // Use foreignObjectRendering so the browser engine renders CSS natively
      // (handles vw/vh/vmin, gradients, backdrop-filter, animations correctly)
      const canvas = await html2canvas(iframeDoc.documentElement, {
        width: renderW,
        height: renderH,
        scale: 2,
        useCORS: true,
        backgroundColor: null,
        logging: false,
        windowWidth: renderW,
        windowHeight: renderH,
        foreignObjectRendering: true,
      });

      images.push(canvas);
    }

    document.body.removeChild(iframe);
    return images;
  }

  // --- PDF Export ---
  function showPdfExportModal() {
    const modal = el("pdf-export-modal");
    const sizeSelect = el("pdf-size-select");
    const customFields = el("pdf-custom-fields");

    // Populate size options
    sizeSelect.innerHTML = "";
    PDF_SIZES.forEach((s, i) => {
      const opt = document.createElement("option");
      opt.value = i;
      opt.textContent = s.label;
      sizeSelect.appendChild(opt);
    });
    const customOpt = document.createElement("option");
    customOpt.value = "custom";
    customOpt.textContent = "Custom";
    sizeSelect.appendChild(customOpt);

    // Default to 1080p
    sizeSelect.value = "1";
    customFields.classList.add("hidden");
    el("pdf-custom-w").value = "1920";
    el("pdf-custom-h").value = "1080";

    sizeSelect.onchange = () => {
      customFields.classList.toggle("hidden", sizeSelect.value !== "custom");
    };

    modal.classList.remove("hidden");
  }

  function getPdfExportSize() {
    const sizeSelect = el("pdf-size-select");
    if (sizeSelect.value === "custom") {
      const pxW = parseInt(el("pdf-custom-w").value, 10) || 1920;
      const pxH = parseInt(el("pdf-custom-h").value, 10) || 1080;
      // Convert px to mm at 96 DPI (1px = 25.4/96 mm)
      const mmW = pxW * 25.4 / 96;
      const mmH = pxH * 25.4 / 96;
      return { pxW, pxH, mmW, mmH };
    }
    return PDF_SIZES[parseInt(sizeSelect.value, 10)];
  }

  async function exportToPdf() {
    const size = getPdfExportSize();
    el("pdf-export-modal").classList.add("hidden");

    try {
      toast("Rendering slides for PDF...", "info");

      const images = await renderAllSlides((current, total) => {
        el("status-saved").textContent = `Exporting ${current}/${total}...`;
        el("status-saved").className = "unsaved";
      }, size.pxW, size.pxH);

      if (images.length === 0) {
        toast("No slides to export", "error");
        return;
      }

      const W = size.mmW;
      const H = size.mmH;
      const orientation = W >= H ? "landscape" : "portrait";
      const { jsPDF } = window.jspdf;
      const pdf = new jsPDF({ orientation, unit: "mm", format: [W, H] });

      for (let i = 0; i < images.length; i++) {
        if (i > 0) pdf.addPage([W, H], orientation);
        const imgData = images[i].toDataURL("image/jpeg", 0.85);
        pdf.addImage(imgData, "JPEG", 0, 0, W, H);
      }

      const pdfBytes = pdf.output("arraybuffer");
      const title = presentationInfo?.title || "presentation";
      const result = await invoke("save_export_file", {
        data: Array.from(new Uint8Array(pdfBytes)),
        defaultName: `${title}.pdf`,
        filterName: "PDF Document",
        filterExt: ["pdf"],
      });

      if (result) {
        toast("Exported to PDF", "success");
      }
      markClean();
    } catch (e) {
      log("exportToPdf error:", e);
      toast("Failed to export PDF: " + e, "error");
    }
  }

  // --- PPTX Export ---
  async function exportToPptx() {
    try {
      toast("Rendering slides for PowerPoint...", "info");

      const images = await renderAllSlides((current, total) => {
        el("status-saved").textContent = `Exporting ${current}/${total}...`;
        el("status-saved").className = "unsaved";
      });

      if (images.length === 0) {
        toast("No slides to export", "error");
        return;
      }

      const pptx = new PptxGenJS();
      // Standard PowerPoint widescreen: 13.333" x 7.5" (16:9)
      pptx.defineLayout({ name: "WIDE16x9", cx: 13.333, cy: 7.5 });
      pptx.layout = "WIDE16x9";

      if (presentationInfo?.title) {
        pptx.title = presentationInfo.title;
      }
      if (presentationInfo?.author) {
        pptx.author = presentationInfo.author;
      }

      for (const canvas of images) {
        const slide = pptx.addSlide();
        const imgData = canvas.toDataURL("image/png");
        slide.addImage({ data: imgData, x: 0, y: 0, w: 13.333, h: 7.5 });
      }

      const pptxBlob = await pptx.write({ outputType: "arraybuffer" });
      const title = presentationInfo?.title || "presentation";
      const result = await invoke("save_export_file", {
        data: Array.from(new Uint8Array(pptxBlob)),
        defaultName: `${title}.pptx`,
        filterName: "PowerPoint Presentation",
        filterExt: ["pptx"],
      });

      if (result) {
        toast("Exported to PowerPoint", "success");
      }
      markClean();
    } catch (e) {
      log("exportToPptx error:", e);
      toast("Failed to export PowerPoint: " + e, "error");
    }
  }

  function closeEditor() {
    confirmSaveBeforeAction(() => {
      // Create new scratch presentation
      if (typeof window.returnToWelcome === "function") {
        window.returnToWelcome();
      }
    });
  }

  // --- New Presentation Modal ---
  function showNewPresentationModal() {
    const modal = el("new-presentation-modal");
    el("new-pres-title").value = "New Presentation";
    el("new-pres-author").value = "";
    selectedTemplate = 0;
    populateTemplateGrid("template-grid", (idx) => {
      selectedTemplate = idx;
    });
    modal.classList.remove("hidden");
  }

  function initNewPresentationModal() {
    el("new-pres-create")?.addEventListener("click", async () => {
      const title = el("new-pres-title").value || "New Presentation";
      const author = el("new-pres-author").value || "Unknown";
      el("new-presentation-modal").classList.add("hidden");

      try {
        // Clean up old scratch and create a fresh one
        await invoke("cleanup_scratch");
        const info = await invoke("create_scratch_presentation");

        // Update title and author
        await invoke("update_manifest_metadata", {
          title,
          authorName: author,
        });
        info.title = title;
        info.author = author;

        presentationInfo = info;

        // If a non-blank template was selected, replace the first slide
        if (selectedTemplate > 0) {
          const template = SLIDE_TEMPLATES[selectedTemplate];
          const html = resolveTemplate(template.html, info.theme || {});
          await invoke("save_slide", {
            index: 0,
            html,
            title: template.name,
            notes: null,
            transition: "fade",
          });
        }

        await openEditor(info);
        toast("Presentation created", "success");
      } catch (e) {
        log("create presentation error:", e);
        toast("Failed to create: " + e, "error");
      }
    });

    el("new-pres-cancel")?.addEventListener("click", () => {
      el("new-presentation-modal").classList.add("hidden");
    });

    el("new-pres-close")?.addEventListener("click", () => {
      el("new-presentation-modal").classList.add("hidden");
    });
  }

  // --- New Slide Modal ---
  function showNewSlideModal() {
    const modal = el("new-slide-modal");
    populateTemplateGrid("slide-template-grid", async (idx) => {
      modal.classList.add("hidden");
      const template = SLIDE_TEMPLATES[idx];
      await addNewSlide(template.html);
    });
    modal.classList.remove("hidden");
  }

  function initNewSlideModal() {
    el("new-slide-close")?.addEventListener("click", () => {
      el("new-slide-modal").classList.add("hidden");
    });
  }

  // --- Template grid ---
  function populateTemplateGrid(containerId, onSelect) {
    const grid = el(containerId);
    if (!grid) return;
    grid.innerHTML = "";

    SLIDE_TEMPLATES.forEach((template, idx) => {
      const card = document.createElement("div");
      card.className = `template-card${idx === 0 ? " selected" : ""}`;
      card.innerHTML = `
        <div class="template-card-preview">${template.preview}</div>
        <div class="template-card-name">${template.name}</div>
      `;
      card.addEventListener("click", () => {
        grid
          .querySelectorAll(".template-card")
          .forEach((c) => c.classList.remove("selected"));
        card.classList.add("selected");
        onSelect(idx);
      });
      grid.appendChild(card);
    });
  }

  // --- Keyboard shortcuts ---
  function initKeyboardShortcuts() {
    document.addEventListener("keydown", (e) => {
      // Only handle if editor is visible
      if (el("editor")?.classList.contains("hidden")) return;

      // Ctrl+S: Save
      if ((e.ctrlKey || e.metaKey) && e.key === "s") {
        e.preventDefault();
        saveCurrentSlide();
        return;
      }

      // Ctrl+N: New slide
      if ((e.ctrlKey || e.metaKey) && e.key === "n") {
        e.preventDefault();
        showNewSlideModal();
        return;
      }

      // Ctrl+D: Duplicate slide
      if ((e.ctrlKey || e.metaKey) && e.key === "d") {
        e.preventDefault();
        duplicateSlide();
        return;
      }

      // Delete key (when not in editor): Delete slide
      if (
        e.key === "Delete" &&
        document.activeElement !== el("code-editor") &&
        !document.activeElement?.closest?.(".CodeMirror")
      ) {
        e.preventDefault();
        deleteSlide();
        return;
      }

      // F5: Present
      if (e.key === "F5") {
        e.preventDefault();
        presentMode();
        return;
      }

      // F6: Presenter Mode
      if (e.key === "F6") {
        e.preventDefault();
        presenterMode();
        return;
      }

      // Escape: Close modals or exit to welcome
      if (e.key === "Escape") {
        const modals = document.querySelectorAll(".modal:not(.hidden)");
        if (modals.length > 0) {
          modals.forEach((m) => m.classList.add("hidden"));
          return;
        }
      }
    });
  }

  // --- Textarea fallback Ctrl+S ---
  function initTextareaShortcuts() {
    el("code-editor")?.addEventListener("keydown", (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "s") {
        e.preventDefault();
        saveCurrentSlide();
      }
    });
  }

  // --- Editor open/close ---
  async function openEditor(info) {
    presentationInfo = info;
    totalSlides = info.total_slides;
    currentSlideIndex = 0;
    isDirty = false;

    loadThemeToUI(info.theme);
    await refreshSlidePanel();
    await loadSlide(0);

    // Set window title
    try {
      const { getCurrentWindow } = window.__TAURI__.window;
      await getCurrentWindow().setTitle(`AuraDeck Editor — ${info.title}`);
    } catch (_) {}

    markClean();
    setEditMode("split"); // default to split view
  }

  // --- Preview scaling ---
  function initPreviewScaling() {
    const resizeObserver = new ResizeObserver(() => {
      const container = el("slide-preview")?.parentElement;
      if (container) {
        const cw = container.clientWidth;
        const scale = cw / 960;
        const iframe = el("slide-preview");
        if (iframe) iframe.style.transform = `scale(${scale})`;
      }
    });

    const previewContainer = document.querySelector(".preview-container");
    if (previewContainer) resizeObserver.observe(previewContainer);
  }

  // --- Split divider drag-to-resize ---
  function initSplitDivider() {
    const divider = el("split-divider");
    const editorContent = el("editor-content");
    if (!divider || !editorContent) return;

    let dragging = false;

    divider.addEventListener("mousedown", (e) => {
      e.preventDefault();
      dragging = true;
      divider.classList.add("dragging");
      editorContent.classList.add("resizing");

      const onMouseMove = (e) => {
        if (!dragging) return;
        const rect = editorContent.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const pct = Math.min(Math.max((x / rect.width) * 100, 15), 85);
        editorContent.style.setProperty("--split-code-width", `${pct}%`);

        // Refresh CodeMirror to match new width
        const activeCM = getActiveCM();
        if (activeCM) activeCM.refresh();
      };

      const onMouseUp = () => {
        dragging = false;
        divider.classList.remove("dragging");
        editorContent.classList.remove("resizing");
        document.removeEventListener("mousemove", onMouseMove);
        document.removeEventListener("mouseup", onMouseUp);
        const activeCM = getActiveCM();
        if (activeCM) activeCM.refresh();
      };

      document.addEventListener("mousemove", onMouseMove);
      document.addEventListener("mouseup", onMouseUp);
    });
  }

  // --- Init ---
  function init() {
    initCodeMirror();
    initStructuredTabs();
    initRibbon();
    initRibbonButtons();
    initProperties();
    initGlobalCSSModal();
    initNewPresentationModal();
    initNewSlideModal();
    initKeyboardShortcuts();
    initTextareaShortcuts();
    initPreviewScaling();
    initSplitDivider();

    // Auto-update preview when any CodeMirror instance changes
    for (const key of Object.keys(cmInstances)) {
      if (cmInstances[key]) {
        cmInstances[key].on("change", updatePreviewDebounced);
      }
    }
    // Fallback for textareas if CodeMirror didn't load
    if (!cmInstances.body) {
      for (const id of ["editor-body", "editor-css", "editor-js", "code-editor"]) {
        el(id)?.addEventListener("input", updatePreviewDebounced);
      }
    }

    log("editor initialized");
  }

  // Initialize when DOM is ready
  try {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", init);
    } else {
      init();
    }
  } catch (e) {
    console.error("[editor] init failed:", e);
  }

  // Public API
  return {
    openEditor,
    showNewPresentationModal,
    saveCurrentSlide,
    confirmSaveBeforeAction,
    get currentSlideIndex() {
      return currentSlideIndex;
    },
    get isDirty() {
      return isDirty;
    },
  };
})();
