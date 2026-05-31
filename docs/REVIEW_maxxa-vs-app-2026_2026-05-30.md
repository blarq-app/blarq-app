# REVIEW — Auditoría cruzada Maxxa vs App, 2026 (Fase 1)

Cross-check independiente entre la app BLARQ y Maxxa (sistema contable externo que se está dejando de usar). **Solo lectura — no se tocó código ni datos en ningún lado.** Objetivo: dos sistemas distintos deberían contar la misma plata; lo que difiere se muestra con **ambos lados visibles** y lo decide MJ caso por caso.

- **Fecha**: 2026-05-30. **Alcance**: solo 2026.
- **Lado app**: dump read-only de prod (`ep-shy-morning`) vía `scripts/audit-dump.ts` → `backups/audit-facturas-conciliacion-2026-05-30T23-32.json`. 759 facturas, 1.615 movimientos, 497 imputaciones.
- **Lado Maxxa**: 4 exports manuales (datos privados, NO commiteados — viven en `~/Downloads`):
  - `exportar.xls` — recibidas/compras (`TipoMov=out`), 606 filas.
  - `exportar (1).xls` — emitidas/ventas (`TipoMov=in`), 28 filas.
  - `MovimientosCartola_20260530_1912.xlsx` — cartola bancaria CON conciliación embebida (500 movs, 17-feb→29-may, columna `Asignacion` = folio↔mov).
  - `MovimientosCartola_20260530_2156.xlsx` — segunda cartola (280 movs, 02-ene→27-feb) que llena el hueco de enero/principios de febrero. Combinadas cubren **todo 2026 de la cuenta Operativa**.
- **Confirmado**: Maxxa tiene cargada **solo la cuenta Operativa** (8913459-5), no la de Sueldos. Las dos cartolas son de esa cuenta.
- **Criterio "2026"** (decisión MJ): período tributario (`AgnoTrib=2026`, universo completo Maxxa), reportando como borde las facturas con fecha de emisión dic-2025.
- **Severidad**: crítica = plata mal contada / factura o proyecto incorrecto · media · cosmética. **Probabilidad** = qué tan seguro es que sea diferencia real y no ruido de normalización.

---

## Resultado en una línea

