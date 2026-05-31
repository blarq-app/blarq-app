# REVIEW — Migración 2025: qué quedó para revisar

Cierre de la migración de 2025 (Maxxa + SII → app, ronda 37). Acá está, con detalle, lo que **quedó pendiente de revisar con MJ**. Lo demás se aplicó y verificó (ver WIP ronda 37).

**Lo que SÍ quedó hecho** (resumen): movimientos 2025 completos (Operativa 12 meses + Sueldos Nov–Dic), facturas del SII (1.075 compras + 75 ventas), 10 proyectos nuevos, 902 facturas con metadata, 582 conciliaciones ($345M, 0 sobre-imputadas).

---

## 1. Movimientos que la app perdió (7) — ALTA prioridad

Al rellenar el saldo corrido, la cartola del Santander tiene **2 movimientos** del mismo monto el mismo día, pero la app solo tiene **1**. La app perdió uno de cada par (el bug viejo de "mismo monto, mismo día"). Hay que agregarlos a mano (o reconciliar) — **es plata que salió del banco y no está registrada**.

| Fecha | Monto | Falta en la app |
|---|--:|---|
| 2025-03-24 | −$600.000 | 1 de 2 |
| 2025-04-02 | −$1.000.000 | 1 de 2 |
| 2025-05-02 | −$1.000.000 | 1 de 2 |
| 2025-06-09 | $1 | 1 de 2 (probable reverso/ajuste) |
| 2025-07-01 | −$2.000.000 | 1 de 2 |
| 2025-09-01 | −$2.000.000 | 1 de 2 |
| 2025-10-06 | −$2.000.000 | 1 de 2 |

Total faltante: ~$6,6M. Para agregarlos: identificar a quién fue cada uno (la cartola Santander tiene los dos, con su glosa) y cargarlos. Lo podemos hacer juntos con `reconcile-cartolas.ts`.

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

**Lo accionable**: las **110 "sin respaldo"** son pagos a maestros (mano de obra) que hoy NO están como costo en sus proyectos. Es el mismo caso que resolvimos con Pedro Barrera/Quincho. Se traen con "Pago sin factura", proyecto por proyecto. Los más grandes:

| Folio | Quién | Monto | Proyecto (Maxxa) |
|---|---|--:|---|
| F-167/166 | Patricia Ximena (×2) | $4.000.000 c/u | Duplex Escriba de Balaguer |
| F-268 | Ricardo Williamson | $3.228.729 | Dpto Williamson |
| F-307 | José Tomás Larraín | $2.010.000 | Ana Maria Didyk |

(Los traspasos, impuestos y préstamos son internos de BLARQ, no costo de proyecto — esos los dejaría afuera.)

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
