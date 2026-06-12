# Architecture

Vista técnica de la app. Cómo está armada, qué vive dónde, con qué se comunica.

> **Nota**: la documentación de negocio (qué modela, por qué) vive en [business-model.md](business-model.md). Acá solo el cómo técnico.

## 1. Stack

| Capa | Tecnología | Versión / detalle |
|---|---|---|
| Framework | Next.js (App Router) | 16.2.3 — **NO es el Next.js de los training datasets recientes**; revisar `node_modules/next/dist/docs/` ante dudas de API. |
| UI | React | 19.2.4 |
| Lenguaje | TypeScript | 5 |
| Estilos | Tailwind CSS | 4 (con `@tailwindcss/postcss`). |
| ORM | Prisma | 6.19 |
| BD prod | Neon Postgres | branch `ep-shy-morning-anuapn5q-pooler` (us-east-1). |
| BD dev | Neon Postgres | branch `ep-solitary-mud-ani199u1-pooler` (us-east-1). |
| Auth | NextAuth (Auth.js) | 5.0 beta. |
| PDFs internos | Puppeteer | render HTML→PDF. |
| Sync local SII (PDFs oficiales) | Playwright + node-forge | mTLS con cert digital. |
| Hosting | Vercel | Hobby tier, deploy auto on-push a `main`. |
| Repo | GitHub privado | `blarq-app/blarq-app`. |

## 2. Estructura de carpetas

```
blarq-app/
├── CLAUDE.md           Instrucciones permanentes para asistentes IA.
├── README.md           Index del repo.
├── HANDOFF.md          (untracked) Notas efímeras de cierre de sesión.
├── prisma/
│   ├── schema.prisma   26 modelos. La doc del por qué de varios campos vive inline.
│   ├── migrations/     Migraciones generadas.
│   └── seed.ts         Seed inicial (usuarios MJ + JT).
├── docs/               Documentación viva. Punto de entrada.
├── scripts/            CLIs (sync SII, backup, compare-vs-maxxa, tests, etc.).
├── src/
│   ├── app/            Next App Router.
│   │   ├── (dashboard)/    Rutas autenticadas (sidebar global).
│   │   ├── api/            Route handlers.
│   │   ├── login/
│   │   ├── layout.tsx
│   │   └── globals.css
│   ├── components/     React components, organizados por dominio.
│   └── lib/            Lógica de negocio (ver §4).
├── .claude/
│   ├── launch.json         Preview server config.
│   └── settings.local.json Permisos por usuario (gitignored).
└── public/
```

## 3. Rutas (mapa)

### Dashboard global (sidebar siempre visible)

| Ruta | Función |
|---|---|
| `/` | Dashboard top-level — KPIs globales + cards por proyecto activo. |
| `/proyectos` | Lista plana de proyectos. |
| `/cotizaciones` | Lista de proyectos en estado `cotizacion`. |
| `/facturas` | Listing global de facturas con filtros. |
| `/banco` | Panel global cuenta operativa + cuenta sueldos + fondo sueldos. |
| `/banco/movimientos` | Vista principal de movimientos importados. |
| `/banco/conciliacion` | Modal-style: asignar pagos a facturas. |
| `/banco/reglas` | Reglas de auto-categorización aprendidas. |
| `/catalogo/partidas` | Catálogo global de partidas. |
| `/catalogo/materiales` | Catálogo global de materiales. |
| `/cuenta` | Mi cuenta (cambio de password propia). |

### Por proyecto (`/proyectos/[id]/...`)

| Ruta | Función |
|---|---|
| `/` | Detalle: datos cliente + KPI cards + alerta desviación + quick links. |
| `/editar` | Form de edición. |
| `/presupuesto` | Lista de versiones (V1/V2/V3 — Obra / Muebles / Artefactos). |
| `/presupuesto/[id]` | Editor de versión. |
| `/estados-pago` | Lista de EPs. |
| `/estados-pago/[id]` | Editor de EP. |
| `/facturas` | Listing del proyecto (tabs por tipo). |
| `/lista-compra` | Lista de materiales agregados del presupuesto (en construcción). |

## 4. Lógica de negocio (`src/lib/`)

