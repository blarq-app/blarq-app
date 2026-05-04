#!/bin/bash
# Instala el LaunchAgent que corre el sync de PDFs SII todos los días a 9:00 AM.
#
# Uso:
#   bash scripts/launchd/install.sh
#
# Idempotente: lo podés correr varias veces, primero descarga el job anterior
# y vuelve a instalarlo.
#
# Para desinstalar: bash scripts/launchd/uninstall.sh
# Para correrlo a mano (sin esperar a las 9 AM): launchctl start com.blarq.sii-sync-pdfs
# Para ver logs: tail -f ~/Library/Logs/blarq-sii-sync-pdfs.log

set -e

LABEL="com.blarq.sii-sync-pdfs"
SOURCE_PLIST="$(cd "$(dirname "$0")" && pwd)/${LABEL}.plist"
TARGET_PLIST="$HOME/Library/LaunchAgents/${LABEL}.plist"
LOG_DIR="$HOME/Library/Logs"

if [ ! -f "$SOURCE_PLIST" ]; then
  echo "❌ No encuentro el plist en $SOURCE_PLIST"
  exit 1
fi

# Asegurar que el dir de logs existe.
mkdir -p "$LOG_DIR"
mkdir -p "$HOME/Library/LaunchAgents"

# Si ya estaba cargado, descargarlo primero (sin error si no estaba).
launchctl unload "$TARGET_PLIST" 2>/dev/null || true

# Copiar el plist a LaunchAgents.
cp "$SOURCE_PLIST" "$TARGET_PLIST"
echo "✅ Plist copiado a $TARGET_PLIST"

# Cargar el job.
launchctl load "$TARGET_PLIST"
echo "✅ LaunchAgent ${LABEL} cargado."

echo ""
echo "El sync va a correr automáticamente todos los días a las 9:00 AM."
echo ""
echo "Comandos útiles:"
echo "  Ver status:        launchctl list | grep blarq"
echo "  Correr ahora:      launchctl start ${LABEL}"
echo "  Ver logs:          tail -f $LOG_DIR/blarq-sii-sync-pdfs.log"
echo "  Desinstalar:       bash scripts/launchd/uninstall.sh"
