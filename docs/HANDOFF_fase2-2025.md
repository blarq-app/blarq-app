# HANDOFF — Fase 2: Cross-check Maxxa vs App, año 2025

Documento de traspaso para la sesión que continúe la auditoría cruzada Maxxa vs app, ahora para **2025**. La Fase 1 (2026) ya está hecha y validada. **Leer esto antes de tocar nada.**

---

## 0. Qué leer primero (en este orden)

1. `CLAUDE.md` (reglas del repo — especialmente §4.1 metrics.ts, §4.7 escrituras a prod).
2. `docs/RESUMEN_cross-check-maxxa_2026-05-31.md` — resumen ejecutivo de la Fase 1.
3. `docs/REVIEW_maxxa-vs-app-2026_2026-05-30.md` — el cross-check completo de 2026 (la metodología).
4. `docs/REVIEW_maxxa-conciliacion-pendiente_2026-05-30.md` — el listado accionable de 2026.
5. `docs/WIP.md` — Ronda 36 (todo el detalle de lo hecho).

---

## 1. Qué es Fase 2 y por qué quedó separada

Comparar Maxxa vs la app para **2025** (la Fase 1 cubrió solo 2026). Se separó porque 2025 es más grande y más delicado, y porque la metodología había que validarla primero en datos frescos (2026). Ya está validada.

**El trabajo central de 2025**: hay **109 facturas recibidas de 2025 marcadas `pagada` sin enlace de pago** (`InvoicePayment`) — parte de las 130/$72M totales que detectamos. Esas 109 (mayormente Sodimac + maestros) son lo que hay que re-enlazar, PERO solo se puede hacer bien con la cartola de 2025 y cruzando por glosa/RUT, no por monto.

---

## 2. Estado al traspaso (lo que YA está hecho — NO rehacer)

- **2026 facturas**: cross-check completo. Los dos sistemas cuentan la misma plata.
- **2026 conciliación recibidas**: 23 facturas (Sección 1, $14,8M) + 2 pagadas-sin-enlace ($547k) conciliadas en prod.
- **Pedro Barrera (todos los años)**: resuelto. 33/49 movs conciliados (Casa Arrau + Quincho La Llaveria registrado +$2,935M). Los 16 restantes son proyectos fantasma 2025 (Waterloo/Duplex/Holanda/Las Nieves) que MJ decidió dejar afuera.
- **metrics.ts**: NO tocado. El filtro de anuladas quedó como tarea (ADR `2026-05-30-metrics-no-filtra-anuladas.md`).

---

## 3. Lo que falta para 2025 (el trabajo de esta sesión)

1. **Conseguir de MJ los datos 2025 de Maxxa** (ver §5).
2. **Cross-check de inventario de facturas 2025** (mismo método que `REVIEW_maxxa-vs-app-2026`): facturas en Maxxa no en app, en app no en Maxxa, diferencias de monto/proyecto/anulada, NCs.
3. **Re-enlazar las 109 recibidas pagadas-sin-enlace de 2025** — usando la cartola 2025 de Maxxa como fuente del movimiento, con cobertura 100% y cruce por glosa/RUT (NO por monto).
4. **Evaluar el lado cobro 2025** (emitidas / abonos de cliente sin conciliar).
5. **(Opcional, con MJ) filtro de anuladas en metrics.ts** — requiere snapshot pre/post (§4.1).

---

## 4. Lecciones y normalizaciones YA resueltas (reusar tal cual)

- **Identidad de factura**: recibidas = `tipoDoc + folio + RUT emisor`; emitidas = `tipoDoc + folio` (en emitidas el `RutDoc` de Maxxa es el del CLIENTE, no BLARQ).
- **Signo de NC**: Maxxa guarda `MontoTotal` negativo, la app positivo → **comparar magnitudes** (abs). En 2026 calzaron 24/24 al peso.
- **Mapeo tipoDoc**: 33 (factura), 34 (exenta), 61 (NC), **1043 (sin respaldo — mismo código en ambos)** calzan. **39 (boleta) y 1039 (BHE) la app NO los sincroniza**. 1054 (traspaso) no es factura.
- **"2025" en Maxxa = período tributario** (`AgnoTrib=2025`), puede incluir facturas con `FechaDoc` de fin-2024. Reportar ese borde.
- **CRUZAR MOVIMIENTOS POR GLOSA/REMITENTE, NUNCA POR MONTO SOLO.** Lección cara de Fase 1: había varias transferencias de $5M el mismo día → el cruce por fecha+monto pegó la equivocada (falso positivo de $20M). Usar la glosa (`0xxxxxxxxx Transf a/de Nombre`) y el `counterpartyRut`.
- **Dos personas con el mismo nombre**: Pedro Barrera NIETO (5890859-2) y PUENTES (11127176-3). Ojo con otros maestros homónimos en 2025.
- **Reembolsadores**: la app modela alias (Cristóbal/Elias → Paula Johanna/Sodimac). Una "Transf a Cristóbal" puede pagar una factura Sodimac. Hay 12 reembolsadores.
- **Splits**: un movimiento puede pagar varias facturas (ej. una compra Sodimac de $468k paga 2 facturas). `InvoicePayment` es N:N.
- **Parser Maxxa**: los `.xls` son HTML; se leen con `cheerio` (ver `scripts/conciliar-seccion1-maxxa.ts` que ya tiene el parser embebido). La cartola `.xlsx` trae la conciliación en la columna `Asignacion` (JSON con Folio/Rut/TipoDoc/Abono/FchPago).

