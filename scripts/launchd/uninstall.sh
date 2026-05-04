#!/bin/bash
# Desinstala el LaunchAgent del sync SII PDFs.
#
# Uso:
#   bash scripts/launchd/uninstall.sh

set -e

LABEL="com.blarq.sii-sync-pdfs"
TARGET_PLIST="$HOME/Library/LaunchAgents/${LABEL}.plist"

# Descargar el job (sin error si no está cargado).
launchctl unload "$TARGET_PLIST" 2>/dev/null || true

# Borrar el plist.
if [ -f "$TARGET_PLIST" ]; then
  rm "$TARGET_PLIST"
  echo "✅ Plist eliminado: $TARGET_PLIST"
else
  echo "ℹ️  No había plist instalado."
fi

echo "✅ LaunchAgent ${LABEL} desinstalado."
echo ""
echo "Los logs en ~/Library/Logs/blarq-sii-sync-pdfs.log siguen ahí (borralos a mano si querés)."
