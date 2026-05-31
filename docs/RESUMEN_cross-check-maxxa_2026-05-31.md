# Resumen — Auditoría cruzada Maxxa vs App (2026) + conciliaciones aplicadas

Resumen ejecutivo de la sesión del 30-31 mayo 2026. Para leer de corrido y compartir con JT. El detalle técnico está en los reportes enlazados.

---

## 1. Qué hicimos y por qué

Maxxa es el sistema contable que BLARQ está dejando. Antes de apagarlo, comparamos **factura por factura y movimiento por movimiento** lo que dice Maxxa contra lo que dice la app, solo para **2026** (Fase 1). La idea: dos sistemas independientes deberían contar la misma plata; lo que difiera, lo miramos.

Datos usados: 2 exports de facturas de Maxxa (recibidas y emitidas) + 2 cartolas bancarias (cuenta Operativa, todo 2026, con la conciliación adentro), comparados contra un volcado de solo-lectura de la base de la app.

---

## 2. La conclusión tranquilizadora

**Los dos sistemas cuentan la misma plata.**

- De las facturas que están en ambos: **598 de 606 recibidas y las 27 de 27 emitidas calzan**, con **cero diferencias de monto**.
- Las **24 notas de crédito calzan al peso**.
- El **cobro reconcilia a $0 exacto** en 4 de 5 meses (el único desvío, abril, es una factura anulada con su nota de crédito — modelado, no plata perdida).
- El **movimiento bancario que ve la app es el mismo que ve Maxxa** (cuenta Operativa idéntica en enero, marzo y abril).

La diferencia de gasto bruto (app $203,4M vs Maxxa $176,7M) se explica **100% por diferencias de cómo cada sistema modela las cosas**, no por plata mal contada:
- La app captura pagos a maestros informales (Daniel, etc.) que Maxxa no tiene (+$14,3M).
- Maxxa, al anular una factura, la saca Y deja su nota de crédito → resta dos veces; la app mantiene factura + NC = neto cero. **Acá la app es la correcta.**
- Boletas, honorarios y un par de facturas de borde de diciembre-2025 que la app no sincroniza.

**No se encontró plata mal atribuida.** El único hallazgo que parecía grave (cobros de un cliente en el proyecto de otro, ~$20M) resultó un **error de mi método** (crucé por monto+fecha y había varias transferencias de $5M el mismo día). Lo verificamos contra las glosas reales: **la app concilia bien.**

---

## 3. Dónde SÍ difieren (y qué hicimos)

Donde los sistemas difieren es en **qué está marcado como pagado y qué movimientos están vinculados a su factura** — no en cuánta plata hay. La app venía atrasada en vincular pagos al banco. Eso lo empezamos a cerrar:

### Conciliaciones aplicadas en la app (con tu OK, dry-run previo y backup)

| Qué | Cuánto | Resultado |
|---|---|---|
| **Sección 1 — recibidas que Maxxa tenía pagadas y la app pendientes** | 23 facturas, **$14.802.446** | Marcadas pagadas, movimientos vinculados |
| **Re-enlace de facturas "pagada sin enlace" 2026 (problema Sodimac)** | 2 facturas, **$547.400** | SANITOP y Cuadros Geométricos completadas |

**Total conciliado: 25 facturas, $15,3M.** Verificado: 0 movimientos sobre-imputados, y **ningún total de plata se movió** (el gasto 2026 quedó igual: $203.435.764). Las imputaciones quedaron marcadas como manuales (no aparecen con el "auto" gris).

### Lo que dejamos afuera a propósito

- **Pedro Barrera (F-305, $2,9M)**: hay **dos personas distintas llamadas Pedro Barrera** con RUTs distintos (Nieto y Puentes), y las transferencias van a los dos con la misma glosa. Auto-enlazar mezclaría sus platas → se hace a mano.
- **3 cruces de tarjeta** (Vespucio→Sherwin, Vespucio→Esmax, Garachena→Santander): la app los tiene pegados a la factura equivocada. Hay que **desligar y reimputar**, no agregar pago. Pendientes de tu decisión.
- **2 casos "sin capacidad"** (Studio Group, Sodimac): el movimiento ya está en otra factura; uno (Studio Group) es un enredo de factura anulada + nota de crédito que no cuadra en monto y necesita tu criterio.

---

## 4. El problema "Sodimac" en perspectiva

La sesión paralela de Ronda 35 detectó que el importador de Maxxa creó facturas como "pagada" **sin crear el enlace al pago del banco**. Lo medimos **en toda la app**:

- **130 facturas, $72,1M** marcadas pagadas sin enlace. **No es plata mal contada** — el gasto del proyecto se calcula de las facturas, no de los movimientos. Es trazabilidad (el movimiento queda "sin factura" en vez de enganchado a la suya).
- **109 de las 130 son de 2025.** Esas **no se pueden arreglar bien ahora** porque (a) la conciliación confiable de Maxxa que tenemos es solo de 2026, y (b) las compras con tarjeta no traen RUT → adivinar el movimiento por monto es justo el bug de cruce que venimos peleando. **Van a la Fase 2** (con la cartola de 2025).
- De 2026, lo seguro eran solo 2 facturas (ya hechas, arriba). El resto espera la cartola de mayo o son los casos delicados de arriba.

**Riesgo registrado aparte** (ADR `2026-05-30-metrics-no-filtra-anuladas.md`): el cálculo contable no excluye facturas anuladas; hoy queda bien porque cada anulada tiene su nota de crédito que la compensa. Si alguna vez se anula una factura sin cargar la NC, inflaría el gasto. La defensa (filtrar anuladas en `metrics.ts`) queda como tarea para cuando se toque ese archivo — **no se tocó esta sesión** (es el archivo más sensible).

---

## 5. Pasos a seguir

**De tu lado (cuando puedas):**
1. **Importar la cartola de mayo en la app** → con eso entran 14 facturas más de fin de mayo que hoy no tienen su movimiento cargado (vuelvo a correr el script, es automático).
2. **Decidir los 3 cruces de tarjeta** (desligar + reimputar) y los 2 casos "sin capacidad" (Studio Group / Sodimac).
3. **Decidir la Sección 2 (cobros de cliente)**: hay 27 movimientos de cobro ($112M, sobre todo Fernando Terre y Ovalle) que Maxxa concilió y la app dejó sueltos. Es el lado ingreso.

**Para la Fase 2 (2025):**
- Conseguir la **cartola completa de 2025** (las dos cuentas; falta noviembre-2025).
- Re-enlazar las 109 facturas pagadas-sin-enlace de 2025 **por glosa/RUT, no por monto**.
- Resolver Pedro Barrera Nieto vs Puentes a mano.
- Evaluar el filtro de anuladas en `metrics.ts` (con snapshot pre/post).

**Confirmado en el camino:** Maxxa solo tiene cargada la cuenta Operativa (no Sueldos).

---

## 6. Reportes con el detalle

- **Cross-check completo**: `docs/REVIEW_maxxa-vs-app-2026_2026-05-30.md`
- **Listado accionable de conciliaciones pendientes** (las 4 secciones): `docs/REVIEW_maxxa-conciliacion-pendiente_2026-05-30.md`
- **Scripts reusables**: `scripts/conciliar-seccion1-maxxa.ts`, `scripts/relink-pagadas-2026.ts` (ambos dry-run por default).
- **Backups previos a cada escritura**: `backups/audit-facturas-conciliacion-2026-05-31T03-00.json` y `...03-21.json`.

*Todo lo escrito en la app es reversible (solo se agregaron vínculos de pago; no se borró ni cambió ningún monto).*