```
lib/
├── prisma.ts                  Cliente singleton.
├── auth.ts                    NextAuth handler.
├── periods.ts                 Helpers de períodos (mes/año).
├── utils.ts                   Misc compartido (compareCatalogCategories, etc.).
├── projects/
│   ├── metrics.ts             ⚠️  Única fuente de verdad de cálculos por proyecto.
│   └── lastActivity.ts
├── ep/
│   ├── calculations.ts        Lógica pura, suite test-ep-calculations.ts (26 asserts).
│   ├── snapshot.ts            Snapshot inmutable al cerrar EP.
│   └── sync.ts                Sync EP ↔ versión más reciente del presupuesto (por lineageId).
├── facturas/
│   └── categorizationRules.ts Motor de reglas RUT→categoría.
├── banco/
│   ├── santanderParser.ts     Parser de cartolas Santander (provisoria + histórica).
│   ├── invoicePayments.ts     InvoicePayment many-to-many (cobros parciales).
│   ├── fondoSueldos.ts        Cálculo fondo sueldos (GG obra + util muebles).
│   └── categorizationRules.ts Reglas de auto-categorización por descripción.
├── sii/
│   ├── cert.ts                Carga del .pfx con node-forge.
│   ├── siiAuth.ts             SOAP getSeed + sign + getToken (XMLDSig).
│   ├── siiRcv.ts              REST endpoints consdcvinternetui.
│   ├── linkNcReferences.ts    Auto-link NCs ↔ facturas vía getDetalleDTE.
│   ├── simpleFacturaClient.ts Cliente HTTP de SimpleFactura.
│   └── siiBrowser.ts          Playwright + cert para PDFs oficiales (LOCAL ONLY).
└── pdf/
    ├── renderPDF.ts           Wrapper Puppeteer.
    ├── ObraPDF.html.ts        PDF presupuesto Obra (replica Excel V3 BLARQ).
    ├── MueblesPDF.html.ts
    ├── ArtefactosPDF.html.ts
    ├── EstadoPagoPDF.html.ts  PDF maestro (sin precios visibles).
    ├── InvoicePDF.html.ts     PDF interno de factura (resumen).
    └── ListaCompraPDF.html.ts
```

## 5. Modelo de datos (Prisma)

**26 modelos** en `prisma/schema.prisma`. La fuente de verdad es ese archivo (con comentarios in-line del por qué). Acá un mapa por dominio.

### Usuarios y proyectos

- `User` — admin igualitario MJ + JT. Hash bcrypt en `password`.
- `Project` — núcleo del modelo. Numeración paralela `numeroCotizacion` + `numeroProyecto`. `isInternal=true` para BLARQ y centros de costo internos. Status: `cotizacion | ejecucion | terminado | archivado`.
- `Maestro` — equipos de mano de obra. 1 maestro = 1 a varios proyectos.
- `PaymentTerm` — cuotas de cobro al cliente (Anticipo / Avance / Saldo).

### Presupuesto

- `BudgetVersion` — V1, V2, V3 por proyecto. Tipo: `obra | muebles | artefactos`.
- `ObraItem` — líneas del presupuesto Obra. `lineageId` para identidad estable a través de versiones.
- `MuebleChapter` + `MuebleItem` + `MuebleQuote` + `MuebleDetail` — Muebles tienen jerarquía propia (capítulo → item → cotización por proveedor → detalle).
- `ArtefactoItem` — Artefactos en estructura plana.
- `PartidaCatalog` + `PartidaComponent` — catálogo global de partidas (206 al día) con desglose por tipo de concepto: `material | labor | margin | tool | loss | subcontract`.
- `MaterialCatalog` + `MaterialPriceOffer` + `MaterialPriceHistory`.

### Estados de Pago (a maestros)

- `EstadoPago` — vinculado a `BudgetVersion` (snapshot del ppto vigente al crear). Status: `borrador | cerrado`.
- `EstadoPagoItem` — `quantityExecuted` es la verdad financiera (cantidad acumulada). `amountPaid` es snapshot inmutable al cerrar. `lineageId` para sobrevivir cambios de versión. `descriptionMaestro` separada de `descriptionCliente`. Ver ADR `2026-04-26-cantidad-ejecutada-base-eps.md`.

### Facturas

- `Invoice` — DTEs recibidos y emitidos. Unique key: `(type, tipoDoc, folioNumber, rutIssuer)`. Origen: `manual | sii_automatica`. `conceptoCobro: obra | muebles | artefactos | mixto`.
- Campos de PDF oficial: `siiCodigo` (id del listado SII), `pdfContent` (Bytes — el PDF crudo, NUNCA cargar en queries de UI), `pdfFetchedAt`.
- `InvoiceCategorizationRule` — reglas RUT→categoría aprendidas.
- `CostCategory` — jerárquica (parent/sub). Ver `business-model.md` para el árbol completo.

### Banco

- `BankAccount` — Operativa (8913459-5) + Sueldos (9987891-6).
- `BankMovement` — movimientos importados de cartolas Santander.
- `InvoicePayment` — many-to-many `BankMovement ↔ Invoice` con `amountApplied` (cobros parciales).
- `BankCategorizationRule` — reglas que aprenden por descripción.

