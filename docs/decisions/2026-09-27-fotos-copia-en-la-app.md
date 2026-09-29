# ADR — Las fotos de artefactos y herrajes se guardan como copia en la app, no como link a la tienda

- **Fecha**: 2026-09-27
- **Estado**: aceptado
- **Autor**: MJ (eligió las opciones con el análisis) + Claude Code

## Contexto

MJ: *"de repente se me desaparecían las fotos en una cotización"*. La app guardaba en `imageUrl` (líneas de artefactos, catálogo de artefactos, catálogo de herrajes) el LINK a la foto en el servidor de la tienda. MK vuelve a subir sus fotos cada uno o dos meses (el `?v=` de sus links lo delata), el archivo viejo deja de existir y el link da 404: la foto desaparece del editor y del PDF, aunque el campo siga lleno.

Medido en la viva el 2026-09-27 (`scripts/diag-fotos-copia-analisis.ts`, solo lectura): de 228 links de foto distintos, 32 estaban muertos (31 de MK); 59 líneas de cotización con la foto muerta, casi todas en cotizaciones **enviadas o aprobadas** —las que nadie vuelve a tocar—: Casa Los Algarrobos V1 14, Paseo del Sena V1-V3 8-9 cada una, Algarrobos V2 7. Regenerar hoy el PDF de Algarrobos V1 daba 13 de 46 fotos en blanco. En dos días las fotos muertas en líneas pasaron de 20 a 21: sigue empeorando.

El arreglo de pendiente 132 (agosto) hacía que "Revisar precios" del catálogo repusiera fotos rotas, pero volvía a guardar un link: la foto se volvía a morir, y nada reparaba las cotizaciones enviadas.

## Decisión

Cada foto se baja una vez, se achica a 600 px (JPEG, ~18 KB) y se guarda en una tabla propia, `FotoGuardada` (el "cajón de fotos"), una sola vez por foto distinta. `imageUrl` pasa a guardar un link corto a esa copia: `/api/fotos/<id>`.

Decisiones de MJ sobre el análisis (2026-09-27):

1. **Dónde**: en la misma base, en una tabla aparte (opción B del análisis).
2. **Cuándo**: apenas la foto entra a la app, más un chequeo al "Marcar como enviada".
3. **Enviadas y aprobadas**: *"Devolverles las fotos"* — se copian las que se ven y se recuperan las muertas, también en lo que repone "Volver a lo enviado". Solo la foto, nunca precios.
4. **Herrajes**: lo mismo.

Detalles operativos:

- **La puerta de entrada** es `guardarCopiaDeFoto` (`src/lib/fotos/guardarFoto.ts`). La llaman las rutas que escriben una foto nueva: agregar/editar línea, alta/edición del catálogo de artefactos y de herrajes, la foto que trae "Traer de otra cotización", y la reparación de "Revisar precios" del catálogo (que además copia de paso las fotos que todavía sean link). Si la copia falla, queda el link: **copiar nunca puede costar perder la foto**.
- **"Marcar como enviada"** (`copiarFotosDeVersion`) copia las fotos que sigan siendo link **antes** de sacar la foto de lo enviado.
- **"Volver a lo enviado"** repone la copia aunque la foto de lo enviado tenga el link viejo (busca la copia por link, sin bajar nada).
- **PDF**: las copias van incrustadas en el HTML (el navegador que arma el PDF no tiene sesión); ya no depende de que la tienda responda.
- **Mismo producto, otro link**: la copia anota los links de tienda de los que salió (`sourceUrls`), incluidos links muertos cuya foto se recuperó. Así "Comparar con la tienda web" y "Actualizar del catálogo" no ofrecen "actualizar foto" cuando es la misma, y una pantalla abierta desde antes con el link viejo no pisa la copia.
- **Seguridad**: la descarga solo va a hosts públicos (misma guarda que el proxy de fotos) y sigue las redirecciones a mano revisando cada salto. `/api/fotos/<id>` exige sesión como toda ruta /api.
- **Pasada única**: `scripts/fotos-guardar-copias.ts` (dry-run por defecto, respaldo en `backups/`, escribe solo si la fila sigue como se leyó). Orden para recuperar una foto muerta: la tienda hoy → otra foto del mismo producto (mismo código) en el catálogo o en otra cotización → la foto del PDF que se le mandó al cliente (`--pdf-fotos`).
- **Tabla en la viva**: `prisma/sql/fotos-guardadas.sql` (aditivo, idempotente), con `scripts/aplicar-sql.ts`, antes de desplegar.

