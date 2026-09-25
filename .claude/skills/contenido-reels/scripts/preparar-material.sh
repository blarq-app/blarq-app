#!/usr/bin/env bash
# Prepara una carpeta de material de obra (fotos y videos del celular) para que la IA la pueda "ver".
#
# Por qué existe: Claude lee imágenes, pero no reproduce video ni lee HEIC (el formato de fotos del
# iPhone). Este script deja todo en algo que sí puede leer:
#   - cada foto → JPEG de máximo 1600 px de lado (más liviano, mismo contenido útil)
#   - cada video → una "hoja de contacto": 12 cuadros repartidos a lo largo del video en una sola
#     imagen (4 columnas x 3 filas), más duración, orientación, fecha y si trae audio
#   - un índice.md con todo lo anterior, para que el análisis cite archivos y segundos concretos
#
# No toca los originales. Escribe todo en <carpeta>/_ia/.
#
# Uso:  bash preparar-material.sh "<carpeta con fotos y videos>"
# Requiere ffmpeg (en el Mac: `brew install ffmpeg`). En el Mac usa `sips` (viene con macOS) para las
# fotos HEIC; en otro sistema las HEIC se saltan con aviso.
#
# Ojo: escrito para el bash 3.2 que trae macOS (sin arreglos asociativos ni ${var,,}).

set -u

CARPETA="${1:-}"
if [ -z "$CARPETA" ] || [ ! -d "$CARPETA" ]; then
  echo "Uso: bash preparar-material.sh \"<carpeta>\"" >&2
  exit 1
fi
if ! command -v ffmpeg >/dev/null 2>&1; then
  echo "Falta ffmpeg. En el Mac: brew install ffmpeg" >&2
  exit 1
fi
TIENE_SIPS=0
command -v sips >/dev/null 2>&1 && TIENE_SIPS=1

CUADROS=12          # cuadros por hoja de contacto (4x3)
LADO_FOTO=1600      # lado máximo de las fotos convertidas

SALIDA="$CARPETA/_ia"
mkdir -p "$SALIDA/fotos" "$SALIDA/videos"
INDICE="$SALIDA/indice.md"

{
  echo "# Material preparado para análisis"
  echo
  echo "Carpeta: \`$CARPETA\`  "
  echo "Preparado: $(date '+%Y-%m-%d %H:%M')"
  echo
} > "$INDICE"

minusculas() { printf '%s' "$1" | tr '[:upper:]' '[:lower:]'; }

# Lee de la salida de `ffmpeg -i` lo que necesitamos, sin depender de ffprobe (no siempre viene).
info_video() {
  ffmpeg -hide_banner -i "$1" 2>&1 < /dev/null
}

N_FOTOS=0
N_VIDEOS=0
N_SALTADOS=0
FILAS_FOTOS=""
FILAS_VIDEOS=""

# Orden alfabético = orden de la cámara (IMG_0001, IMG_0002...), que suele ser el orden en que se grabó.
LISTA=$(find "$CARPETA" -maxdepth 1 -type f ! -name '.*' | LC_ALL=C sort)

# Heredoc y no pipe: así los contadores sobreviven al while. Por lo mismo, todo ffmpeg adentro lee de
# /dev/null (si no, se come la lista de archivos).
while IFS= read -r ARCHIVO; do
  [ -z "$ARCHIVO" ] && continue
  NOMBRE=$(basename "$ARCHIVO")
  BASE="${NOMBRE%.*}"
  EXT=$(minusculas "${NOMBRE##*.}")

  case "$EXT" in
    jpg|jpeg|png|webp|heic|heif)
      DESTINO="$SALIDA/fotos/$BASE.jpg"
      if [ "$TIENE_SIPS" -eq 1 ]; then
        sips -s format jpeg -Z "$LADO_FOTO" "$ARCHIVO" --out "$DESTINO" >/dev/null 2>&1
      elif [ "$EXT" = "heic" ] || [ "$EXT" = "heif" ]; then
        echo "Aviso: $NOMBRE es HEIC y sin sips no se puede convertir — se salta." >&2
        N_SALTADOS=$((N_SALTADOS + 1))
        continue
      else
        ffmpeg -loglevel error -y -i "$ARCHIVO" \
          -vf "scale='if(gt(iw,ih),min($LADO_FOTO,iw),-2)':'if(gt(iw,ih),-2,min($LADO_FOTO,ih))'" \
          -q:v 3 "$DESTINO" < /dev/null
      fi
      if [ -f "$DESTINO" ]; then
        N_FOTOS=$((N_FOTOS + 1))
        FILAS_FOTOS="$FILAS_FOTOS| $NOMBRE | \`_ia/fotos/$BASE.jpg\` |
