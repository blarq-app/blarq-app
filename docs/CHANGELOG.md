# CHANGELOG

Log cronológico de cambios estructurales. 3-5 líneas por entrada, las más nuevas arriba. Plantilla en [`_templates/CHANGELOG-entry.md`](_templates/CHANGELOG-entry.md).

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