## Alternativas descartadas

- **A. La copia dentro de cada línea** (como `data:`, igual que la foto subida a mano) — no pedía estructura nueva, pero la foto viaja pegada a cada fila: el Inicio carga todas las líneas de las obras en ejecución y sus fotos de lo enviado (~10 MB más por carga, lo mismo que hizo lenta la app en junio: ADR 2026-06-12). Además la misma foto se guardaba ~3 veces (385 líneas, 124 fotos distintas).
- **C. Servicio externo de archivos** (Vercel Blob, S3) — hecho para archivos, pero es un servicio nuevo con su propia llave en Vercel y otro lugar que respaldar, para unos pocos MB. La app no guarda archivos fuera de la base.
- **Copiar solo al enviar** — llega tarde: dos borradores ya habían perdido una foto antes de enviarse, y el catálogo seguía perdiendo fotos.
- **Dejar las enviadas como estaban** — MJ eligió devolverles las fotos.
- **Sacar las fotos perdidas de archive.org** — no tenía ninguna de las 32.

## Consecuencias

- **Positivas**: una foto que entra a la app ya no desaparece; el PDF sale igual siempre y no espera a las tiendas; las pantallas bajan menos (el editor de Algarrobos V4 bajaba 4,7 MB de fotos de 2000 px para mostrar cuadraditos; con copias, 0,7 MB); desaparece el problema de los bloqueadores de anuncios con los CDN de las tiendas para las fotos copiadas.
- **Costos / contras**: la base crece ~3 MB con las fotos de hoy (206 copias) y unos 10 MB al año; la base viva pesa 332 MB, 294 de ellos PDFs del SII. Guardar una foto nueva tarda unos segundos más (hay que bajarla), por eso esas rutas tienen `maxDuration = 60`. Una foto copiada no se actualiza sola si la tienda publica otra mejor: se cambia con "Extraer" o desde "Comparar con la tienda web".
- **Regla nueva**: los bytes de `FotoGuardada` NUNCA se cargan en queries de UI. Viven en su tabla; las filas solo llevan el link corto. Solo leen `bytes` la ruta `/api/fotos/[id]` y el PDF (`incrustarFotosGuardadas`).
- **Deuda generada**: las copias que ya nadie usa (líneas o productos borrados) quedan en el cajón. Pesan poco; una limpieza puede hacerse cuando haga falta.

## Referencias

- Archivos: `src/lib/fotos/guardarFoto.ts`, `src/lib/fotos/linkFoto.ts`, `src/app/api/fotos/[id]/route.ts`, `prisma/schema.prisma` (modelo `FotoGuardada`), `prisma/sql/fotos-guardadas.sql`.
- Scripts: `scripts/fotos-guardar-copias.ts` (pasada única), `scripts/diag-fotos-huella.ts` (foto de control: todo lo que no es foto queda idéntico), `scripts/diag-fotos-copia-analisis.ts` (medición), `scripts/test-fotos-guardadas.ts` (regresión, 31 casos).
- ADR relacionados: `2026-06-12-no-cargar-bytes-pesados-en-ui.md`, `2026-09-25-artefactos-solo-mj-despega-la-linea.md`.
- Antecedentes: pendiente 132 (fotos rotas del catálogo, PR #380), links nuevos de MK (PR #455) y la reposición de 17 fotos y 140 links del 2026-09-27 (rama `fix/mk-links-nuevos`).
