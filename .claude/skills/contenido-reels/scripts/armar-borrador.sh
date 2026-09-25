#!/usr/bin/env bash
# Arma el BORRADOR de un reel (corte en bruto, vertical 1080x1920) a partir de un plan de tomas.
#
# Por qué existe: el paso más lento para MJ es cortar y ordenar clips. Este script hace ese corte
# según el plan que propuso la IA, y MJ solo abre el resultado en Edits / CapCut para poner el texto
# en pantalla, la música y la portada. Deliberadamente NO pone texto: la tipografía y el estilo de
# marca se ven y ajustan mejor en el editor del celular.
#
# Uso:  bash armar-borrador.sh <plan.txt> <salida.mp4> [--sin-audio]
#
# Formato del plan (una toma por línea, separada por "|"; las líneas con # se ignoran):
#   # archivo            | desde (s) | hasta (s)
#   IMG_0412.MOV         | 1.5       | 4.0
#   IMG_0415.HEIC        | 2.5                    ← foto: el segundo número es la duración en pantalla
# Las rutas son relativas a la carpeta donde está el plan.
#
# Detalles:
#   - Videos horizontales se recortan al centro para llenar el vertical (se pierde lo de los lados).
#   - Fotos: acercamiento lento (5%) para que no se vean congeladas.
#   - --sin-audio: deja el reel mudo (para poner música o voz en el editor). Sin la opción conserva el
#     sonido original de obra.
# Requiere ffmpeg (`brew install ffmpeg`). Fotos HEIC necesitan `sips` (macOS).

set -u

PLAN="${1:-}"
SALIDA="${2:-}"
SIN_AUDIO=0
[ "${3:-}" = "--sin-audio" ] && SIN_AUDIO=1

if [ -z "$PLAN" ] || [ -z "$SALIDA" ] || [ ! -f "$PLAN" ]; then
  echo "Uso: bash armar-borrador.sh <plan.txt> <salida.mp4> [--sin-audio]" >&2
  exit 1
fi
command -v ffmpeg >/dev/null 2>&1 || { echo "Falta ffmpeg. En el Mac: brew install ffmpeg" >&2; exit 1; }

DIR_PLAN=$(cd "$(dirname "$PLAN")" && pwd)
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

# Todas las tomas quedan con exactamente los mismos parámetros para poder unirlas sin re-codificar.
VF_LLENAR="scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1,fps=30,format=yuv420p"
CODEC_V="-c:v libx264 -preset medium -crf 18 -r 30"
CODEC_A="-c:a aac -b:a 160k -ar 48000 -ac 2"

limpiar() { printf '%s' "$1" | sed -E 's/^[[:space:]]+|[[:space:]]+$//g'; }
minusculas() { printf '%s' "$1" | tr '[:upper:]' '[:lower:]'; }

N=0
TOTAL=0
while IFS= read -r LINEA; do
  LINEA=$(limpiar "$LINEA")
  case "$LINEA" in ''|'#'*) continue ;; esac

  ARCH=$(limpiar "$(printf '%s' "$LINEA" | cut -d'|' -f1)")
  A=$(limpiar "$(printf '%s' "$LINEA" | cut -d'|' -f2)")
  B=$(limpiar "$(printf '%s' "$LINEA" | cut -s -d'|' -f3)")
  RUTA="$DIR_PLAN/$ARCH"
  if [ ! -f "$RUTA" ]; then
    echo "No existe: $ARCH (línea: $LINEA)" >&2
    exit 1
  fi

  N=$((N + 1))
  TOMA=$(printf '%s/toma_%03d.mp4' "$TMP" "$N")
  EXT=$(minusculas "${ARCH##*.}")

  case "$EXT" in
    jpg|jpeg|png|webp|heic|heif)
      DUR="$A"
      FOTO="$RUTA"
      if [ "$EXT" = "heic" ] || [ "$EXT" = "heif" ]; then
        command -v sips >/dev/null 2>&1 || { echo "Foto HEIC sin sips: $ARCH" >&2; exit 1; }
        FOTO="$TMP/foto_$N.jpg"
        sips -s format jpeg "$RUTA" --out "$FOTO" >/dev/null 2>&1
      fi
      FRAMES=$(awk -v d="$DUR" 'BEGIN { printf "%d", d * 30 }')
      # Se escala al doble antes del zoompan para que el acercamiento no se vea escalonado.
      ffmpeg -loglevel error -y -loop 1 -i "$FOTO" -f lavfi -i anullsrc=r=48000:cl=stereo \
        -filter_complex "[0:v]scale=2160:3840:force_original_aspect_ratio=increase,crop=2160:3840,zoompan=z='1+0.05*on/$FRAMES':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=$FRAMES:s=1080x1920:fps=30,setsar=1,format=yuv420p[v]" \
        -map "[v]" -map 1:a -t "$DUR" $CODEC_V $CODEC_A "$TOMA" < /dev/null
      ;;
    mov|mp4|m4v)
      DUR=$(awk -v a="$A" -v b="$B" 'BEGIN { printf "%.3f", b - a }')
      if [ "$(awk -v d="$DUR" 'BEGIN { print (d > 0) }')" != "1" ]; then
        echo "Tramo inválido en $ARCH: desde $A hasta $B" >&2
        exit 1
      fi
      if ffmpeg -hide_banner -i "$RUTA" 2>&1 < /dev/null | grep -q 'Audio:'; then
        MAPA_A="-map 0:a:0"
        ENTRADA_SILENCIO=""
      else
        MAPA_A="-map 1:a"
        ENTRADA_SILENCIO="-f lavfi -i anullsrc=r=48000:cl=stereo"
      fi
      # -ss antes de -i: salto rápido; ffmpeg igual corta exacto al re-codificar.
      ffmpeg -loglevel error -y -ss "$A" -t "$DUR" -i "$RUTA" $ENTRADA_SILENCIO \
        -map 0:v:0 $MAPA_A -vf "$VF_LLENAR" -t "$DUR" $CODEC_V $CODEC_A "$TOMA" < /dev/null
      ;;
    *)
      echo "Tipo de archivo no soportado: $ARCH" >&2
      exit 1
      ;;
  esac

  if [ ! -f "$TOMA" ]; then
    echo "Falló la toma $N ($ARCH)" >&2
    exit 1
  fi
  printf "file '%s'\n" "$TOMA" >> "$TMP/lista.txt"
  TOTAL=$(awk -v t="$TOTAL" -v d="$DUR" 'BEGIN { printf "%.1f", t + d }')
done < "$PLAN"

[ "$N" -eq 0 ] && { echo "El plan no tiene tomas." >&2; exit 1; }

if [ "$SIN_AUDIO" -eq 1 ]; then
  ffmpeg -loglevel error -y -f concat -safe 0 -i "$TMP/lista.txt" -c:v copy -an -movflags +faststart "$SALIDA" < /dev/null
else
  ffmpeg -loglevel error -y -f concat -safe 0 -i "$TMP/lista.txt" -c copy -movflags +faststart "$SALIDA" < /dev/null
fi

[ -f "$SALIDA" ] || { echo "No se pudo generar $SALIDA" >&2; exit 1; }
echo "Borrador listo: $SALIDA ($N tomas, ${TOTAL}s)"