"
      else
        echo "Aviso: no se pudo convertir $NOMBRE" >&2
        N_SALTADOS=$((N_SALTADOS + 1))
      fi
      ;;

    mov|mp4|m4v)
      INFO=$(info_video "$ARCHIVO")
      DUR_TXT=$(printf '%s\n' "$INFO" | grep -m1 'Duration:' | sed -E 's/.*Duration: ([0-9:.]+).*/\1/')
      DUR=$(printf '%s' "$DUR_TXT" | awk -F: '{ printf "%.1f", ($1*3600)+($2*60)+$3 }')
      # Dimensiones codificadas y rotación: el iPhone guarda los videos verticales como horizontales
      # con una marca de "rotar 90°". ffmpeg rota solo al extraer cuadros; acá solo lo informamos bien.
      DIM=$(printf '%s\n' "$INFO" | grep -m1 'Video:' | grep -oE '[0-9]{3,5}x[0-9]{3,5}' | head -1)
      ANCHO=${DIM%x*}
      ALTO=${DIM#*x}
      if printf '%s\n' "$INFO" | grep -qE 'rotation of -?(90|270)\.|rotate +: (90|270)'; then
        TMP=$ANCHO; ANCHO=$ALTO; ALTO=$TMP
      fi
      if [ -n "$ANCHO" ] && [ -n "$ALTO" ] && [ "$ALTO" -gt "$ANCHO" ]; then
        ORIENT="vertical"
      else
        ORIENT="horizontal"
      fi
      FECHA=$(printf '%s\n' "$INFO" | grep -m1 'com.apple.quicktime.creationdate' | sed -E 's/.*: //')
      [ -z "$FECHA" ] && FECHA=$(printf '%s\n' "$INFO" | grep -m1 'creation_time' | sed -E 's/.*: //')
      if printf '%s\n' "$INFO" | grep -q 'Audio:'; then AUDIO="sí"; else AUDIO="no"; fi

      HOJA="$SALIDA/videos/${BASE}_hoja.jpg"
      # 12 cuadros repartidos parejo en toda la duración. Cada cuadro con el lado largo en 320 px.
      TASA=$(awk -v d="$DUR" -v n="$CUADROS" 'BEGIN { if (d <= 0) d = 1; printf "%.5f", n / d }')
      ffmpeg -loglevel error -y -i "$ARCHIVO" \
        -vf "fps=$TASA,scale='if(gt(iw,ih),320,-2)':'if(gt(iw,ih),-2,320)',tile=4x3:padding=4:color=white" \
        -frames:v 1 -q:v 3 "$HOJA" < /dev/null

      # Segundo aproximado de cada cuadro, para poder decir "el cuadro 7 (seg 12,6) sirve de portada".
      TIEMPOS=$(awk -v d="$DUR" -v n="$CUADROS" 'BEGIN {
        for (i = 0; i < n; i++) { printf "%s%d:%.1fs", (i ? " · " : ""), i + 1, i * d / n }
      }')

      if [ -f "$HOJA" ]; then
        N_VIDEOS=$((N_VIDEOS + 1))
        FILAS_VIDEOS="$FILAS_VIDEOS| $NOMBRE | ${DUR}s | $ORIENT (${ANCHO}x${ALTO}) | $AUDIO | ${FECHA:-—} | \`_ia/videos/${BASE}_hoja.jpg\` |
"
        FILAS_VIDEOS="$FILAS_VIDEOS|  | cuadros → $TIEMPOS |  |  |  |  |
"
      else
        echo "Aviso: no se pudo leer el video $NOMBRE" >&2
        N_SALTADOS=$((N_SALTADOS + 1))
      fi
      ;;

    *)
      ;;
  esac
done <<EOF
$LISTA
EOF

{
  echo "## Fotos ($N_FOTOS)"
  echo
  if [ "$N_FOTOS" -gt 0 ]; then
    echo "| Original | Para leer |"
    echo "|---|---|"
    printf '%s' "$FILAS_FOTOS"
  else
    echo "Sin fotos."
  fi
  echo
  echo "## Videos ($N_VIDEOS)"
  echo
  if [ "$N_VIDEOS" -gt 0 ]; then
    echo "Cada hoja de contacto tiene $CUADROS cuadros, de izquierda a derecha y de arriba abajo."
    echo
    echo "| Original | Duración | Orientación | Audio | Fecha | Hoja de contacto |"
    echo "|---|---|---|---|---|---|"
    printf '%s' "$FILAS_VIDEOS"
  else
    echo "Sin videos."
  fi
  echo
  [ "$N_SALTADOS" -gt 0 ] && echo "Archivos que no se pudieron procesar: $N_SALTADOS (ver avisos en la terminal)."
} >> "$INDICE"

echo "Listo: $N_FOTOS fotos, $N_VIDEOS videos, $N_SALTADOS saltados."
echo "Índice: $INDICE"
