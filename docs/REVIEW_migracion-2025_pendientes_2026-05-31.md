# REVIEW — Migración 2025: qué quedó para revisar

Cierre de la migración de 2025 (Maxxa + SII → app, ronda 37). Acá está, con detalle, lo que **quedó pendiente de revisar con MJ**. Lo demás se aplicó y verificó (ver WIP ronda 37).

**Lo que SÍ quedó hecho** (resumen): movimientos 2025 completos (Operativa 12 meses + Sueldos Nov–Dic), facturas del SII (1.075 compras + 75 ventas), 10 proyectos nuevos, 902 facturas con metadata, 582 conciliaciones ($345M, 0 sobre-imputadas).

---

## 1. Movimientos que la app perdió (7) — ✅ RESUELTO (2026-05-31)

Al rellenar el saldo corrido, la cartola del Santander tenía **2 movimientos** del mismo monto el mismo día y la app solo **1**. La app perdió uno de cada par (bug viejo de "mismo monto, mismo día"). **Era plata real fuera del registro — ya se recuperó** (`scripts/agregar-movs-perdidos.ts`).

**Hallazgo**: 5 de los 7 eran **retiros de MJ** ("Transf a BLANCO ROGAT", RUT 18023983-9): cada vez había un retiro a JT y otro a MJ del mismo monto el mismo día, y la app guardaba el de JT y perdía el de MJ.

| Fecha | Monto | Lo que faltaba | Qué es |
|---|--:|---|---|
| 02-abr-25 | $1.000.000 | Transf a BLANCO ROGAT | retiro MJ |
| 02-may-25 | $1.000.000 | Transf a BLANCO ROGAT | retiro MJ |
| 01-jul-25 | $2.000.000 | Transf a BLANCO ROGAT | retiro MJ |
| 01-sep-25 | $2.000.000 | Transf a BLANCO ROGAT | retiro MJ |
| 06-oct-25 | $2.000.000 | Transf a BLANCO ROGAT | retiro MJ |
| 24-mar-25 | $600.000 | 2º a Victorino Soto | pago maestro |
| 09-jun-25 | $1 | 2º Shinkansen | ajuste |

**Total recuperado: $8.600.001.** Los 7 quedaron cargados con su saldo corrido y RUT; los 7 que ya estaban recibieron su saldo corrido. Verificado: los 7 pares tienen ahora 2 movimientos. Quedaron `sin_asignar` (los retiros no son costo de proyecto — MJ los categoriza si quiere).

---

## 2. Facturas de Maxxa que NO están en la app (193) — decidir si se traen

Son registros que Maxxa tiene pero el SII no (porque no son documentos tributarios electrónicos). Desglose por tipo:

| Tipo | Cuántas | Qué son | ¿Traer? |
|---|--:|---|---|
| 1043 sin respaldo | 110 | **Pagos a maestros sin factura** (como Pedro Barrera) | **Sí, vale la pena** — es costo de obra real |
| 1054 traspaso | 24 | Transferencias entre cuentas (Operativa↔Sueldos) | No (no es costo) |
| 1040 / 1042 | 28 | Movimientos internos Maxxa | Revisar |
| 1051 impuestos | 11 | Pagos a Tesorería (SII) | Interno BLARQ |
| 1039 BHE | 7 | Boletas de honorarios (Juan Pablo, etc.) | Quizás (es gasto) |
| 35 / 48 / 1053 / 1059 | 13 | Boletas, préstamos, varios | Revisar |

> **CORRECCIÓN (verificada folio por folio en `2025_Maxxa/exportar (2).xls`)**: los números de abajo de la versión original estaban MAL (eran de un script rápido sin verificar). Lo correcto:
> - Son **99 registros tipoDoc 1043** (no 110), por **$20.161.281** en total.
> - Los ejemplos viejos NO existían: "F-166" no existe (solo F-167 Patricia $4M, Duplex), "F-268 Williamson" es en realidad un tipoDoc 33 (Mármoles, no un 1043), "F-307 JT" no existe (el folio 1043 más alto es F-304).
> - **Fiarse del export, no de los montos citados acá originalmente.**