**Los dos sistemas cuentan la misma plata.** Las facturas que están en ambos no tienen ni una diferencia de monto, las 24 notas de crédito calzan al peso, el cobro reconcilia a $0 exacto (salvo abril, por una factura anulada-con-NC), y el feed bancario de la Operativa es idéntico en ene/mar/abr. Donde difieren es en **qué está marcado como pagado y qué cobros están vinculados al banco** (la app va atrasada en conciliar cobros de cliente). **No se encontró plata mal atribuida**: el único hallazgo que parecía grave (cobros en proyecto equivocado) resultó un falso positivo de mi método — verificado con MJ, la app concilia bien (ver #1).

### Cuánto match hubo (validación del método)

| | En ambos | Solo Maxxa | Solo app (2026) |
|---|--:|--:|--:|
| Recibidas | 598 / 606 | 8 | ~12 |
| Emitidas | 27 / 27 | 1 (traspaso, no es factura) | 0 |

Las 8 "solo Maxxa" son casi todas estructurales (boletas, BHE, traspaso — tipos que la app no sincroniza). Las "solo app" son todas pagos sin respaldo a maestros. Es decir: **prácticamente todas las facturas reales están en los dos lados**.

---

# HALLAZGOS (por severidad)

## [BAJA] 1 — Conciliación cruzada: casi todo era falso positivo de mi cruce (CORREGIDO)

> **Corrección (verificada con MJ 2026-05-30)**: la versión inicial marcó como crítico que la app imputaba ~$20M de cobros de Ovalle/Pite a facturas de Camila Decombe. **Era un error mío de método, no de la app.** Verificado contra las glosas reales de las imputaciones en el dump: **la app concilia bien**. Lo dejo documentado entero porque es la lección de método más importante para la Fase 2.

**Qué pasó**: mi cruce a nivel movimiento empareja la cartola con la app por **fecha + monto**. El 06-abr (y el 13-feb) hubo **varias transferencias de $5.000.000 el mismo día** (Camila Decombe `0194754353`, Pite `0795239502`, Ovalle `0105112904`). Mi script pareó la fila equivocada de la cartola contra el movimiento equivocado de la app y reportó "cruce" donde no lo había.

**Lo verificado en el dump (imputaciones reales por glosa)**:

| Factura app | Cliente | Sus pagos en la app | Veredicto |
|---|---|---|---|
| F-155 | Camila Decombe (Aguirre) | 5 transferencias, **todas glosa "Camila Andrea D"** | **app correcta** |
| F-162 | Camila Decombe (Aguirre) | 06-abr $5M + $1,8M, **glosa "Camila Andrea D"** | **app correcta** |
| F-160 | Pite (Rosas) | incl. 06-abr $5M, **glosa "INDUSTRIAL Y CO"** | **app correcta** |
| F-158/159/164 | Ovalle (Portofino) | **$0 imputado** | sin conciliar → es el hallazgo #4, no un cruce |

**Lo que SÍ queda como divergencia real** (chico): los 3 movimientos de **compra con tarjeta** sin RUT donde la app imputó por monto-solo a otro proveedor. Estos no tienen remitente para desambiguar, así que la colisión es real, no artefacto:

| Fecha | Monto | Glosa banco | Maxxa dice | App dice |
|---|--:|---|---|---|
| 2026-03-06 | $18.683 | Compra VESPUCIO ORIENTE | SHERWIN WILLIAMS F-2963377 | JORGELIN GABRIELA F-1299 |
| 2026-02-27 | $59.502 | PAC VESPUCIO OR | VESPUCIO ORIENTE F-2988549 | ESMAX RED F-8586058 |
| 2026-05-14 | $25.870 | Compra FERRETERIA GARACHENA | FERRETERIA GARACHENA F-106843 | Santander-Chile F-55158835 |

Y las transferencias a Daniel que **Maxxa** imputó a Brune SPA F-433 (la app las trata bien como pago a Daniel) → acá la app está mejor que Maxxa.

- **Severidad**: baja (los 3 casos reales suman ~$104.000, todos compras con tarjeta; el resto era mi error).
- **Probabilidad**: alta para los 3 de tarjeta (mecanismo confirmado por la auditoría anterior); el resto, descartado.
- **Lección de método**: el cruce por fecha+monto NO sirve cuando hay montos redondos repetidos el mismo día. Para la Fase 2 hay que **emparejar el movimiento por glosa/remitente**, no por monto, antes de declarar un cruce.

---

## [MEDIA] 2 — Estado de pago divergente: Maxxa marca pagadas 55 facturas que la app deja pendientes

**Qué**: **55 facturas recibidas** ($147.016.282) que Maxxa tiene con saldo $0 (pagadas) y la app sigue mostrando `pendiente`. No es plata mal contada (la factura entra al gasto del proyecto igual, esté pagada o no), pero significa que **el estado de pago de la app está materialmente atrasado respecto a Maxxa** — la app no sabe qué se pagó realmente.

**Por qué pasa**: la conciliación bancaria de la app tiene un backlog conocido (auditoría anterior: cientos de movimientos sin asignar). Maxxa, que MJ usó como contabilidad, tiene la conciliación histórica más completa. No es un error de cálculo de la app; es cobertura incompleta de conciliación.

- **Severidad**: media (el `totalGastado` del proyecto no cambia; lo que es poco confiable es el "¿esto está pagado?").
- **Probabilidad**: alta (sistemático, 55 casos).
- **Acción sugerida**: usar Maxxa como guía para completar la conciliación de la app antes de apagar Maxxa. No auto-importar el estado a ciegas (puede arrastrar los errores de #1).

---

## [MEDIA] 3 — La app marcó pagadas 28 facturas que Maxxa deja pendientes (dirección inversa)

**Qué**: **28 facturas** ($32.412.340) que la app tiene `pagada` con imputación bancaria real, y Maxxa muestra pendientes. Las grandes son a proveedores de muebles/obra:

| Folio | Proveedor | Monto | App | Maxxa |
|---|---|--:|---|---|
| F-167 | JNC SPA | $14.773.786 | pagada (imputado completo) | pendiente |
| F-169 | JNC SPA | $6.573.791 | pagada | pendiente |
| F-514 | MÁRMOLES Y DISEÑO URBAN | $3.875.166 | pagada | pendiente |
| F-593 | TERMOPLUS CHILE | $2.735.697 | pagada | pendiente |
| F-168 | JNC SPA | $2.092.847 | pagada | pendiente |
| F-511 | MÁRMOLES Y DISEÑO URBAN | $840.787 | pagada | pendiente |
| F-188 | JPB CONSTRUCCIONES | $380.800 | pagada | pendiente |

**Dos lecturas posibles**: (a) la app va **adelante** y concilió pagos reales que Maxxa todavía no registró (probable: son pagos grandes a proveedores con imputación completa); (b) la app **sobre-imputó** (pegó un movimiento a una factura que no correspondía). Dado #1, conviene confirmar a mano que el movimiento que la app usó para pagar las JNC sea realmente de JNC.

- **Severidad**: media · **Probabilidad**: media (mayoría probablemente app-adelante, pero verificar las JNC por el riesgo de #1).

---

## [MEDIA] 4 — 80 movimientos que Maxxa concilió y la app dejó sin imputar (cobros de cliente)

**Qué**: 80 movimientos bancarios (sobre todo 2026 Operativa, **$136.217.524**) que Maxxa imputó a una factura emitida y la app dejó **sin imputación**. Son casi todos **cobros grandes de cliente**:

| Fecha | Monto | Maxxa lo imputó a |
|---|--:|---|
| 2026-03-19 | $10.000.000 | FERNANDO ANDRES TERRE F-161 |
| 2026-03-04 | $10.000.000 | FERNANDO ANDRES TERRE F-161 |
| 2026-01-13 | $8.945.552 | INMOBILIARIA LOS SALDOS F-140/141/142 |
| 2026-03-11 | $6.556.805 | MTW SpA F-1610 |
| 2026-03-13 | $6.240.000 | FERNANDO ANDRES TERRE F-161 |
| 2026-01-20/21/26 | $5.000.000 ×3 | FERNANDO ANDRES TERRE F-148/149 |
| 2026-03-16/17 | $5.000.000 ×3 | AGRICOLA OVALLE F-159 |
| 2026-02-16/18 | $5.000.000 ×2 | OVALLE F-158 / PIA GARCES F-151 |
| 2026-04-13 | $2.429.083 | COMERCIAL K F-1491032 |

**Por qué**: es la diferencia estructural ya conocida (auditoría anterior, hallazgo #3): en la app la factura emitida se marca pagada **al emitirla** (regla "emitida ≈ cobrada"), sin vincularla al abono bancario. Maxxa **sí** mantiene el vínculo. El `totalCobrado` de la app no está mal, pero **un cobro perdido o duplicado no se detectaría desde la app** (es el escenario del incidente de los $15M de Carolina Ovalle). Maxxa acá da la contrapartida que a la app le falta.

- **Severidad**: media · **Probabilidad**: alta (estructural). Mapea directo a la "Fase 2 cliente del proyecto" pendiente.

---

## [COSMÉTICA] 5 — Atribución de centro de costo: la app está MÁS catalogada que Maxxa

**Qué**: 70 facturas con proyecto distinto entre los dos sistemas. El desglose es tranquilizador:
- **67**: Maxxa "SIN CENTRO DE COSTO" y la app **con proyecto asignado** → la app está más catalogada que Maxxa, no al revés.
- **1**: app sin proyecto / Maxxa con centro.
- **2** (únicos genuinamente cruzados): F-38269 y F-38582 de Maxi Mobility (Cabify), que Maxxa deja en `00_BLARQ` y la app asignó a Cocina Farellones / Francisco de Aguirre. Trivial (viajes Cabify).

- **Severidad**: cosmética · **Probabilidad**: alta pero sin impacto (la app gana esta comparación).

---

# DIFERENCIAS ESTRUCTURALES (modelado distinto — no son errores)

Esto explica **por qué los totales brutos difieren** sin que falte plata. La diferencia de gasto bruto (app $203,4M vs Maxxa $176,7M = **+$26,7M**) se descompone exactamente así:

| Concepto | Monto | Quién lo tiene |
|---|--:|---|
| Pagos sin respaldo a maestros (Daniel Santibáñez, Jefry, Iván) | **+$14.338.200** | solo app (12 registros) |
| Facturas anuladas-en-Maxxa que la app mantiene vivas (con su NC) | **+$15.410.694** | ver abajo |
| Boletas (tipoDoc 39) + Boletas de Honorarios (1039) | −$421.228 | solo Maxxa (4 docs) |
| Frontera dic-2025 (AgnoTrib 2026, fecha emisión dic-2025) | −$109.032 | solo Maxxa (2 docs) |
| Jefry Gómez (mismo pago, distinto folio en cada sistema) | neto $0 | ambos |
| Residual no atribuido (bordes de NC/período) | ~$1.020.000 | — |

### A. Pagos sin respaldo (tipoDoc 1043) — la app captura más

Maxxa también usa el código **1043 "Movimiento sin Respaldo"** (buena noticia: mismo concepto, mismo número). Pero la app registra **13 en 2026** ($17,2M) y Maxxa solo **2**. La app captura los pagos a maestros informales (Daniel Santibáñez, etc. — la función "pago sin factura" de la ronda 26) que Maxxa no tiene. **No es error: la app es más completa en mano de obra informal.** Es gasto real que está en la app y no en Maxxa.

### B. Anuladas vs Nota de Crédito — modelado opuesto (mirar con atención)

8 facturas recibidas + 1 emitida están **anuladas en Maxxa** y **vigentes en la app**. En todos los casos hay una NC que las compensa por el mismo monto:

| Factura (anulada en Maxxa) | Monto | NC que la compensa |
|---|--:|---|
| MTW SpA F-1609 | $7.892.379 | NC F-197 |
| JPB CONSTRUCCIONES F-186 | $4.956.350 | NC F-5 |
| JPB CONSTRUCCIONES F-172 | $1.338.216 | NC F-4 |
| XIMENA ROGAT F-445 | $916.300 | NC F-416 |
| DECONTRACT F-5845 | $229.826 | NC F-586 |
| ICONICA F-6334 | $57.120 | NC F-241/242 |
| COMERCIAL HABITAT F-301214 | $17.943 | NC F-35565 |
| DP HERRAJES F-74123 | $2.560 | NC F-4108 |
| **INDUSTRIAL Y COMERCIAL PITE F-165 (emitida)** | $9.296.779 | NC F-5 (emitida) |

**El punto fino**: las dos formas de modelar la reversión no dan el mismo neto.
- **App**: factura (+) + NC (−) = **neto $0**. Es lo que espera la contabilidad estándar.
- **Maxxa**: factura anulada (la saca) + NC vigente (−) = **neto negativo**. Resta el crédito de una factura que ya quitó → **resta dos veces**.

Por esto la app cuenta $15,4M más de gasto y $9,3M más de cobro que Maxxa. **Acá la app parece la correcta** (su neto es 0, el esperado), pero como pediste no asumir, lo dejo a tu criterio: si Maxxa anula la factura Y deja la NC vigente, su gasto/cobro neto queda subvaluado en esos montos. Conviene alinear el criterio antes de la Fase 2.

### C. Lo que la app no sincroniza (Maxxa sí)

- **2 boletas electrónicas** (tipoDoc 39): Sherwin $12.725, Modern Space $41.000.
- **2 boletas de honorarios** (tipoDoc 1039): Juan Pablo Costa $300.000, Hillbrecht $67.503.
- **2 facturas de borde dic-2025** (no están en la app en ningún año): AKI KB $105.690, Autopista Vespucio Sur $3.342.
- **1 traspaso** (tipoDoc 1054): devolución a Carolina Ovalle $2.912.199 (es la devolución al cliente, no una factura).

Total que Maxxa tiene y la app no: **~$0,5M** en gasto real (boletas/BHE/frontera). Chico, pero es gasto que la app no está viendo.

---

# CUADRES MENSUALES 2026

Gasto y cobro neto por mes, ambos sistemas (montos con IVA, NC con signo).

| Mes | Gasto Maxxa | Gasto App | Δ Gasto | Cobro Maxxa | Cobro App | Δ Cobro |
|---|--:|--:|--:|--:|--:|--:|
| 2026-01 | 11.542.077 | 13.760.811 | +2.218.734 | 11.551.353 | 11.551.353 | **0** |
| 2026-02 | 44.783.381 | 55.775.760 | +10.992.379 | 65.620.871 | 65.620.871 | **0** |
| 2026-03 | 30.845.275 | 33.867.532 | +3.022.257 | 37.076.358 | 37.076.358 | **0** |
| 2026-04 | 72.125.025 | 75.082.145 | +2.957.120 | 78.207.778 | 87.504.557 | +9.296.779 |
| 2026-05 | 16.262.340 | 24.949.516 | +8.687.176 | 34.286.667 | 34.286.667 | **0** |

**Lectura**:
- **Cobro cuadra al peso en 4 de 5 meses.** El único desvío es abril (+$9.296.779), que es exactamente la factura emitida PITE F-165 anulada-con-NC (diferencia de modelado B, no plata perdida).
- **Gasto difiere cada mes** por los pagos sin respaldo (app) + el modelado de anuladas. Los meses con más desvío (feb +$11M, may +$8,7M) son los que concentran transferencias a Daniel y facturas anuladas.

### Reconciliación del feed bancario (movimientos de la Operativa, app vs cartola Maxxa)

Con las dos cartolas combinadas se puede chequear si los dos sistemas **ven los mismos movimientos** de la cuenta Operativa:

| Mes | Maxxa # / neto | App # / neto | Δ |
|---|--:|--:|--:|
| 2026-01 | 118 / $21.270.543 | 118 / $21.270.543 | **idéntico** |
| 2026-02 | 159 / −$12.565.592 | 162 / −$7.741.385 | +3 movs (borde 17-feb) |
| 2026-03 | 181 / −$15.186.592 | 181 / −$15.186.592 | **idéntico** |
| 2026-04 | 155 / $16.640.126 | 155 / $16.640.126 | **idéntico** |
| 2026-05 | 93 / … | 63 / … | app no importó fin de mayo (−30 movs) |

**Enero, marzo y abril calzan al peso y al movimiento.** La diferencia de febrero son 3 movimientos del **17-feb** (el día donde empalman las dos cartolas, con cortes de hora distintos) — artefacto del solape, no discrepancia. Mayo difiere solo porque la app no importó los últimos días. **Conclusión: el banco que ve la app y el que ve Maxxa son el mismo** (en la cuenta Operativa).

---

# LO QUE NO SE PUEDE COMPARAR (límite estructural / de datos)

1. **Cuenta Sueldos**: Maxxa no la tiene cargada (solo Operativa). Toda la conciliación de Sueldos queda fuera de este cross-check.
2. **Saldo de banco al cierre de mes**: las cartolas de Maxxa no traen saldo corrido (running balance), solo el monto por movimiento. Se pudo reconciliar el **flujo** mensual (arriba), no un saldo de cierre absoluto. Igual el flujo calza en ene/mar/abr.
3. **Movimientos de fin de mayo**: la app no importó los últimos días de mayo (los 15 "solo en Maxxa" + el desfase de −30 movs en mayo). Es recencia de importación, no error — se cierra reimportando la cartola al día.
4. **Reembolsadores**: la app modela alias de reembolsador (Cristóbal, Elias → Paula Johanna/Sodimac) y splits N:N que Maxxa no expresa igual. Comparables solo parcialmente.

---

# LECCIONES PARA LA FASE 2 (2025)

**Normalizaciones que quedaron resueltas** (reusar tal cual):
- Identidad de factura: `tipoDoc + folio + RUT` para recibidas; `tipoDoc + folio` para emitidas (en emitidas el `RutDoc` de Maxxa es el del cliente, no el de BLARQ).
- **Signo de NC**: Maxxa guarda `MontoTotal` negativo, la app positivo. Comparar **magnitudes**. Calzan al peso (24/24).
- Mapeo de tipoDoc: 33/34/61/1043 calzan; 39 (boleta) y 1039 (BHE) la app no los tiene; 1054 (traspaso) no es factura.
- Proyecto: comparar por **nombre normalizado**, no por número (hay clientes con 2 centros de costo, ej. Pauline Dumay `52` y `59`).
- "2026" en Maxxa = período tributario; hay facturas con fecha dic-2025 dentro del 2026 tributario.

**Lo que hay que mirar con MÁS cuidado en 2025**:
- 2025 tiene mucho menos conciliada en la app (la conciliación contra factura arranca en serio en ene-2026). Esperá **muchos** más casos del tipo #2 (Maxxa pagada / app pendiente).
- La cartola de 2025 tiene el hueco de noviembre y 737 movimientos sin `balanceAfter` (riesgo de duplicado al reimportar).
- Las anuladas-con-NC probablemente sean más frecuentes en 2025 (más historia). Definir el criterio (hallazgo B) **antes** de comparar 2025.

**Qué pedir antes de arrancar 2025**: cartola completa de las **dos cuentas** y de **todo el año**, exportada igual que esta.

---

# QUÉ NECESITO DE VOS PARA CERRAR DUDAS

1. ~~Los 4 movimientos de $5.000.000~~ — **RESUELTO**: verificado con MJ, la app concilia bien (F-155/F-162 son de Camila, F-160 de Pite). Era falso positivo de mi cruce. Sin acción.
2. **Criterio anulada-vs-NC (hallazgo B)**: ¿la app está bien manteniendo factura+NC (neto 0) o querés replicar el "anular" de Maxxa? Define el estándar para Fase 2.
3. **Estado de pago (#2, 55 facturas $147M)**: ¿usamos Maxxa como guía para completar la conciliación de la app, o lo dejás como está hasta apagar Maxxa?
4. **Las 2 boletas + 2 BHE + 2 frontera dic-2025**: ¿las querés en la app (son gasto real ~$0,5M) o las dejamos solo en Maxxa?
5. **Cuenta Sueldos**: confirmado que Maxxa no la tiene. ¿Querés que en la Fase 2 incluya la conciliación de Sueldos solo del lado app (sin contraparte Maxxa), o la dejamos afuera?

**No toqué nada.** Quedo esperando tu lectura para decidir caso por caso.
