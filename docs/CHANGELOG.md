# CHANGELOG

Log cronológico de cambios estructurales. 3-5 líneas por entrada, las más nuevas arriba. Plantilla en [`_templates/CHANGELOG-entry.md`](_templates/CHANGELOG-entry.md).

---

## 2026-06-05 — Catálogo: panel de precios multi-tienda con búsqueda en vivo (VTEX/mK)

- El panel de precios de un material (`MaterialOffersDrawer`) se rediseñó para **mostrar todas las ofertas guardadas** (tienda, neto/IVA, stock, link) y permitir **fijar la oficial con un click** ("Usar esta") sin perder las demás. Esos datos (`MaterialPriceOffer`) ya existían en la BD pero la UI no los exponía: solo dejaba editar un precio/link a la vez.
- **Búsqueda en vivo**: nuevo motor VTEX en `src/lib/catalog/fetchPrice.ts` (`searchStoreProducts` + `VTEX_STORES`) que consulta la API pública de catálogo y devuelve candidatos con **precio y stock de hoy**. Nuevo endpoint `POST /api/catalogo/buscar-precio`. Sirve para relinkear cuando el producto viejo se movió (caso real: el guardapolvo foliado apuntaba a un link mK ya inexistente; catálogo $4.990 vs ~$6.990–9.990 hoy). Solo **mK** verificada hoy — Construmart/Imperial/Easy/Chilemat no exponen esa API (devuelven HTML). `fetchPriceFromUrl` también detecta dominios VTEX.
- **Fix**: al fijar una oferta (POST y PATCH de ofertas) ahora se llama `syncMaterialToComponents` — antes cambiaba el `netPrice` del catálogo pero dejaba las partidas con el precio viejo. El POST además despinea las otras ofertas (faltaba).
- Detalles: query del buscador prellenada suavizada (minúsculas + medida triple `15x90x2400mm` colapsada a `15x90`, porque el nombre exacto del catálogo no calza en la búsqueda); botón "Precios" sin emoji (regla BLARQ). UI pura sobre datos, no toca `metrics.ts`. (rama `feat/catalogo-precios-multitienda`)

## 2026-06-04 — Presupuesto: vista expandida de partida densa (~918→~490px)

