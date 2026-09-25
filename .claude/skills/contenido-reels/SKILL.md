---
name: contenido-reels
description: >-
  Partner de contenido para el Instagram de BLARQ (@estudio_blarq). Revisa fotos y videos de obra que
  MJ grabó con el celular, los ordena, propone reels y carruseles (gancho, secuencia toma por toma,
  texto, caption), dice qué falta grabar y puede armar un borrador vertical del reel listo para
  terminar en Edits o CapCut. Usá esta skill cuando MJ diga cosas como "revisá el material de la obra",
  "armemos un reel", "qué publico esta semana", "te paso fotos/videos de la obra", "plan de contenido",
  "antes y después de ...", o cuando comparta una carpeta de fotos/videos de obra pensando en redes.
---

# Partner de contenido — reels de obra

## Qué resuelve

MJ graba en obra con el iPhone. Claude no puede reproducir video ni leer HEIC, así que esta skill
primero convierte el material a algo legible (fotos JPEG + una "hoja de contacto" de 12 cuadros por
video), después lo analiza con los criterios del partner de contenido, y opcionalmente arma el corte en
bruto del reel.

El criterio editorial (pilares, estructura de respuesta, reglas de privacidad y seguridad, tono) vive
en **una sola fuente**: `docs/contenido-redes/instrucciones-partner-contenido.md`. Leela entera antes de
analizar. La pauta de qué grabar está en `docs/contenido-redes/pauta-de-grabacion-obra.md`. La
investigación de fondo (herramientas, referentes, algoritmo) en
`docs/contenido-redes/investigacion-reels-2026-09.md`.

## El flujo

### 1. Ubicar el material

Pedile a MJ la carpeta (en el Mac, por ejemplo `~/Desktop/obras/Los Algarrobos/2026-09-20 demolicion`)
y **una línea de contexto**: qué obra, qué fase, qué pasó de especial. Si el material está en Google
Drive y el conector está disponible, se puede bajar de ahí a una carpeta local.

Requisito: `ffmpeg` (en el Mac: `brew install ffmpeg`). Si no está, decírselo a MJ en una línea con el
comando; no intentes alternativas raras.

### 2. Preparar

```bash
bash .claude/skills/contenido-reels/scripts/preparar-material.sh "<carpeta>"
```

No toca los originales. Deja en `<carpeta>/_ia/`:
- `indice.md` — cada archivo con duración, orientación, fecha, si tiene audio, y el segundo aproximado
  de cada cuadro de la hoja de contacto.
- `fotos/*.jpg` — las fotos convertidas (HEIC → JPEG con `sips`, lado máximo 1600 px).
- `videos/*_hoja.jpg` — 12 cuadros por video (4 columnas x 3 filas, de izquierda a derecha y de
  arriba abajo).

### 3. Mirar

Leé `indice.md` y después **todas** las imágenes de `_ia/` con Read. Para revisar un momento puntual
de un video en resolución completa (por ejemplo para elegir portada):

```bash
ffmpeg -loglevel error -ss <segundo> -i "<video>" -frames:v 1 "<carpeta>/_ia/cuadro.jpg"
```

Limitación honesta: **no escuchás el audio**. Si un video tiene voz (MJ explicando algo, un cliente),
preguntale a MJ qué se dice antes de proponer usarlo.

### 4. Responder

Con la estructura de `instrucciones-partner-contenido.md`: inventario → 2 a 4 propuestas → lo que
falta grabar → crítica. Citar siempre archivo y segundos (`IMG_0412.MOV 1,5–4,0 s`), así el plan se
puede ejecutar tal cual.

### 5. (Opcional) Armar el borrador

Si MJ aprueba una propuesta, escribí el plan de tomas en `<carpeta>/_ia/plan-<nombre>.txt` y armá el
corte:

```text
# archivo            | desde (s) | hasta (s)       ← foto: el segundo número es la duración
../IMG_0412.MOV      | 1.5       | 4.0
../IMG_0415.HEIC     | 2.5
```

```bash
bash .claude/skills/contenido-reels/scripts/armar-borrador.sh "<carpeta>/_ia/plan-<nombre>.txt" "<carpeta>/_ia/borrador-<nombre>.mp4" [--sin-audio]
```

Sale un MP4 vertical 1080x1920 a 30 fps, sin texto. Las rutas del plan son relativas a la carpeta del
plan (por eso el `../`). Videos horizontales se recortan al centro: avisale a MJ si eso corta algo
importante. Fotos llevan un acercamiento lento de 5 %. `--sin-audio` si va con música o voz en off; sin
la opción conserva el sonido de obra.

MJ abre el borrador en **Edits** (o CapCut) y agrega texto en pantalla, música y portada. El texto
queda fuera del script a propósito: la tipografía de marca y el ritmo del texto se ajustan mejor a mano
en el celular.

Mostrale a MJ el resultado, no el plan: una hoja de contacto del borrador
(`ffmpeg -i borrador.mp4 -vf "fps=2,scale=180:-2,tile=6x3" -frames:v 1 hoja-borrador.jpg`) o el MP4
mismo si la sesión puede mandarle archivos.

## Qué NO hace

- No publica en Instagram ni programa nada. Eso lo hace MJ desde Instagram / Edits / Meta Business
  Suite (ver la investigación: automatizar la publicación no vale la pena al volumen de BLARQ).
- No genera video con IA de obras que no existen.
- No toca la base de datos de la app ni nada de `src/`.
