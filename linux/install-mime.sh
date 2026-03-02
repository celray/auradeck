#!/bin/bash
# Install AuraDeck binary, MIME type, file icon, and desktop entry on Linux
# Run after building: ./linux/install-mime.sh [--debug]

set -e
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$SCRIPT_DIR/.."
BIN_DIR="$HOME/.local/bin"
ICONS_DIR="$PROJECT_DIR/src-tauri/icons"
MIME_ICON_NAME="application-x-auradeck-slides"

# Choose release or debug binary
if [ "$1" = "--debug" ]; then
  BINARY="$PROJECT_DIR/src-tauri/target/debug/auradeck"
else
  BINARY="$PROJECT_DIR/src-tauri/target/release/auradeck"
fi

if [ ! -f "$BINARY" ]; then
  echo "Error: Binary not found at $BINARY"
  echo "Build first with: npm run tauri build"
  echo "Or use --debug flag to install the debug binary."
  exit 1
fi

echo "Installing binary to $BIN_DIR..."
mkdir -p "$BIN_DIR"
cp "$BINARY" "$BIN_DIR/auradeck"
chmod +x "$BIN_DIR/auradeck"

echo "Installing MIME type..."
xdg-mime install "$SCRIPT_DIR/auradeck-adsl.xml"

echo "Installing icons..."
for size in 32 64 128 256 512; do
  ICON_FILE="$ICONS_DIR/icon-${size}x${size}.png"
  if [ -f "$ICON_FILE" ]; then
    # App icon
    APP_DIR="$HOME/.local/share/icons/hicolor/${size}x${size}/apps"
    mkdir -p "$APP_DIR"
    cp "$ICON_FILE" "$APP_DIR/auradeck.png"

    # MIME type file icon
    MIME_DIR="$HOME/.local/share/icons/hicolor/${size}x${size}/mimetypes"
    mkdir -p "$MIME_DIR"
    cp "$ICON_FILE" "$MIME_DIR/${MIME_ICON_NAME}.png"

    echo "  ${size}x${size} installed"
  fi
done

# Also install the SVG versions for scalable
if [ -f "$ICONS_DIR/icon.svg" ]; then
  SVG_APP_DIR="$HOME/.local/share/icons/hicolor/scalable/apps"
  SVG_MIME_DIR="$HOME/.local/share/icons/hicolor/scalable/mimetypes"
  mkdir -p "$SVG_APP_DIR" "$SVG_MIME_DIR"
  cp "$ICONS_DIR/icon.svg" "$SVG_APP_DIR/auradeck.svg"
  cp "$ICONS_DIR/adsl-file.svg" "$SVG_MIME_DIR/${MIME_ICON_NAME}.svg"
  echo "  scalable SVGs installed"
fi

echo "Installing desktop entry..."
xdg-desktop-menu install "$SCRIPT_DIR/celray-auradeck.desktop"

echo "Updating caches..."
update-mime-database "$HOME/.local/share/mime" 2>/dev/null || true
gtk-update-icon-cache -f "$HOME/.local/share/icons/hicolor" 2>/dev/null || true

echo "Done. AuraDeck installed to $BIN_DIR/auradeck"
echo ".adsl files should now show the AuraDeck icon and open with AuraDeck."