---

## 5. Qué pedirle a MJ ANTES de arrancar (datos 2025)

- **Export Maxxa recibidas 2025** (mismo formato que `exportar.xls`, filtrado a `AgnoTrib=2025`).
- **Export Maxxa emitidas 2025** (como `exportar (1).xls`).
- **Cartola(s) de Maxxa de todo 2025** (`MovimientosCartola_*.xlsx`). OJO: Maxxa solo tiene la cuenta **Operativa** (8913459-5), no Sueldos.
- Dejar los archivos en `~/Downloads` (NO en el repo — **`data/imports/` no está gitignored**; verificar antes de mover nada).
- **Aviso de datos de la app para 2025**: la cartola de la app tiene un **hueco en noviembre-2025** (0 movs) y **737 movimientos 2025 sin `balanceAfter`** (no reimportar cartolas 2025 a la app sin cuidado — riesgo de duplicado, ver WIP ronda 28).

---

## 6. Scripts reusables (adaptar el año/archivos)

- `scripts/audit-dump.ts` — dump read-only de prod (cubre TODOS los años). Correr: `DATABASE_URL="$(grep -m1 '^DATABASE_URL=' .env.prod | cut -d= -f2- | tr -d '"')" npx tsx scripts/audit-dump.ts`. Escribe a `backups/` (gitignored).
- `scripts/conciliar-seccion1-maxxa.ts` — re-enlaza recibidas vía cartola Maxxa (autocontenido, parser embebido). **Está hardcodeado a 2026 + los archivos de 2026** → adaptar año y rutas de cartola para 2025.
- `scripts/relink-pagadas-2026.ts` — re-enlaza pagadas-sin-enlace con cobertura 100% (no degrada pagadas). **Adaptar a 2025** (filtro de año + cartolas).
- `scripts/registrar-quincho-pedros.ts` — plantilla de "Pago sin factura" (crea Invoice sin_respaldo + concilia). Réplica exacta de `src/app/api/banco/movimientos/bulk/route.ts`. Útil si hay maestros 2025 sin registrar.

**Nota técnica importante**: las transacciones interactivas de Prisma (`prisma.$transaction(async (tx) => ...)`) **fallan sobre el pooler de Neon** ("Transaction not found"). Hacer las escrituras **secuenciales** (cada create/update suelto) con guarda de idempotencia + chequeo de huérfanos. Ver cómo lo hace `registrar-quincho-pedros.ts`.

---

## 7. Reglas de oro (de CLAUDE.md y de esta auditoría)

- **Read-only por default.** Todo cross-check es solo lectura.
- **Toda escritura a prod**: backup previo (`audit-dump.ts`) + **dry-run** + **OK explícito de MJ** + verificación post (snapshot de los totales afectados).
- **Conciliación conservadora**: ante duda, dejar pendiente. "Prefiero trabajo manual a trabajo mal hecho" (MJ).
- **No asumir que un lado es la verdad** — mostrar ambos lados y que MJ decida caso por caso.
- **metrics.ts** (cálculo contable): no tocar sin snapshot pre/post (§4.1).
- **No commitear** nada de Maxxa (los `.xls`/`.xlsx`) ni backups.

---

## 8. Decisiones de negocio ya tomadas (no re-preguntar)

- Criterio "2025" = período tributario, reportando el borde de fin-2024.
- Proyectos fantasma de Pedro Barrera (Waterloo/Duplex/Holanda/Las Nieves) → **dejados afuera** (no existen en la app, MJ no los sigue).
- Las facturas falsas (sin_respaldo) son cómo entra el costo de maestros que no facturan. Modelo ideal: 1 transferencia = 1 factura falsa, asignada al proyecto correcto.