**Lo accionable**: de los 99, el subconjunto de mano de obra de maestros por obra (excluyendo internos de BLARQ) es **~73 registros, ~$16,76M**, repartido así:

| Centro de costo Maxxa | Regs | Monto | Nota |
|---|--:|--:|---|
| 41 Duplex Escriba de Balaguer | 30 | $8.129.455 | proyecto existe |
| 48 Casa Waterloo | 16 | $3.736.580 | proyecto existe |
| 45 Dpto Holanda 940 | 9 | $1.501.400 | proyecto existe |
| 46 Ampliación Casa Arrau | 8 | $1.140.000 | **CUIDADO: Pedro Barrera ya cargado (ronda 37) — cruzar y no duplicar** |
| 43 Eduardo Montes | 6 | $924.850 | proyecto existe |
| 49 Cocina Escobar Blanco | 3 | $873.000 | proyecto existe |
| 34 Terraza Andrea Salas | 1 | $450.000 | proyecto NO existe en la app |

**Internos a dejar AFUERA** (~26 regs): 00_BLARQ (Uber/Google/Tesorería/retiros), 00_CASA, sin centro de costo — no son costo de obra.

**Dos riesgos antes de crear nada** (cruzar contra prod read-only primero): (1) **doble conteo** — varios folios de Arrau/Quincho ya se cargaron en ronda 37; saltarlos. (2) **huérfanos** — verificar que cada 1043 tenga su transferencia real en el banco antes de crear+conciliar (crear "pagada" sin movimiento reproduce el bug).

---

## 3. Facturas recibidas 2025 que quedaron sin conciliar (515)

De las compras 2025, **515 siguen `pendiente`** (sin movimiento del banco enganchado). Por mes:

| Mes | Pendientes | Nota |
|---|--:|---|
| Ene 2025 | 70 | **la cartola de Maxxa no cubre ene/feb** |
| Feb 2025 | 85 | idem |
| Mar–Jun 2025 | ~250 | Maxxa no las concilió, o son compras con tarjeta sin RUT |
| Jul–Dic 2025 | ~110 | idem |

- **Ene + Feb (155 facturas, $52,7M)**: quedaron sin conciliar porque la cartola de conciliación de Maxxa **arranca en marzo**. No es error — falta la fuente. Si querés conciliarlas, necesito la conciliación de Maxxa de ene/feb (o se hace a mano).
- **El resto (Mar–Dic)**: son facturas que en Maxxa también estaban pendientes, o compras con tarjeta sin RUT que no se pudieron desambiguar con seguridad (preferí dejarlas pendientes a conciliarlas mal — el criterio conservador de siempre).

**Importante**: que estén `pendiente` NO afecta el costo del proyecto (el gasto sale de la factura, esté conciliada o no). Es trazabilidad.

---

## 4. Otros puntos sueltos

- **Sherwin F-2917084, $36.112 (17-dic-2025)**: está en la app (de Maxxa) pero **no aparece en tu Registro de Compras del SII**. Probable folio mal tipeado o boleta. Chico, revisar a mano.
- **Proyecto n°34 Terraza Andrea Salas**: tiene 1 sola factura en Maxxa que no matcheó ninguna del SII → **no se creó el proyecto**. Si esa obra existió, hay que ver qué pasó con esa factura.
- **3 facturas Paula Johanna $59.500** (folios 1694/1695/1696): parecen facturas distintas con folios consecutivos (no duplicados), pero conviene un vistazo.

---

## 5. Cómo seguir

Por orden de valor:
1. **Los 7 movimientos perdidos** (#1) — es plata real sin registrar, lo más importante.
2. **Las 110 "sin respaldo"** (#2) — costo de mano de obra de maestros que falta en sus proyectos.
3. **Conciliar ene/feb 2025** (#3) — si conseguís la conciliación Maxxa de esos meses.
4. El resto (Sherwin, proyecto 34, Paula) — menor, cuando haya tiempo.

Todo lo aplicado es reversible (backups en `backups/audit-...2026-05-31T*.json`). Los scripts de la migración quedan en `scripts/` (import-cartolas-huecos-2025, import-maxxa-metadata-2025, conciliar-maxxa-2025).