- El panel que se abre al expandir una partida (pestaña Presupuesto) ocupaba ~918px (más de una pantalla). Se compacta a ~490px **manteniendo toda la info**, a densidad tipo planilla maestra: descripciones cliente/maestro **lado a lado** (antes apiladas) con letra de 9px e interlineado apretado; 6 rubros de costo + suma en una fila; tabla "Detalle de materiales y costos" en modo denso (10px, filas pegadas, chips de tipo sin alto extra, totales 9px, botones "+Material…" más chicos).
- El layout expandido se extrajo a un componente nuevo `PartidaExpandedPanel.tsx` (acota el cambio en `ObraEditor.tsx`). La densidad de la tabla se activa con un prop `dense` en `ObraItemComponentsEditor` (default off → la vista normal de esa tabla queda igual). UI pura, no toca cálculos ni `metrics.ts`. (PR #84)
- **Arreglo lateral** (aplica también a la vista normal): el link ↗ de los materiales con referencia caía en una 2ª línea e inflaba esas filas; ahora va en la misma línea (flex).
- Nota: el panel se diseñó sobre un `main` previo al PR #80 (toolbar flotante). En prod la barra de formato es el `BubbleMenu` flotante; las descripciones quedan sin barra fija (aún más compactas). Verificado: build de prod OK y endpoint de componentes 200 en producción (el 404 visto en dev era artefacto de turbopack con esa ruta anidada).

## 2026-06-03 — Catálogo de artefactos: pestañas por subcategoría + orden manual (drag) agrupado por tipo

- **Pestañas** Sanitario / Cocina / Iluminación (con contador) reemplazan el desplegable de subcategoría en `/catalogo/artefactos` — botones arriba, un click. La búsqueda y el filtro "Solo paleta estándar" siguen operando dentro de la pestaña activa.
- **Orden manual**: nueva columna `ArtefactoCatalog.sortOrder` (Int, default 0) + índice `[subcategory, sortOrder]`. Arrastre de filas con dnd-kit (`PATCH /api/catalogo/artefactos/reorder`, espejo del de partidas); los encabezados de "tipo" (campo `tag`) se arman solos según el orden en que quedan las filas. Selector de subcategoría por fila para mover un artefacto entre pestañas. El artefacto nuevo nace al final de su pestaña (`sortOrder = max+1`).
- `DndContext` con `id` estable para no romper hidratación SSR (el counter de dnd-kit difería server/cliente). Verificado en dev (preview, base `ep-solitary-mud`): pestañas, agrupado y reorder OK; typecheck del proyecto limpio.
- **Columna `sortOrder` ya aplicada en prod** vía `prisma db push` (aditiva, default 0, no mueve datos) antes del merge para que el deploy quede consistente.

## 2026-06-03 (ronda 49) — Botón "Sin factura" en movimientos + conciliación cobros Maxxa

- **Botón "Sin factura" inline** en `/banco/movimientos` (`MarkSinFacturaButton.tsx`, cableado en `MovementsTable`): marca un movimiento pendiente/parcial como `sin_factura` con categoría (Sueldo, Previred, Comisión banco, Retiro personal, Depósito efectivo, Otro) **sin crear factura ficticia ni exigir proyecto** — antes el único camino era "Pago sin factura", que obliga a un proyecto y crea una recibida `sin_respaldo`. Motivo: sueldos/comisiones no son costo de obra. Hasta ahora esas categorías solo se ponían por reglas al importar; los movimientos sin regla (ej. transferencia a Juan Pablo Costa) quedaban sin forma de marcarse a mano.
- **PATCH `/api/banco/movimientos/[id]`**: la creación de regla de auto-categorización pasa a ser **opt-in** (`saveRule:true`). Antes cualquier `{category}` creaba regla; el patrón se deriva de la glosa y puede quedar amplio ("Transf a Juan"). El botón nuevo trae el check "Guardar regla" apagado por default. Ningún caller previo mandaba `category`, así que no cambia comportamiento existente.

## 2026-06-03 (ronda 49) — Conciliación cobros 2025+2026 "pagada sin enlace" desde Maxxa

- **`scripts/conciliar-maxxa-2025.ts`** (ahora 2025 **y** 2026): (1) deja de saltar facturas `status==="pagada"` — vincula por saldo real `invRem = total − pagos` y no degrada el estado (a una pagada solo le agrega el enlace al banco); (2) transferencias gemelas: dedup de filas de cartola por la identidad estable de Maxxa (set de `id_pago`), no por fecha|monto|desc, y consume un movimiento de app distinto por fila; (3) lee las 4 cartolas 2026 + filtros de fecha a 2026. Mantiene el guard de signo y el match de emitidas por `tipoDoc{33,34,61,39}|folio` (NO por folio solo: los docs Maxxa 1043/1054 colisionan con el correlativo de emitidas y crearían enlaces falsos).
- **Datos de prod** (dry-run + OK MJ + backup): 63 imputaciones creadas. 18 cobros (emitidas) cerrados a saldo $0 (≈ $199,4M) + recibidas chicas. Integridad: 0 facturas/movimientos sobre-imputados. No mueve totales de obra (cobrado/gastado salen de facturas). F-5705931 (Servipag) excluido por decisión MJ.
- **Pendiente de dato**: 92 movimientos Maxxa sin contraparte en la app = compras Sodimac 2024 (la app solo tiene cartola desde 2025-01-02). Importar cartola 2024 para cerrarlas.

## 2026-06-03 — Import banco: "compra con tarjeta" ya no se marca "sin factura" + auto-match comercios

- **Import deja de esconder compras en "sin factura"**: `inferCategory` (`santanderParser.ts`) ya NO infiere `compra_tarjeta` por el prefijo "Compra ". `import/route.ts` solo nace `status=sin_factura` para categorías sin documento real (`previred`, `sueldo`); el resto nace `sin_asignar` y entra a la cola de conciliación. Motivo: el atajo mandaba toda compra con tarjeta (la mayoría CON factura) a "sin factura", donde el filtro de pendientes no la muestra. "Sin factura" pasa a enseñarse caso por caso (reglas `bankCategorizationRule`).
- **Auto-match por comercio (`invoicePayments.ts`)**: arreglado Construmart (la glosa trae guion "CONSTRU-MART", la regex `/construmart/` no matcheaba → ahora `/constru-?mart/`); agregado ERPYME→MAXXA (suscripción mensual, monto exacto). Sin cambios en el criterio conservador (RUT o comercio reconocido; la fecha no interviene).
- **`conciliar-maxxa-2025.ts`**: lee los 4 exports de Maxxa (antes 2; faltaba ene–mar 2025) + guard de coherencia de signo (emitida↔abono, recibida↔cargo) para no pegar pagos por colisión de folio. Limitación conocida: la dedup de cartola colapsa transferencias gemelas legítimas (pendiente arreglar para 2026).
- **Datos de prod** (reseteos de estado, conciliaciones Maxxa 2025, Santander, internacionales): detalle en WIP.md ronda 48. No mueven totales de obra (cobrado/gastado salen de facturas, no de pagos).
- **Archivos**: `src/lib/banco/santanderParser.ts`, `src/app/api/banco/import/route.ts`, `src/lib/banco/invoicePayments.ts`, `scripts/conciliar-maxxa-2025.ts` + scripts nuevos de reseteo/conciliación.

---

## 2026-06-03 — Cotizaciones: borrar con crucecita · editor: toolbar flotante + fix dropdowns

- **Borrar cotización (feature)**: crucecita discreta a la derecha de cada fila en la lista de Cotizaciones (tabs Activas y Archivadas) con confirmación inline ("¿Eliminar? Sí/No"). Borrado definitivo (cascade: presupuestos, estados de pago, lista de compra). NO se ofrece en Convertidas (obra viva). El endpoint `DELETE /api/proyectos/[id]` suma guard server-side: solo borra status `cotizacion`/`archivado`. Componente nuevo `BorrarCotizacionButton`. (PR #79)
- **Descripciones — toolbar flotante (UX)**: la barra de formato del `RichTextEditor` deja de ser fija y pasa a `BubbleMenu` (Tiptap) que aparece solo al seleccionar texto, chico y proporcional — ya no ocupa espacio al desplegar la partida. (PR #80)
- **Agregar partida — dropdowns pegados (fix)**: dos desplegables del `ObraEditor` que no cerraban al click afuera: el buscador de catálogo (el cartel "No se encontraron partidas" persistía porque el handler solo limpiaba resultados, no la query → se separó la visibilidad en `showCatalogDropdown`) y el picker "+ Capítulo" (sin handler → se le agregó). (PR #80)
- **Pendiente**: verificación visual del toolbar flotante en prod (no se pudo en sesión por inestabilidad del preview); si se ve mal, revertir PR #80.
- **Archivos**: `src/components/proyecto/BorrarCotizacionButton.tsx`, `src/components/proyecto/ProjectsTable.tsx`, `src/app/api/proyectos/[id]/route.ts`, `src/components/presupuesto/RichTextEditor.tsx`, `src/components/presupuesto/ObraEditor.tsx`.

---

## 2026-06-02 — Cotizador: orden por tipo + descripciones con formato (texto rico)

- **Orden del detalle de costos (fix)**: la tabla editable "Detalle de materiales y costos" (`ObraItemComponentsEditor`) ahora ordena SIEMPRE por tipo (material → mano de obra → herramientas → subcontrato → pérdida → margen) y dentro de cada tipo por orden de creación. Antes una línea nueva se agregaba al final de todo; ahora cae al final de su grupo. Es orden de presentación: no toca cálculos ni `sortOrder` guardado.
- **Descripciones con formato (feature)**: las descripciones al cliente (`descriptionCliente`) y al maestro (`descriptionMaestro`) pasan de texto plano a texto con formato — negrita, cursiva, subrayado, viñetas/listas y color (paleta sobria pero algo prendida, a pedido de MJ). Editor nuevo `RichTextEditor` (Tiptap v3) en el panel expandido de cada partida; en la celda compacta de la tabla se muestra el formato como vista previa (clic abre el panel para editar). Se guarda HTML en los mismos campos (sin cambio de schema).
- **PDFs**: `ObraPDF` (cliente), `EstadoPagoPDF` y `ObraMaestroPDF` (maestro) inyectan el HTML con formato (antes escapaban el texto). Se agregó CSS de listas/marcas al `.col-desc` de cada uno.
- **Seguridad**: `src/lib/richText.ts` con `sanitizeRichTextHtml` (allowlist: solo p/br/strong/em/u/s/ul/ol/li/span-color; saca scripts/onclick/img/estilos no-color), `isRichTextEmpty`, `plainTextToHtml` (migra texto plano viejo). Test de regresión `scripts/test-richtext.ts` (17 casos).
- **Dependencias nuevas**: `@tiptap/react`, `@tiptap/pm`, `@tiptap/starter-kit`, `@tiptap/extension-text-style`, `@tiptap/extension-color`, `@tiptap/extension-placeholder`.
- **Pendiente**: verificación visual del editor en el navegador (no se pudo en esta sesión por el login). Nota estética: el color va contra §3 (blanco/negro/gris); se acotó a paleta apagada por decisión de la dueña.
- **Archivos**: `src/lib/richText.ts`, `src/components/presupuesto/RichTextEditor.tsx`, `src/components/presupuesto/ObraItemComponentsEditor.tsx`, `src/components/presupuesto/ObraEditor.tsx`, `src/lib/pdf/{ObraPDF,EstadoPagoPDF,ObraMaestroPDF}.html.ts`, `scripts/test-richtext.ts`.

---

## 2026-06-02 — Boletas de Honorarios recibidas (BHE) del SII importadas

- **Qué cambió (datos en prod)**: se importaron las 9 BHE recibidas por BLARQ (2025: 7 · 2026: 2) bajadas del portal de honorarios del SII (`loa.sii.cl`). 7 creadas + 2 corregidas (venían de la ronda 39 al líquido → ahora al bruto). Gasto recibidas: $453.457.326 → $459.730.632 (+$6.273.306, de los cuales $4.678.362 son 2 honorarios de la propia MJ que se decidió incluir).
- **Modelo nuevo**: BHE = `Invoice` type=recibida, **tipoDoc=1039** (convención honorarios, paralela a 1043=mano de obra), sin IVA, totalAmount=netAmount=**bruto** (retención NO modelada, sin cambio de schema). Etiqueta agregada a `InvoicePDF.html.ts`.
- **Auto-sync desatendido NO viable**: el WAF F5 de `loa.sii.cl` rechaza la navegación de Playwright (ERR_CONNECTION_CLOSED, headless y headed); el APIRequestContext conecta pero el informe da `I082 host no definido` (sesión server-side irreproducible). Vercel descartado por WAF. Único camino que funciona: manejar el Chrome real de MJ (extensión). Recorrido y endpoints documentados en WIP ronda 45.
- **Tooling**: `scripts/importar-bhe.ts` (dry-run default, `--apply` solo prod, idempotente, verifica delta de gasto). Backup `audit-...2026-06-02T16-50.json`.
- **Pendiente MJ**: asignar obra a las 7 nuevas (projectId=null); conciliación (pago = líquido, saldo = retención); reconfirmar no-doble-conteo de los honorarios de MJ.
- **Archivos**: `scripts/importar-bhe.ts`, `src/lib/pdf/InvoicePDF.html.ts`, `docs/WIP.md`, `docs/CHANGELOG.md`.

---

## 2026-05-30 — Análisis conciliación Sodimac (Maxxa vs app) — solo lectura

- **Qué pasó (no es cambio de código ni datos)**: se comparó el export de Maxxa `MovimientosCartola_20260530_1834.xlsx` (1 cuenta, 500 compras Sodimac) contra la conciliación de la app. Donde ambos tienen datos: 156 facturas conciliadas igual. El resto son diferencias de alcance (otras cuentas / historia Sodimac fuera del rango de la app / cartola de la app ~2 semanas atrasada), no errores de plata.
- **Hallazgo de fondo sobre `metrics.ts`**: el gasto se calcula SOLO de facturas recibidas (no mira movimientos bancarios) → las 38 facturas legacy "pagada sin enlace" NO duplican gasto. Y `metrics.ts` no filtra `status=anulada`, pero las 17 anuladas (con proyecto) tienen su NC que las compensa → total correcto por disciplina de la NC.
- **Decisión / deuda**: ADR `2026-05-30-metrics-no-filtra-anuladas.md` registra el riesgo latente; defensa futura simple = filtrar anuladas explícitamente en el gastado. Re-enlazar las 38 pagadas-sin-enlace queda para sesión aparte.
- **Sin script commiteable** (análisis con scripts ad-hoc, borrados al cierre). **Sin cambios de schema, sin tocar `metrics.ts`.**
- **Entregable**: `~/Downloads/Analisis_Sodimac_2026-05-30.xlsx` (38 pagadas-sin-enlace + 7 anuladas conciliadas).
- **Archivos**: `docs/decisions/2026-05-30-metrics-no-filtra-anuladas.md`, `docs/WIP.md`.

---

## 2026-05-30 — Limpieza de conciliaciones erróneas + criterio conservador

- **Qué cambió (datos en prod, no código de la app)**: se corrigieron conciliaciones banco↔factura mal asignadas — 5 pares de proveedor cruzado (swap), 11 compras con tarjeta soltadas de facturas que no correspondían (vuelven a pendiente), 1 conciliación correcta agregada (MercadoPago $39.990 → MercadoLibre F-12254760). El grupo "comercio cruzado" quedó en 0.
- **Reembolsadores**: +2 (Alejandro Henríquez → Comercializadora Angélica; Carlos Patricio → Climair). Total 12.
- **Tooling nuevo (read-only salvo los fix con `--apply`)**: `audit-conciliaciones-erroneas.ts` (detector), `descubrir-mercadopago.ts` (ayudante), `list-conciliaciones-dudosas.ts`, y scripts de fix puntuales con dry-run + guards.
- **Decisión**: ADR `2026-05-30-conciliacion-conservadora-fecha-flexible.md` — la fecha no descarta (solo desempata), match por RUT+monto/comercio, ante la duda dejar pendiente. Implementación en `invoicePayments.ts` pendiente (es el #1/#2 de la auditoría ronda 32).
- **Sin cambios de schema, sin tocar `metrics.ts`.** Los totales de plata no se movieron (solo cambia a qué factura apunta cada pago).
- **Archivos**: `scripts/audit-conciliaciones-erroneas.ts`, `scripts/fix-conciliaciones-cruzadas.ts`, `scripts/fix-conciliaciones-ronda2.ts`, `scripts/fix-sherwin-18683.ts`, `scripts/fix-mercadopago-peaje.ts`, `scripts/conciliar-mercadolibre-39990.ts`, `scripts/crear-reembolsadores-alejandro-carlos.ts`, `scripts/descubrir-mercadopago.ts`, `scripts/list-conciliaciones-dudosas.ts`, `docs/decisions/2026-05-30-conciliacion-conservadora-fecha-flexible.md`, `docs/glossary.md`, `docs/WIP.md`.

---

## 2026-05-29 — Tooling de auditoría read-only + rotación de credencial de prod

- **Qué cambió**: dos scripts nuevos para auditar facturas/conciliación sin tocar datos: `scripts/audit-dump.ts` (dump read-only de prod a JSON — `findMany` con `select`, excluye `Invoice.pdfContent`) y `scripts/audit-analyze.ts` (análisis 100% offline sobre el JSON, cero acceso a BD). Producen `docs/REVIEW_facturas-conciliacion_2026-05-29.md`.
- **Parche de seguridad**: el print de debug de `audit-dump.ts` imprimía un fragmento del `DATABASE_URL` (con contraseña). Se cambió para imprimir solo el host. Lección registrada en ADR `2026-05-29-credenciales-en-console-logs.md`.
- **Operación (no es cambio de código)**: por esa filtración se rotó la contraseña de la BD de prod en Neon y se propagó a Vercel (Production + Preview) + redeploy + LaunchAgent del SII + `.env.prod`. La contraseña vieja quedó inválida.
- **Sin cambios de schema, sin tocar `metrics.ts`.** Los scripts y el reporte son artefactos de auditoría; `.env.prod` y `backups/` siguen gitignored.
- **Archivos**: `scripts/audit-dump.ts`, `scripts/audit-analyze.ts`, `docs/REVIEW_facturas-conciliacion_2026-05-29.md`, `docs/decisions/2026-05-29-credenciales-en-console-logs.md`.

---

## 2026-05-22 — Artefactos se multiplican por cantidad · Cuadro Resumen dinámico

- **Qué cambió**: `metrics.ts` ahora calcula el total de artefactos como `clientPrice × quantity` (antes sumaba `clientPrice` sin multiplicar). El Cuadro Resumen del proyecto pasó a tener columnas dinámicas: muestra solo los conceptos cargados con monto > 0 (obra / cocina / sanitarios / iluminación / muebles), no 4 columnas fijas.
- **Por qué**: el cuadro de Aguirre no mostraba la iluminación. La causa raíz era que el cálculo no multiplicaba por cantidad — y "funcionaba" solo porque varios proyectos venían mal cargados con el total de línea en `clientPrice`. Convención correcta confirmada con MJ: `clientPrice` es precio unitario.
- **Datos**: `scripts/fix-artefactos-precio-unitario.ts` corrigió 17 ítems mal cargados en prod (Aguirre V7, Cocina Farellones V4, JNC-Vitacura V5, Portofino V1) a precio unitario. Paseo del Sena V1 y Portofino V6 quedaron fuera por estar bien cargados.
- **Verificación (§4.1)**: snapshot prod pre/post — 16 de 18 proyectos sin cambios; Portofino y Paseo del Sena subieron al corregirse su subestimación previa. Sin cambios de schema.
- **Archivos**: `src/lib/projects/metrics.ts`, `src/components/proyecto/CuadroResumen.tsx`, `scripts/fix-artefactos-precio-unitario.ts`.

---

## 2026-05-22 — Botón "Nueva partida" en el catálogo

- **Qué cambió**: la sección Catálogo de Partidas (`/catalogo/partidas`) ahora tiene un botón "+ Nueva partida" junto a la barra de búsqueda. Abre un formulario corto (nombre, categoría con datalist de las existentes o una nueva, unidad) y al confirmar crea la partida y la abre directo en modo edición para cargar descripciones y componentes.
- **Por qué**: hasta ahora una partida solo nacía indirectamente desde un presupuesto o duplicando otra. No había forma de crear una desde cero en el catálogo.
- **Sin cambios de schema ni de API** — el endpoint `POST /api/catalogo/partidas` ya existía. Cambio solo de UI. La lista de categorías pasó a estado local del componente para que una categoría nueva aparezca sin recargar.
- **Archivos**: `src/components/catalogo/PartidaSearch.tsx`.

---

## 2026-05-17 — Fix importador de cartolas bancarias: deduplicación por saldo posterior

- **Qué cambió**: el importador de cartolas Santander ya no deduplica por el N° de documento del banco (`externalRef`). Ahora cada movimiento se identifica por `balanceAfter` — el saldo corrido tras aplicarlo, calculado sobre un orden canónico (fecha, monto, descripción). Campo nuevo `BankMovement.balanceAfter` y `@@unique` reemplazado por `(bankAccountId, date, amount, balanceAfter)`.
- **Por qué**: `externalRef` solo lo trae la cartola Histórica; la Provisoria lo trae en cero. Reimportar la misma cartola en el otro formato duplicaba todos los movimientos. Además el banco lista los movimientos de un mismo día en distinto orden según el formato — por eso el saldo corrido se calcula sobre un orden fijo, no en el orden de fila, para que la llave sea idéntica entre formatos.
- **Schema**: `balanceAfter Float?` (nullable por los movimientos previos al backfill). Aplicado en dev y prod.
- **Datos prod**: backfill de `balanceAfter` sobre 878 movimientos (período dic 2025–may 2026, cruzado contra 12 cartolas). 737 de historia previa (mar–oct 2025) quedan en null — sin cartola para cruzar. Backup completo previo: `backups/blarq-prod-2026-05-17T18-13.json.gz`.
- **Archivos**: `santanderParser.ts`, `/api/banco/import/route.ts`, `schema.prisma`; scripts nuevos `reconcile-cartolas.ts` (compara BD vs cartolas, read-only) y `backfill-balance-after.ts`.
- **Verificado**: reimport en dev (Histórica, reimport mismo formato, Provisoria del mismo período) → 0 duplicados. Simulación read-only contra prod → 0 se crearían.
- **Limitación conocida**: si se exporta una Provisoria con su último día incompleto y luego se importa la Histórica de ese mes, los pocos movimientos de ese día parcial podrían duplicarse (su `balanceAfter` cambia al completarse el día).

---

## 2026-05-16 — Catálogo de artefactos auto-construido

- **Qué cambió**: el catálogo BLARQ de artefactos se construye solo. Cada producto que se agrega a una cotización (alta individual o importación de Excel) entra al catálogo; si ya hay una entrada con el mismo nombre se reutiliza, si no se crea. Cada `ArtefactoItem` queda vinculado por `catalogId`. Helper compartido `src/lib/catalog/ensureArtefactoCatalog.ts`.
- **Por qué**: pedido de MJ — quiere el catálogo como el listado de materiales: una lista grande con toda la variedad cotizada, no solo "los más usados".
- **Backfill**: `scripts/backfill-artefacto-catalog.ts` (dry-run por defecto, `--apply`) vincula los items históricos. Dedup por nombre case-insensitive. Pendiente correrlo en prod.
- **Sin cambios de schema** (la tabla `ArtefactoCatalog` ya existía). Archivos: `ensureArtefactoCatalog.ts`, `api/presupuestos/[id]/artefactos/route.ts`, `api/proyectos/[id]/importar-artefactos/route.ts`.

---

## 2026-05-16 — Cálculo de costos: los Estados de Pago salen del costo contable

- **Qué cambió**: `metrics.ts` ya no cuenta los Estados de Pago cerrados como costo del proyecto. `totalGastado` y `totalGastadoConIva` ahora salen 100% de facturas recibidas (incluidos los "pagos sin respaldo", que son `Invoice` recibida). Se eliminó el campo `totalPagadoMaestros` de `ProjectMetrics` y su uso en `conceptDeviations` y en `/proyectos/[id]/resumen`.
- **Por qué**: decisión de MJ — *"la contabilidad no debe salir de los EP, sino de las facturas o mov sin respaldo"*. El EP es una herramienta de cálculo (cuánto pagar al maestro según avance), no la huella contable del gasto. Sumar EP + el pago registrado contaría doble.
- **`project.estadosPago` se sigue usando** para el avance de obra (% ponderado por MO) — eso no es costo, no cambió.
- **Verificación (§4.1)**: snapshot pre/post de los 17 proyectos en dev → diff vacío, ningún total se movió (ningún proyecto tiene EP cerrados en la app todavía). `test-metrics.ts` corre con 2 fallas pre-existentes ajenas al cambio.
- **Archivos**: `src/lib/projects/metrics.ts`, `proyectos/[id]/resumen/page.tsx`, `scripts/test-metrics.ts`.

---

## 2026-05-16 — "Pago sin factura": registrar pagos a maestros sin documento desde el banco

- **Qué cambió**: nueva acción masiva "Pago sin factura" en la barra de selección de `/banco/movimientos`. Para egresos a maestros/proveedores que no emiten documento, MJ selecciona uno o varios movimientos, elige proyecto + categoría, y la app crea por cada uno un registro de costo `Invoice` con `origin="sin_respaldo"` (recibida, tipoDoc=1043, sin IVA, monto y contraparte tomados del movimiento), lo deja conciliado contra el movimiento. El gasto entra automáticamente en los costos del proyecto.
- **Por qué**: las transferencias a maestros que no facturan (caso Daniel Ignacio Santibáñez) quedaban como movimientos "pendientes" sin entrar como costo de ningún proyecto, y no había forma de imputarlas desde la UI.
- **Limpieza de huérfanos**: la acción "Desasignar" ahora borra la factura `origin="sin_respaldo"` que quede sin imputaciones — sin el movimiento, ese registro auto-creado no significa nada.
- **Sin cambios de schema. Sin tocar `metrics.ts`** (que ya cuenta cualquier `Invoice` recibida por proyecto, sin filtrar por origin).
- **Archivos**: `src/app/api/banco/movimientos/bulk/route.ts`, `banco/movimientos/page.tsx`, `MovementsTable.tsx`, `MovementsBulkBar.tsx`.
- **Decisión contable pendiente (MJ)**: "la contabilidad no debe salir de los EP, sino de las facturas o mov sin respaldo". Hoy `metrics.ts` suma EP cerrados como costo (`totalPagadoMaestros`); cuando se empiece a usar EP en la app habrá que sacarlos del cálculo para no contar doble. Ver `docs/WIP.md` ronda 26.

---

## 2026-05-16 — Cotización de artefactos: revisar precios online, duplicar de otra cotización, desvincular del catálogo

- **Qué cambió**: tres funciones nuevas en el editor de artefactos (`ArtefactosEditor`). (1) "Revisar precios online" — botón que recorre los items con link cargado, baja la página de cada producto y muestra un modal con el diff precio/imagen actual vs. del momento; MJ marca qué aplicar. (2) "Traer de otra cotización" — duplica los artefactos de otra cotización dentro de la actual, refrescando los precios online automáticamente (el descuento se mantiene, el precio cliente se recalcula). (3) La estrella ★ ahora también desvincula: click en un item ya catalogado lo suelta del catálogo BLARQ (`catalogId → null`) sin tocar otras copias.
- **Por qué**: pendientes de la ronda 18 (sistema de artefactos). MJ cotiza con precios que envejecen — los productos cambian de precio seguido online. Y suele partir de una cotización vieja como base. Duplicar + refrescar resuelve ese flujo. Desvincular faltaba: hasta hoy un item con `catalogId` propagaba toda edición y no había forma de cortarlo.
- **Schema**: sin cambios. (La idea original de "templates de espacio" se descartó: MJ pidió duplicar cotizaciones, no armar recetas.)
- **Archivos nuevos**: `src/lib/catalog/revisarArtefactos.ts` (scraping masivo con concurrencia 5), endpoints `revisar-precios`, `fuentes`, `importar-de` bajo `/api/presupuestos/[id]/artefactos/`, componentes `RevisarPreciosArtefactos.tsx` y `DuplicarArtefactos.tsx`.
- **Limitación conocida**: el scraping masivo puede tardar; en cotizaciones grandes (~37 items) puede acercarse al límite de tiempo de función de Vercel. Si pasa, la UI muestra error y MJ reintenta. `maxDuration` está en 120s (Vercel lo capa según plan).
- **Nota**: el PDF de artefactos ya tenía la línea editorial nueva (se aplicó en ronda 18) — ese pendiente de la ronda 15 estaba desactualizado en el WIP.

---

## 2026-05-16 — Multi-select + acciones masivas en `/banco/movimientos` (Fase 1)

- **Qué cambió**: la lista de movimientos bancarios tiene checkbox por fila + "seleccionar todo", y una barra flotante de acciones masivas con dos operaciones: **Desasignar** (quita las imputaciones de los movs elegidos, vuelven a `sin_asignar`) y **Asignar a factura** (imputa cada mov a una factura emitida elegida, por su monto completo).
- **Por qué**: MJ necesitaba poder desasignar facturas en masa y rehacer la conciliación; ir mov por mov era inviable tras detectar la pérdida de transferencias en Carolina Ovalle (ronda 23).
- **Implementación**: endpoint nuevo `POST /api/banco/movimientos/bulk`. La tabla de `/banco/movimientos` pasó a componente client (`MovementsTable.tsx`) para compartir estado de selección; barra y buscador de factura en `MovementsBulkBar.tsx`. En ambas acciones las facturas afectadas recalculan status vía `recomputeInvoiceStatus`.
- **No toca**: schema (sin migración). `metrics.ts` ni cálculos contables.
- **Pendiente — Fase 2**: "cliente del proyecto" (transferencias asignadas directo a proyecto+concepto, con o sin factura) — sigue siendo decisión abierta, requiere `projectId`/`conceptoCobro` en `BankMovement`.

---

## 2026-05-15 — Zonas (subChapter) en partidas de obra — UI completa + subtotal por zona

- **Qué cambió**: el campo `ObraItem.subChapter` (que ya existía en el modelo) ahora es editable desde el editor de presupuesto. Permite agrupar partidas por zona (ej. COCINA / BAÑOS) dentro de un mismo presupuesto, con subtotal por zona visible en el editor y en el PDF cliente.
- **Por qué**: V2 Paseo del Sena — clienta pidió separar cocina y baños dentro del mismo presupuesto (un solo contrato). Hasta hoy `subChapter` solo entraba vía Importar Cubicación; no había manera de escribirlo desde la app.
- **UI**: link "+ zona" / "↻ zona" inline al hover de cada fila con autocompletado, bandita gris clickeable para renombrar grupo entero, botón ⎘ duplicar partida (con snapshot de componentes) para partir mixtas. Selección múltiple con checkbox + barra flotante para asignar zona a varias a la vez.
- **Subtotal por zona**: en la misma fila de la bandita, alineado bajo Total — lee como titular `BAÑO ........ $ 662.866`. Solo se muestra si el capítulo tiene 2+ zonas distintas.
- **API**: PUT y POST de `/api/presupuestos/[id]/partidas` aceptan `subChapter`. Nuevo `POST .../partidas/[itemId]/duplicate`.
- **No toca**: `metrics.ts` ni cálculos contables. La zona es separador visual, no afecta totales ni GG/utilidad. Schema sin cambios.
- **Referencias**: PRs [#35](https://github.com/blarq-app/blarq-app/pull/35) (API + edición inline), [#36](https://github.com/blarq-app/blarq-app/pull/36) (bulk select), [#37](https://github.com/blarq-app/blarq-app/pull/37) (suavizar subtotal), [#38](https://github.com/blarq-app/blarq-app/pull/38) (subtotal en bandita).

---

## 2026-05-15 — Sync diferencial cotización ↔ catálogo + regla contractual

- **Qué cambió**: el sync entre catálogo de partidas y cotizaciones en borrador ahora detecta y aplica componentes agregados o eliminados desde el catálogo, no solo cambios de precio. El flag `ObraItem.isCustomized` pasa a ser granular: editar/agregar un componente blinda solo ese componente (no la partida entera). Borrar un componente registra el descarte para que el sync no lo recree. Schema aditivo: `ObraItemComponent.originComponentId` + tabla `ObraItemDiscardedCatalogComponent`. Aplicado en dev y prod.
- **Regla contractual nueva (MJ 2026-05-15)**: partidas con `lineageId` presente en una versión enviada/aprobada del mismo proyecto+tipo quedan blindadas — el sync no las toca aunque la versión actual sea borrador. Las partidas con `lineageId` propio de la nueva versión sí se sincronizan. Helper compartido en `src/lib/catalog/frozenLineage.ts`.
- **Backfill**: `scripts/backfill-origin-component-id.ts` mapeó 1562/1625 componentes en prod (96%); 63 sin match están protegidos contra duplicación por guarda defensiva.
- **Por qué**: caso real disparador — MJ agrega "FLEXIBLE GAS 1MT" al catálogo de "INSTALACION ENCIMERA GAS", refresca la cotización Paseo del Sena, no pasa nada. Además: la granularidad gruesa del flag `isCustomized` bloqueaba demasiado, y faltaba blindar contractualmente partidas ya enviadas al cliente.
- **Impacto**: cierra el flujo "modifico catálogo → recargo presupuesto en borrador → Actualizar → cambios bajan". Deuda menor: 63 componentes sin `originComponentId` en prod no participan del sync diferencial (funcionan como antes).
- **Referencias**: commit `d28fe6d`, PR [#31](https://github.com/blarq-app/blarq-app/pull/31), ADR [docs/decisions/2026-05-15-sync-diferencial-cotizacion-catalogo.md](decisions/2026-05-15-sync-diferencial-cotizacion-catalogo.md).

---

## 2026-05-14 — Reglas de proveedor: separar toggle categoría/proyecto

- **Bug**: el bulk-assign de `/facturas` mostraba un solo toggle "Guardar regla" que aparecía únicamente cuando había categoría asignada, pero el backend aprendía categoría **y** proyecto siempre (default ON). Cambios solo de proyecto → toggle invisible → MJ no sabía que estaba creando regla. La edición inline (PATCH) tampoco tenía toggle. Como `upsertInvoiceRule` dispara `updateMany` retroactivo sobre todas las facturas del mismo RUT sin proyecto, proveedores transversales (Easy/Sodimac/MK) terminaban con facturas históricas mal asignadas.
- **Fix**: dos toggles independientes. **Categoría default ON** (visible cuando hay categoría), **proyecto default OFF** (visible cuando hay proyecto, para casos "siempre BLARQ" como Autopistas/Bencina). PUT y PATCH de `/api/facturas/[id]` solo aprenden categoría — nunca proyecto.
- Archivos: `src/app/api/facturas/bulk-assign/route.ts`, `src/app/api/facturas/[id]/route.ts`, `src/components/facturas/BulkAssignBar.tsx`, `CLAUDE.md` §4.5.
- Sin migración de schema. No toca facturas ni reglas existentes — solo cambia el comportamiento futuro.

---

## 2026-05-14 — Sistema completo de artefactos (importador + editor + catálogo + sincronización)

- **Importador de Excel de proveedores** (`src/lib/import/parseArtefactos.ts` + endpoint + botón en la página de presupuesto). Soporta hojas tipo "ARTEFACTOS SANITARIOS" (agrupado por habitación), "ARTEFACTOS COCINA / TEKA", "ARTEFACTOS ILUMINACION". Ignora MAESTRA y *_HG (V1 vieja).
- **Editor y PDF rediseñados** matcheando el Excel de referencia: jerarquía subcategoría → habitación → items, columnas IMG | ITEM | DETALLE | MARCA | CANT | LISTA | DCTO | TOTAL, subtotales por nivel, total general. Toggle "Mostrar columnas internas" agrega NETO BLARQ + UTILIDAD (no van al PDF cliente).
- **Imágenes con auto-extracción** desde el link del producto. Scraper universal (JSON-LD + OpenGraph + regex) — funciona con mk.cl, chc.cl, byp.cl, ledstudio.cl, ledconcept.cl, sodimac.cl, easy.cl y cualquier sitio que exponga metadata estándar. Campo manual fallback para sitios sin scrape. Imagen a ~32mm en PDF (medido contra Excel original).
- **Catálogo BLARQ global** (`ArtefactoCatalog`, página `/catalogo/artefactos`, entry en Sidebar). Items reutilizables entre proyectos: name, detail, brand, subcategory, tag, supplier, link, imagen, listPrice, discountPercent, isStandard, lastPriceCheck. Buscador full-text + filtros. Atajo "pegar link + extraer" en creación.
- **Sincronización entre copias del mismo catalogId**: campos del producto se propagan a otras copias del budget + al catálogo global. `realCostBlarq` se sincroniza solo dentro del budget (cotización privada varía proyecto a proyecto).
- **Fix de convenciones en BD** (decimal 0..1 para discountPercent, clientPrice unitario) — el editor anterior pisaba mal el precio al guardar.
- **Bug bonus**: sync SII ahora aplica regla de categorización también a facturas existentes (no solo nuevas). Síntoma original: Maxi Mobility aparecía sin catalogar aunque tenía regla. 1 factura recuperada en prod (folio 281571).
- PRs #14–#27 mergeados a main, deployados. Migraciones aplicadas en dev y prod antes del deploy del PR final del catálogo (para evitar 500 durante la propagación).

---

## 2026-05-13 — Sync MaterialCatalog ↔ PartidaCatalog + auditoría + edición componentes

- **Bug detectado en catálogo**: las partidas guardaban un snapshot del material asociado. Cambiar precio/marca en `/catalogo/materiales` NO propagaba al catálogo de partidas — y los presupuestos creados después arrastraban precios viejos (caso real: llave de paso gas Constanza Bravo $12.269 vs material $19.319).
- **Schema** (aditivo, aplicado en dev y prod): `ObraItemComponent.isCustomized` para marcar componentes editados manualmente. El sync masivo los respeta.
- **Fase 0 — limpieza inicial**: `scripts/sync-partidas-with-materials.ts` aplicado en dev (305 components, 299 partidas) y prod (324 components, 317 partidas).
- **Fase 1 — sync automático + auditoría**: `PUT /api/catalogo/materiales/[id]` ahora propaga al catálogo de partidas. Nueva página `/configuracion/auditoria-precios` lista presupuestos en borrador desactualizados + botón "Actualizar". `BudgetAuditBanner` arriba del editor del presupuesto cuando aplica.
- **Fase 2 — edición de componentes a nivel proyecto**: `ObraItemComponentsEditor` (UI editable en el desglose expandido de cada ítem) + endpoints `/api/presupuestos/[id]/partidas/[itemId]/componentes[/compId]`. Edición marca `isCustomized=true`. Bloqueado para presupuestos no-borrador.
- **Helpers backend reutilizables** en `src/lib/catalog/` (recalcPartida, recalcObraItem, syncMaterial).
- PR [#4](https://github.com/blarq-app/blarq-app/pull/4) mergeado, deployado.

---

## 2026-05-13 — Rediseño PDF cotización + Rosas V4 a prod

- **PDF obra y muebles unificados con nueva línea editorial** (PR #1, commit `fd7705b`, mergeado a main): tipografía `#1A1A1A`, header con grilla 2 cols, tabla sin verticales y con líneas casi invisibles `0.15pt #E5E5E5`, bloque de totales sutil sin marco rectangular, sin footer, márgenes 10/12 mm. Eliminadas `buildObraFooter` y `buildMueblesFooter`. `renderPDF` ahora soporta `scale` opcional.
- **Artefactos PDF sigue con formato anterior** — pendiente decidir si replicar.
- **Rosas V4 obra cargado** en dev y prod (Cristian Zulueta, Costo Total $30.989.264, GG 20% / Util 10%, 5 ítems aprobados). Snapshot pre/post en prod confirma que solo Rosas se movió.
- Script nuevo `scripts/replicate-rosas-dev-to-prod.ts` (patrón liviano de `replicate-arrau`).
- Fix cosmético en `scripts/import-budget.ts`: el print de la proyección muestra los % GG/Util reales del Excel en vez de hardcoded 23%/5%.

---

## 2026-05-04 — Documentación viva inicial

- Reestructura completa de `/docs/`: `architecture.md`, `business-model.md`, `glossary.md`, `principles.md` consolidan info que vivía dispersa en memoria de Claude y en reviews históricos. ADRs en `docs/decisions/` para 3 decisiones estructurales (numeración paralela, cantidad ejecutada base EP, descripción dual). Plantillas en `docs/_templates/`. `WIP.md` para estado entre sesiones.
- `CLAUDE.md` reemplazado de 1 línea (redirect) a doc completo con instrucciones permanentes para asistentes IA. `AGENTS.md` eliminado, su contenido (nota Next.js 16) absorbido en CLAUDE.md.
- `README.md` reescrito desde boilerplate a doc útil (qué es BLARQ + cómo levantar dev + punteros a /docs/).
- **Por qué**: cada sesión nueva con Claude o LLM agente partía sin contexto. Memoria estable ahora vive en repo (commiteada, accesible para JT y otras instancias), no en disco local de MJ.
- **Impacto**: alinear futuras sesiones, reducir re-explicación. Cadencia de actualización: ver §8 de `CLAUDE.md`.

## 2026-05-04 — Comparador BLARQ vs Maxxa generalizado

- `scripts/compare-portofino-maxxa.ts` (hardcoded a Portofino) → `scripts/compare-vs-maxxa.ts` con args `<projectName> <maxxaExportPath> [--cc <patrón>]` y npm script `compare:maxxa`.
- Fix incidental: Maxxa exporta NCs con signo negativo en `MontoTotal`; el cálculo del neto sumaba en vez de restar. `Math.abs()` en parseo.
- Verificado contra Portofino: BLARQ = Maxxa, 0 unilaterales, 0 con monto diferente.

## 2026-05-04 — Búsquedas case-insensitive (deuda post-cutover)

- 16 usos de `contains: q` en queries Prisma actualizados a `contains: q, mode: "insensitive"`. Archivos: `api/catalogo/partidas`, `api/catalogo/materiales`, `api/facturas`, `api/facturas/search`, `(dashboard)/banco/movimientos`, `(dashboard)/proyectos/[id]/facturas`.
- Origen: cutover SQLite→Postgres dejó `contains` case-sensitive (en SQLite era insensitive por default). MJ lo notó en `/facturas` (commit anterior `34773da`); este pase audita el resto.
- Verificado en preview: `hormigon` matchea "AVANCE POR HORMIGON", `mobeli` matchea "MOBELI DISENOS LIMITADA".

## 2026-05-04 — Fase 2: PDFs oficiales SII via Playwright + cert (LOCAL ONLY)

- Nuevo módulo `src/lib/sii/siiBrowser.ts` (login mTLS + warmup + `mipeSelEmpresa.cgi` + listado paginado + descarga PDF). Cert `.pfx` legacy se carga vía `node-forge` y se exporta a PEM para Playwright.
- `Invoice` gana 3 campos: `siiCodigo` (id listado SII), `pdfContent` (Bytes), `pdfFetchedAt`. Endpoint `/api/facturas/[id]/pdf` con toggle oficial vs interno (header `X-PDF-Source`). Badge `↓✓` verde en lista y botón "↓ PDF oficial" en detalle.
- CLI `npm run sii:sync-pdfs` con flags `--limit`, `--dry-run`, `--headed`, `--refetch-failed`. LaunchAgent `com.blarq.sii-sync-pdfs` corre 9:00 AM diario en mac de MJ.
- Sync masivo en dev y prod: 473/507 OK, 34 edge case (NCs por intercambio directo, fallback PDF interno).
- **Por qué local-only**: WAF F5 BIG-IP del SII bloquea no-Chromium. Vercel agrega IP cloud que dispara más bloqueos. Probado: Node + headers fake = 503; Chromium real = pasa.
- Detalle: [docs/SETUP_SII_pdf-oficial.md](SETUP_SII_pdf-oficial.md). Commits `1d67269`, `2937224`. Backup pre-cambios: `backups/blarq-prod-2026-05-04T21-17.json.gz`.

## 2026-05-03 — Migración a producción (Vercel + Neon Postgres)

- Cutover SQLite → Postgres (Neon). Schema único (provider postgresql). Dev branch aislado de prod.
- Deploy a Vercel Hobby (https://blarq-app.vercel.app), GitHub repo privado, deploy automático on-push a `main`.
- NextAuth en prod, MJ + JT con emails reales (`mjblanco@blarq.cl`, `jtlarrain@blarq.cl`). Pass inicial común, `/cuenta` para cambio propio.
- Mobile responsive: sidebar drawer + tablas con scroll horizontal + grids responsive.
- Detalle del proceso: [docs/MIGRATION_POSTGRES.md](MIGRATION_POSTGRES.md). Commits `7a1a9d9`, `9be630c`, `da51ea2`, `9c2184c`, `2a4f355`, `0e0c103` y otros.

## 2026-05-03 — SII directo: auto-link NCs ↔ facturas (sin SimpleFactura)

- Cliente propio del SII con cert digital: SOAP auth (`getSeed` + `getTokenFromSeed` con XMLDSig) + REST `consdcvinternetui` (`getResumen`, `getDetalleCompra`, `getDetalleDTE`).
- `getDetalleDTE` devuelve `dataReferencias[]` inline → no hay que parsear XMLs. NC se linkea con su factura original (`referenceFolioNumber`, `referenceTipoDoc`).
- Backfill 18/20 NCs históricas en prod. Las 2 SODIMAC enero sin referencia en SII son edge case manual.
- Cert subido a Vercel (`SII_CERT_BASE64`). Vence 2026-08-01.
- Commits `fc3c01f` (Fase A: cert + auth), `eefabdf` (Fase B: RCV listing), `e095d99` (Fase D: link NCs).

## 2026-05-03 — Drop placeholder "Pendiente de asignar" en CostCategory

- Categoría placeholder eliminada. `Invoice.categoryId = null` es ahora la única representación de "no clasificado".
- Razón: el motor de reglas RUT→categoría retroactivo busca `categoryId IS NULL`. Las 48 facturas con la categoría placeholder eran invisibles para el motor.
- Detalle: ver feedback en [CLAUDE.md §4.6](../CLAUDE.md#46-placeholders--null). Commit `167bb38`.

## 2026-05-01 — Sprint 4 banco: modal Maxxa-style + reglas que aprenden

- Rediseño visual `/banco/conciliacion`: agrupado por fecha, barra vertical roja/verde, monto grande primer foco visual.
- Modal "Asignar pagos" (`MovementReconcileModal`): search dinámico, filtros "Mismo cliente"/"Solo con saldo", saldo restante visible, match exacto resaltado, working copy de imputaciones.
- `/banco/movimientos` ahora vista principal: stats + búsqueda libre + botón "Asignar" inline.
- Auto-conciliar al emitir factura: helper `tryAutoMatchInvoiceWithExistingMovs()` se llama desde POST `/api/facturas` y desde sync SII. Si hay UN mov sin asignar del mismo RUT con monto exacto, se vincula solo.
- Reglas que aprenden: tabla `BankCategorizationRule`, se crea/actualiza al categorizar manual con primeras 3 palabras de la descripción.
- Commit `cc0d9ad`.

## 2026-04-30 — Sprint 3 banco: cobros parciales + splits

- Tabla `InvoicePayment(bankMovementId, invoiceId, amountApplied)` many-to-many. Status factura derivado: `pendiente | parcial | pagada`. Status movimiento: `sin_asignar | parcial | conciliado`.
- Helper `recomputeInvoiceStatus(invoiceId)` en `lib/banco/invoicePayments.ts`. Listado de facturas con badge "PARCIAL".
- `BankMovement.invoiceId` queda en schema pero deprecated.
- Commit `3a77ef0`.

## 2026-04-30 — Fix NCs en metrics.ts

- `metrics.ts` ahora resta `tipoDoc=61` del cobrado y gastado. Antes las sumaba como facturas normales.
- Inflaba ~$13M en algunos proyectos (ej: Francisco de Aguirre). Bug detectado en auditoría.
- Commit `3a9b695`.

## 2026-04-29 — Sprint 1+2 banco: parser Santander + fondo sueldos

- Schema `BankAccount` + `BankMovement`, cuentas Santander seedeadas (Operativa 8913459-5, Sueldos 9987891-6).
- Parser cartolas Santander (formato provisoria + histórica) + UI import + auto-matching contra facturas pendientes por (RUT, monto).
- `lib/banco/fondoSueldos.ts` con `computeFondoSueldos`, `PLANILLA_MENSUAL_CLP=11M`. Card en resumen del proyecto. `/banco` con panel global.
- Resultado importación marzo+abril: 348 movs, 206 facturas auto-conciliadas, 9 transfers internas matcheadas, ~91 sin asignar.
- Commits `b97b74e`, `fd519b5`, `4ac65de`, `38f5c54`.

## 2026-04-28-29 — Refactor jerárquico + EERR + integración SII inicial

14 commits. Resumen de los más estructurales:
- **Correlativos cotización/proyecto** (commit `9265bac`) — numeración paralela. Ver ADR [`2026-04-28-numeracion-paralela.md`](decisions/2026-04-28-numeracion-paralela.md).
- **Tabla "Presupuesto vs Real"** jerárquica con 3 secciones + total (commit `c5c6000`).
- **EERR estructurado** con período + variación vs período anterior (commit `7458824`).
- **Vista BLARQ dedicada** + reagrupar Auto como top con subs (commit `eca4206`).
- **Edición inline** EditableCell + PATCH `/api/proyectos/[id]` (commit `540d582`).
- **Fix IVA**: gastado se calcula NETO contra presupuesto neto (commit `c75d334`). Etiquetas "c/IVA" / "neto" en cada monto (commit `04cb028`).
- Imports históricos Maxxa (recibidas + emitidas, ene-abr 2026): commits `43feb51`, `7d18977`, `e1146f2`. Imports de Portofino (Obra V1, Muebles V1, Artefactos V1): commits `b10c946`, `55aa45f`.
- Filtros tipo Excel en facturas del proyecto + totales reactivos (commit `862220a`).
- Inventario completo: [REVIEW_autorevision_2026-04-29.md](REVIEW_autorevision_2026-04-29.md).

## 2026-04-26 — Módulo EP Phase 1: cantidad ejecutada + dual desc + sync

- `EstadoPago` + `EstadoPagoItem` con `quantityExecuted` (cantidad acumulada) como base, `amountPaid` snapshot inmutable al cerrar, `lineageId` para identidad estable a través de versiones de presupuesto, `descriptionMaestro` separada de `descriptionCliente`.
- 26 tests pasando en `scripts/test-ep-calculations.ts`. Editor `EditorEP.tsx` con Sync Diff Modal. PDF maestro `EstadoPagoPDF.html.ts` (Puppeteer + HTML/CSS, formato Portofino).
- ADR: [`2026-04-26-cantidad-ejecutada-base-eps.md`](decisions/2026-04-26-cantidad-ejecutada-base-eps.md), [`2026-04-26-descripcion-dual-cliente-maestro.md`](decisions/2026-04-26-descripcion-dual-cliente-maestro.md).

## 2026-04-27 — Setup integración SII inicial via SimpleFactura

- Endpoint `POST /api/sii/sync` autentica contra SimpleFactura, baja DTEs recibidos y emitidos desde 1-abril-2026, hace upsert con unique key `(type, tipoDoc, folioNumber, rutIssuer)`.
- Facturas SII llegan con `origin='sii_automatica'` y `projectId=null`. Se asignan a proyecto manualmente.
- Detalle: [SETUP_SII_simplefactura.md](SETUP_SII_simplefactura.md).