### Compras (en construcción)

- `ShoppingItem` — items de la lista de compra agregada. Aún no totalmente conectado al presupuesto.

## 6. Servicios externos

### 6.1 SimpleFactura (lectura DTEs)

Plan pago. La app llama a su API REST para traer facturas recibidas y emitidas desde el SII vía MIPYME. Solo lectura — la app **no emite**. Detalle: [SETUP_SII_simplefactura.md](SETUP_SII_simplefactura.md).

### 6.2 SII directo (auto-link de NCs)

Auth SOAP propia con cert digital, REST `consdcvinternetui` para detalle de DTEs y referencias inline (`dataReferencias[]`). Permite linkear notas de crédito a sus facturas originales sin parsear XMLs. Funciona en Vercel (los endpoints REST de `www4.sii.cl` no tienen WAF agresivo).

### 6.3 SII directo (PDFs oficiales) — LOCAL ONLY

Playwright + cert digital para acceder al portal MIPE y bajar PDFs oficiales de DTEs recibidos (`mipeShowPdf.cgi`). El SII tiene WAF F5 BIG-IP que detecta clientes no-Chromium, por lo que **no funciona desde Vercel**. Corre en mac de MJ via LaunchAgent diario (9:00 AM) + sync on-demand. Detalle completo: [SETUP_SII_pdf-oficial.md](SETUP_SII_pdf-oficial.md).

### 6.4 Maxxa (transitorio, sin API)

Sistema de facturación que BLARQ usa hoy para **emitir** facturas (la app aún no emite). La integración es solo a través de exportaciones manuales (`.xls` HTML). Comparable contra la BD vía `npm run compare:maxxa`. Salida de Maxxa pendiente: ver ADR cuando se decida proveedor para emisión propia.

## 7. Decisiones arquitectónicas estructurales

Los ADRs detallados viven en [`/docs/decisions/`](decisions/). Resumen de las activas hoy:

| Decisión | ADR |
|---|---|
| Numeración paralela cotización/proyecto. | `2026-04-28-numeracion-paralela.md` |
| Cantidad ejecutada (no %) como base en EPs. | `2026-04-26-cantidad-ejecutada-base-eps.md` |
| Descripción dual cliente/maestro. | `2026-04-26-descripcion-dual-cliente-maestro.md` |
| Sync de PDFs SII solo local (no Vercel). | (pendiente — escribir al referenciar) |
| Migración SQLite → Postgres + cutover Vercel. | (pendiente — referencia: `docs/MIGRATION_POSTGRES.md`) |
| `metrics.ts` única fuente de verdad. | (pendiente — referencia: commit `fb377b1`) |
| No cargar `pdfContent` (Bytes) en queries de UI. | `2026-06-12-no-cargar-bytes-pesados-en-ui.md` |
| Salida de Maxxa, mediano plazo. | (pendiente, decisión de proveedor en standby) |

Detalles operativos del cutover Postgres histórico: [MIGRATION_POSTGRES.md](MIGRATION_POSTGRES.md). Reviews críticos del estado pasado: [REVIEW_navegacion_2026-04-27.md](REVIEW_navegacion_2026-04-27.md), [REVIEW_autorevision_2026-04-29.md](REVIEW_autorevision_2026-04-29.md).

## 8. Tests

No hay suite general. Tests existentes (todos como scripts CLI):

| Script | Cubre |
|---|---|
| `scripts/test-ep-calculations.ts` | 26 asserts sobre lógica pura de EP. |
| `scripts/test-ep-flow.ts` | Flow end-to-end de EP (cerrar EP1 + crear EP2). |
| `scripts/test-metrics.ts` | Cálculos financieros de proyecto. |
| `scripts/test-rules.ts` | Motor de reglas de categorización (37 asserts). |
| `scripts/test-sync-create-v6.ts` | Modal de sync (V5→V6 sintética). |
| `scripts/test-playwright-sii.ts` | Probe end-to-end del flow SII PDF oficial. |

Si vas a tocar `metrics.ts`, `calculations.ts` o `fondoSueldos.ts`, correr los tests correspondientes antes y después.

## 9. Despliegue

- **Push a `main`** → Vercel detecta y deploya automático en ~2 min.
- Build comprueba TypeScript estricto (la primera build fue rota por errores TS preexistentes en `scripts/`; hoy `tsconfig.json` excluye `scripts/`).
- Variables sensibles (cert base64, DATABASE_URL prod) están en Vercel env vars, NO en repo. Vercel CLI autenticado en mac de MJ — futuros redeploys/env vars desde Claude se pueden hacer sin pedir nada.
