# REVIEW — Facturas y Conciliación Bancaria (2026-05-29)

Auditoría focalizada en facturas, banco y conciliación. **Solo lectura — no se tocó código ni datos.** Los hallazgos están para discutir, no se arregló nada.

- **Método**: estático (lectura del código real de `metrics.ts`, `banco/`, `sii/`, rutas de API) + dinámico (dump read-only de **prod** `ep-shy-morning` a JSON local vía `scripts/audit-dump.ts`, análisis offline con `scripts/audit-analyze.ts`).
- **Universo**: 749 facturas, 1.615 movimientos bancarios, 501 imputaciones, 19 proyectos, 4 reembolsadores. Datos al 2026-05-30.
- **Convención de severidad**: crítica = plata mal / factura o proyecto incorrecto / gasto doble o no contado · media · cosmética. Ordenado por severidad y, dentro, por probabilidad.

> **Acción de seguridad (no de la app)**: al correr el dump, el script imprimió en consola un fragmento del `DATABASE_URL` que **incluyó la contraseña de la BD de prod** — quedó en el registro de la sesión. Ya corregí el script para que no vuelva a pasar. **Recomendado: rotar la contraseña en Neon → Reset password.**

---

## Conteos base (panorama)

| | |
|---|---|
| Facturas | 749 (emitidas 34, recibidas 715) |
| Por tipoDoc | 33: 663 · 34 (exenta): 32 · 61 (NC): 33 · 1043 (sin respaldo): 21 |
| Por origin | sii_automatica 614 · maxxa_legacy 113 · maxxa_sin_respaldo 10 · sin_respaldo 11 · manual 1 |
| Movimientos | 1.615 — conciliado 495 · sin_factura 512 · sin_asignar 558 · interno 48 · parcial 2 |
| Imputaciones | 501 |
| Cobrado (emitidas c/IVA, NC resta) | $291.626.826 |
| Gastado (recibidas neto, NC resta, incl. sin respaldo) | $204.482.256 |

---

# HALLAZGOS

## 🔴 CRÍTICA #1 — El auto-match de compras con tarjeta ignora el proveedor: matchea por monto solo

**Qué**: cuando un movimiento NO trae RUT de contraparte (todas las "Compra X" con tarjeta — el parser solo extrae RUT de transferencias, no de compras), el auto-match al importar cartola busca facturas pendientes del mismo monto y, si hay varias candidatas, **toma la primera** sin poder desambiguar por proveedor (`import/route.ts:252-263`: `let match = candidates[0]` y el bloque de desambiguación por RUT solo entra `if (... && mov.counterpartyRut)`). Resultado: una compra puede quedar conciliada contra la factura de **otro proveedor / otro proyecto** que casualmente tiene el mismo monto.

**Ejemplo real de la base**:
- Mov `2026-03-06 Compra VESPUCIO ORIENTE $-18.683` → quedó imputado a **F-1299 JORGELIN GABRIELA** (otro proveedor), cuando existía **F-2963377 SHERWIN WILLIAMS** del mismo día y monto (Vespucio Oriente es tienda Sherwin). Factura equivocada marcada pagada.
- Mov `2026-03-02 Compra TOKU *AKI KB $-117.611` → F-260866 (24-feb), existiendo F-267397 (19-mar) del mismo proveedor y monto — ¿cuál es la que pagó?
- Mov `2026-01-12 Compra ARAMCO $-59.495` → F-2988549, con **7 candidatas** del mismo monto (incluidas 3 facturas de Paula Johanna).

**Dónde**: `src/app/api/banco/import/route.ts:222-263` · misma lógica en `src/lib/banco/invoicePayments.ts:276-354` (`tryAutoMatchMovementWithInvoices`).

**Por qué pasa**: el parser de cartola (`santanderParser.ts:288`) solo saca RUT del patrón `"<rut> Transf a/de <nombre>"`. Las compras con tarjeta no tienen ese patrón → `counterpartyRut = null` → el auto-match nunca puede filtrar por proveedor y cae a "monto solo, primera".

**Severidad**: crítica (factura y a veces proyecto incorrecto marcado como pagado; el gasto del proyecto correcto queda como "pendiente" y el del equivocado como "saldado").
**Probabilidad**: media (solo se gatilla cuando dos+ facturas comparten monto exacto; pero con Sodimac/Easy/Sherwin repitiendo montos chicos, pasa seguido).
**Casos en la base real**: **43 movimientos conciliados sin RUT con ≥2 candidatas del mismo monto** (reconstruido desde el estado actual; no hay log del import). Población de riesgo: **350 movimientos sin RUT actualmente conciliados**.

**Opciones**:
- **(a)** Agregar ventana de fecha al auto-match (ver #2) y, ante ambigüedad residual sin RUT, **no auto-conciliar** (dejar `sin_asignar` para que MJ decida). Pro: elimina el match-a-ciegas. Contra: más movimientos quedan manuales.
- **(b)** Enriquecer el parser para mapear nombre de comercio → proveedor (tabla "VESPUCIO ORIENTE = Sherwin", "TOKU AKI KB = …"). Pro: recupera el proveedor. Contra: tabla a mantener a mano.
- **(c)** Cruzar también por glosa/comercio contra el `businessName` de la factura. Pro: sin tabla extra. Contra: nombres de comercio ≠ razón social (poco fiable).

**Postura**: (a) primero — que ante duda no concilie es lo seguro para la plata. (b) como mejora incremental para los comercios más frecuentes. No tocar nada hasta tu OK.

---

## 🔴 CRÍTICA #2 — El "±15 días" del auto-match no existe en el código (comentario ≠ código)

**Qué**: el encabezado del import dice *"mismo RUT contraparte + monto exacto, ±15 días"* (`import/route.ts:49-50`) y el modal de conciliación marca visualmente las facturas dentro de ±15 días. Pero **ningún query filtra por fecha**: el match real usa solo `type + status + tipoDoc + totalAmount` (±$10) y desambigua por RUT. La fecha nunca entra. Es código vs comentario divergente — y prioritario porque hace creer que hay una protección temporal que no está.

**Ejemplos reales** (factura más cercana en fecha existía pero se matcheó una lejana):
- Mov `2026-01-07 Muebles y deco $-59.500` → matcheó **F-1891 con fecha 2026-05-27** (¡factura 140 días *posterior* al movimiento, no existía aún!), habiendo F-1696 (2025-12-03, a 34 días). Reembolsador Paula Johanna.
- Cargos recurrentes de monto idéntico **Entel PAC $-24.980** (4 facturas mensuales iguales): el mov de marzo matcheó la factura a 20 días cuando había una a 8. Mismo patrón en **Sherwin Williams $-18.683**: matcheó F a 17 días existiendo una a 0 días, mismo proyecto.
- Caso extremo: mov `2025-03-11 $-26.075` → factura `2026-05-27` (gap 442 días).

**Dónde**: `src/app/api/banco/import/route.ts:222-245`; `src/lib/banco/invoicePayments.ts:200-237` y `291-313`.

**Por qué pasa**: el match se diseñó alrededor de monto+RUT; la fecha quedó como ayuda visual en el modal y como texto en el comentario, pero nunca se implementó como filtro.

**Severidad**: crítica cuando se combina con #1 (cruza proveedores) o con cargos recurrentes de igual monto (marca pagada la factura del mes equivocado → la del mes real queda pendiente). En casos mismo-proveedor-mismo-proyecto el total $ no cambia, pero el estado por factura sí.
**Probabilidad**: media.
**Casos en la base real**: **59 imputaciones con gap > 15 días** (de 501). De ésas, **5 con una factura alternativa del mismo monto+RUT más cercana en fecha** (match demostrablemente sub-óptimo). Distribución de gap: ≤15d: 442 · 16–30d: 28 · 31–60d: 14 · 61–90d: 5 · >90d: 12.

**Opciones**:
- **(a)** Implementar de verdad la ventana ±N días en el query del auto-match (p.ej. preferir la candidata con `issueDate` más cercana al movimiento; descartar matches con gap > N). Pro: alinea código con la intención; reduce mismatch recurrente. Contra: definir N (los datos sugieren que ventas/cobros legítimos llegan hasta ~30–45 días después).
- **(b)** Solo ordenar candidatas por proximidad de fecha y romper empates por fecha, sin descartar. Pro: menos agresivo. Contra: no impide el match lejano si es el único del monto.
- **(c)** Dejar el comentario honesto ("no se filtra por fecha") y no cambiar lógica. Pro: cero riesgo de regresión. Contra: no arregla el mismatch.

**Postura**: (a) con N generoso (~45 días) y desempate por cercanía. Antes de tocar, snapshot pre/post de qué imputaciones cambiarían. Esperar tu OK.

---

## 🟠 MEDIA #3 — Los cobros del cliente viven en el banco sin conciliar; las emitidas se marcan "pagada" sin vínculo bancario

**Qué**: hay **156 abonos sin asignar por $430.314.217**, de los cuales **110 son ≥ $1M ($414M)** — tamaño de cobro de cliente. En paralelo, 7 facturas emitidas figuran `pagada` con **$0 imputado** ($70,7M). El lado ingreso está, en la práctica, **sin conciliar contra el banco**: el `totalCobrado` sale de las facturas emitidas, no de los abonos, así que el dato no está mal — pero **un cobro faltante o duplicado en el banco no se detectaría desde la app**. Es exactamente el escenario del incidente PR#44 (se habían perdido $15M de transferencias de Carolina Ovalle).

**Dónde**: `metrics.ts:226` (cobrado = suma de emitidas, independiente del banco) · `BankMovement` sin relación directa a proyecto (`schema.prisma:801`).

**Por qué pasa**: regla de negocio "emitida ≈ cobrada" (correcta para el total), pero no hay paso que case el abono real con la emitida. Las transferencias de cobro salen a nombre de la persona (Carolina Ovalle), no del RUT de la empresa cliente, así que el auto-match por RUT no las toma.

**Severidad**: media (no es plata mal contada hoy; es el lado donde un error de plata pasaría inadvertido).
**Probabilidad**: alta (ya ocurrió).
**Casos**: 110 abonos ≥$1M sin asignar ($414M); 7 emitidas pagada sin vínculo ($70,7M).

**Opciones**:
- **(a)** Implementar la "Fase 2 cliente del proyecto" ya planificada (WIP ronda 24): `BankMovement.projectId` + mapear "persona que transfiere → proyecto" como los reembolsadores. Pro: cierra el lado ingreso. Contra: cambio de schema + UI.
- **(b)** Solo conciliar manualmente los abonos grandes contra emitidas, sin cambio de schema. Pro: rápido. Contra: trabajo recurrente, no escala.
- **(c)** Dejar como está y documentar que el ingreso no se concilia. Contra: el riesgo de plata perdida persiste.

**Postura**: (a) — es el mismo trabajo que ya tenías en el radar y ataca el único lugar donde se te podría escapar plata de cobros. Decisión tuya por el costo de schema.

---

## 🟠 MEDIA #4 — 64 facturas recibidas sin proyecto ($6,1M neto) no entran al costo de ningún proyecto

**Qué**: 64 de 715 recibidas tienen `projectId = null` (10 además sin categoría). Su gasto neto ($6.115.867, sin contar NC) no se suma a ningún proyecto en `metrics.ts` (que filtra por proyecto). Subestima el "gastado" real de los proyectos a los que pertenecen.

**Dónde**: `metrics.ts:301` (recorre `project.invoices`, las sin proyecto no aparecen). Catalogación manual (por diseño, `principles.md` "El proyecto NUNCA se auto-asigna").

**Severidad**: media · **Probabilidad**: alta · **Casos**: 64 facturas, $6,1M neto.

**Opciones**: (a) flujo/recordatorio en `/facturas` para catalogar pendientes (filtro `projectId IS NULL`); (b) reporte periódico de huérfanas; (c) dejar como tarea manual de MJ. **Postura**: (a) — visibilizar el backlog sin auto-asignar (respeta la regla). Es operacional, no urgente.

---

## 🟠 MEDIA #5 — Las 34 facturas emitidas no tienen `conceptoCobro`: el fondo sueldos no puede separar obra/muebles/artefactos

**Qué**: **34 de 34 emitidas** tienen `conceptoCobro = null`. Ese campo define cómo aporta cada cobro al fondo sueldos (GG de obra vs utilidad de muebles vs nada de artefactos, `business-model.md §8`). Sin él, el cálculo por concepto no se puede hacer.

**Dónde**: `Invoice.conceptoCobro` (`schema.prisma:631`) · consumido por `fondoSueldos.ts`.

**Severidad**: media (afecta el fondo sueldos, no el cobrado/gastado del proyecto) · **Probabilidad**: alta · **Casos**: 34/34.

**Opciones**: (a) pedir `conceptoCobro` al emitir/catalogar una emitida; (b) inferirlo del proyecto+monto contra el presupuesto (frágil); (c) backfill manual de las 34. **Postura**: (a) + (c) — backfill de las existentes y hacerlo obligatorio en adelante. Confirmar contigo cómo querés clasificar las mixtas.

---

## 🟠 MEDIA #6 — Hueco de cartola en noviembre 2025 + 737 movimientos sin `balanceAfter`

**Qué**: **0 movimientos en 2025-11** (rango 2025-03 … 2026-05, falta noviembre entero). Además **737 movimientos con `balanceAfter = null`** (historia 2025, ya conocido del WIP ronda 28). Riesgo: reimportar una cartola de 2025 duplicaría movimientos, porque la deduplicación depende de `balanceAfter`.

**Dónde**: dedup en `import/route.ts:20-32` por `(cuenta, fecha, monto, balanceAfter)`. **Severidad**: media · **Probabilidad**: media (solo si se reimporta cartola vieja) · **Casos**: 1 mes faltante; 737 movimientos sin llave estable.

**Opciones**: (a) conseguir e importar la cartola de noviembre 2025 + correr el backfill de `balanceAfter` sobre 2025; (b) dejar como está y no reimportar cartolas viejas. **Postura**: (a) cuando consigas las cartolas; mientras tanto, no reimportar 2025.

---

## 🟠 MEDIA #7 — La información de los correos del banco (concepto real, proyecto en glosa) se pierde

**Qué**: la app solo lee el Excel de cartola. El concepto real del pago y un proyecto nombrado en la glosa no entran. El matcheo "reembolso vs servicio directo" es **100% manual** y no hay campo que lo distinga (se infiere por si terminó conciliado a factura o convertido en pago sin respaldo 1043).

**Evidencia**: 104 movimientos cuya glosa **menciona el nombre de un proyecto** (heurística ruidosa — incluye falsos positivos por nombres comunes), casi todos sin imputar al proyecto que nombran. Ejemplos plausibles: "SHELL COLON" → Depto Colon, "CASA MUSA" → Ampliación Casa Arrau.

**Dónde**: `santanderParser.ts` (solo parsea nombre/RUT de transferencias) · no hay ingesta de mails. **Severidad**: media · **Probabilidad**: alta.

**Opciones**: (a) sugerir proyecto/categoría desde la glosa en el modal de conciliación (sin auto-asignar); (b) ingesta de mails del banco (ambicioso); (c) status quo. **Postura**: (a) — sugerencia, no asignación, coherente con "el proyecto nunca se auto-asigna".

---

## 🟡 MEDIA-BAJA #8 — 12 notas de crédito sin `referenceFolioNumber` (no linkeadas a su factura)

**Qué**: 12 de 33 NC no tienen factura referenciada. **Restan igual** del cobrado/gastado vía `sign()` en `metrics.ts` (eso está bien), pero no se ve qué factura compensan, y al aplicarlas a mano se puede asociar a la equivocada. Dato sano: **0 NC referencian una factura inexistente**, y todas las linkeadas matchean.

**Dónde**: `Invoice.referenceFolioNumber` · `sii/linkNcReferences.ts`. **Severidad**: media-baja · **Probabilidad**: media · **Casos**: 12.

**Opciones**: (a) reintentar el auto-link de NC contra el SII para esas 12; (b) link manual; (c) dejar (el total no se ve afectado). **Postura**: (a) — correr `linkNcReferences` sobre las 12.

---

## ⚪ COSMÉTICA #9 — Variantes de nombre de la misma contraparte + emojis en UI

**Qué**: (a) **12 RUTs con >1 variante de nombre** ("CRISTOBAL ALEJ" / "CRISTOBAL ALEJANDRO ARIAS", "DANIEL IGNACIO" / "DANIEL IGNACIO SANTIBANEZ ORMENO", etc.). El match es por RUT, así que **no rompe nada** — es ruido visual. (b) El modal de conciliación usa emojis (💡, ✓, ⚠) que violan la estética BLARQ (`principles.md`: sin emojis en UI).

**Dónde**: (a) `BankMovement.counterpartyName` (texto crudo de cartola). (b) `MovementReconcileModal.tsx:619,657,668,893`. **Severidad**: cosmética.

**Opciones**: (a) normalizar el display por RUT; (b) reemplazar emojis por iconos lucide o texto. **Postura**: baja prioridad; el (b) es trivial cuando toques ese archivo.

---

# LO QUE ESTÁ SANO Y VERIFICADO

Tan importante como los hallazgos:

- **Integridad de facturas**: 0 campos críticos nulos (type, total, fecha, RUT, folio, tipoDoc). 0 totales negativos accidentales. 0 duplicados duros (folio+RUT+tipoDoc).
- **Invariante de pago respetada**: 0 movimientos sobre-imputados (Σ imputado ≤ |monto| siempre). 0 splits cruzados entre proyectos. Solo 4 movimientos con split (legítimos).
- **"112 facturas pagada con imputado < total" resultó ser falso problema**: 7 emitidas legacy (correcto por "emitida ≈ cobrada"), 102 recibidas legacy de Maxxa (pagadas fuera de la app), 3 por redondeo ≤$10. **0 faltante real.** Las 13 "sobre-pagadas" son todas $2–$10 (tolerancia de redondeo IVA), no error.
- **Notas de crédito**: restan correctamente (`sign()`), 0 referencian factura inexistente, las linkeadas matchean.
- **Pagos sin respaldo (1043)**: los 21 con proyecto Y categoría asignados (0 huérfanos de atribución). Bien integrados al gastado. (Los 10 `maxxa_sin_respaldo` sin movimiento bancario son legacy, no bug.)
- **Reembolsadores**: 4 bien modelados (José Perez→JPB; Elias/Cristóbal/Francisco Arias→Paula Johanna o Sodimac). **0 doble conteo detectado** (ningún pago sin respaldo a un RUT de reembolsador-persona que duplicara una factura del alias).
- **Pagos parciales reales** (6 facturas con N imputaciones en fechas distintas) y **NC posterior a pagos** (16 casos) manejados con el signo correcto. El caso que citaste (Elias/Sodimac 08-abr $275.746 = $18.000 + $257.746) está en la base, conciliado, y con su NC posterior (F-63272605) — bien.

---

# MAPA CUANTITATIVO DE CONCILIACIÓN

**Cobertura por mes** (movimientos no internos; "resuelto" = conciliado + sin_factura):

| Mes | Total | Concil. | sin_asignar | sin_factura | Resuelto |
|---|--:|--:|--:|--:|--:|
| 2025-03 | 115 | 2 | 50 | 63 | 57% |
| 2025-04 | 81 | 0 | 45 | 36 | 44% |
| 2025-05 | 93 | 1 | 50 | 42 | 46% |
| 2025-06 | 172 | 5 | 97 | 70 | 44% |
| 2025-07 | 79 | 0 | 46 | 33 | 42% |
| 2025-08 | 71 | 0 | 28 | 43 | 61% |
| 2025-09 | 50 | 0 | 23 | 27 | 54% |
| 2025-10 | 76 | 2 | 25 | 49 | 67% |
| **2025-11** | **0** | — | — | — | **(hueco)** |
| 2025-12 | 154 | 6 | 59 | 89 | 62% |
| 2026-01 | 117 | 76 | 31 | 10 | 74% |
| 2026-02 | 156 | 109 | 31 | 16 | 80% |
| 2026-03 | 185 | 136 | 32 | 17 | 83% |
| 2026-04 | 150 | 109 | 31 | 9 | 79% |
| 2026-05 | 68 | 49 | 10 | 8 | 84% |

La conciliación contra factura arranca en serio en 2026-01 (antes casi todo era "sin_factura" categorizado o "sin_asignar"). 2026 está en 74–84%.

**Antigüedad de los sin_asignar** (558 total): ≤30d: 10 · 31–60d: 31 · 61–90d: 32 · **>90d: 485** (todo el backlog 2025). Monto: abonos $430,3M · cargos −$222,3M.

**Personas/emisores con más movimientos sin clasificar** (top): Pedro Barrera (48× −$7,8M), Comercial K (22× −$13,6M), Jose Perez (15× −$18,7M, reembolsador), PAGO SII (14×), Maria Carolina/Ovalle (13× +$39,7M, cobros Portofino), DP Herrajes (12×), Fernando Andrés (11× +$40,1M).

---

# LO QUE NECESITO DE VOS PARA CERRAR DUDAS

1. **¿Los abonos grandes sin asignar son cobros de cliente?** (110 × ≥$1M = $414M). Si sí, define si querés conciliarlos (Fase 2) o si te basta con que el cobrado salga de las emitidas.
2. **Cartola de noviembre 2025** — ¿la tenés? Sin ella ese mes queda en blanco.
3. **`conceptoCobro` de las 34 emitidas** — ¿cómo querés clasificarlas (y las mixtas)?
4. **Las 64 recibidas sin proyecto** — ¿las catalogás vos a mano o querés una vista que las junte?
5. **Rotar la contraseña de la BD de prod** (apareció en el log de esta sesión).

Ninguna de estas la toco sin tu instrucción. Quedo esperando tu lectura.
