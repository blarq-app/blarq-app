# Para revisar — MJ (2026-06-01 / act. 2026-06-02)

Cosas que salieron de la auditoría de lo **automático** (conciliaciones que hizo la app / mis scripts de migración), y que **dependen de tu criterio manual**. No las toqué.

---

## 0. Notas de Crédito sueltas — RESUELTO PARCIAL (2026-06-02)

Encontraste el tema: muchas facturas figuraban "pendiente" en la app cuando en tu Maxxa estaban **anuladas por una Nota de Crédito**. De 91 NC recibidas, 70 estaban "sueltas" (la app no sabía qué factura cancelaban) porque el SII no devuelve esa referencia — pero tu Maxxa sí. Vinculé las NC desde tu export y dejé cada factura como corresponde (backup `audit-...02-52`):

- **22 facturas → ANULADAS** (nunca pagadas, la NC las cancela entera): BRUNE f403/f405, JPB f167+f168, Proyectos f43837, Transportes YRG, J&R, Sherwin, Construmart, Sodimac, etc.
- **21 facturas → SALDADAS (pagada)** (pagaste parte por banco + NC cubrió el resto).
- **2 facturas → parcial** (NC chica, todavía deben algo).
- El gasto por obra **no cambió** (la NC ya restaba). Los pendientes bajaron de 203 a 165.

**PENDIENTE para vos:**
- **18 "reembolsos" (G2, $8,95M)**: facturas que **ya pagaste** y después te llegó una NC = el proveedor te devolvió plata (Sodimac, Comercial K, DP). Las dejé **pagada** (no anuladas). Falta decidir: ¿esa plata volvió a tu cuenta (buscar el abono) o quedó como crédito para la próxima compra? Por ahora la NC neteó el gasto, que es lo importante.
- **4 NC apuntan a boletas (tipo 39) que la app no tiene** (Comercial K f717915/f717917, Maho, Ferreti) — no hay factura que anular.
- **2 NC Sodimac sin referencia en tu Maxxa** (f62624352 $146.916, f62613036 $29.406) — revisar a mano qué cancelan.

## 0b. Huecos limpios (Maxxa pagó, app pendiente) — dry-run listo, ESPERANDO TU OK

Aparte de las NC, quedan **28 facturas que tu Maxxa pagó pero la app muestra pendiente** ($12,07M). De esas, **5 son enganche limpio** ($2,9M: Comercializadora f233, J&R f3927, Concesionaria f5705931) — el dry-run está en `scripts/conciliar-huecos-limpios.ts`. Las otras ~23 tienen el mov ocupado por otra factura o son subcontratista en cuotas (BRUNE/Victorino) → tu ojo.

**Las 2 facturas que de verdad NO están en tu Maxxa** (ni anuladas): AKI f237293 $105.690, Autopista Costanera f14360155 $3.342.

---

## 1. Doble conteo en el Quincho — RESUELTO (2026-06-01)

**MJ confirmó que JPB f173 cubre el trabajo de Pedro Barrera del Quincho.** Se borraron los 14 registros "Pedro Barrera" sin_respaldo duplicados ($2.935.000) con `scripts/borrar-pedrobarrera-quincho-duplicados.ts` (backup `audit-...2026-06-01T21-08.json`). El gasto neto del Quincho bajó de ~$12,15M a **$9.118.859** (−$2.935.000, corregido el doble conteo).

**Conciliación de JPB f173 — HECHO (MJ aportó el mapa exacto de Maxxa).** Se engancharon los **16 movimientos** que MJ concilió a mano en Maxxa (`scripts/conciliar-jpb-f173.ts`, backup `audit-...2026-06-01T21-17.json`): 14 Pedro Barrera ($2.935.000) + José Pérez $766.650 + Iván Henríquez $800.000. JPB f173 → **parcial, pagado $4.501.650, saldo $300.000** (idéntico a Maxxa). El de Iván estaba mal como "interno" → se sacó (MJ confirmó que es pago de JPB) y se desemparejó su contraparte.

**PENDIENTE menor para MJ:** la contraparte del interno deshecho — **"Transf de BLARQ SPA" +$800.000 (06-abr)** — quedó en sin_asignar. Es plata que entró desde otra cuenta tuya; revisá qué es (¿aporte de capital? ¿traspaso real?).

<details><summary>Contexto original (resuelto)</summary>

**Lo que pasaba:** en el Quincho conviven dos cosas que podrían ser el mismo trabajo:
- Los **$2.935.000 en registros "Pedro Barrera"** (14 transferencias, dic-2025 a ene-2026) que creé yo en la migración (ronda 36), tratándolo como maestro sin factura.
- La factura real **JPB f173 por $4.035.000 neto** ($4.801.650 con IVA), hoy *pendiente*. Vos la asignaste a mano a esas transferencias en Maxxa — me contaste que "una vez JPB me hizo facturas para Pedro Barrera".

**Por qué importa:** si JPB f173 cubre ese trabajo de Pedro Barrera en el Quincho, entonces el gasto del Quincho está contado **dos veces** (una por mis registros, otra por la factura JPB), inflado en hasta **$2.935.000**. Esto SÍ afecta los números de la obra (a diferencia de lo del punto 2).

**Lo que tenés que decidir:** ¿JPB f173 cubre el trabajo de Pedro Barrera del Quincho (esas transferencias de dic-ene)?
- **Si lo cubre** → hay que borrar mis registros "Pedro Barrera" del Quincho y dejar solo la factura JPB con esas transferencias como pago. (Decime y lo hago con dry-run.)
- **Si es trabajo aparte** → está todo bien, no se toca.

</details>

---

## 2. Reasignar los movimientos que despegué de ventas — según tu Maxxa

Busqué en los Excel de Maxxa (`scripts/buscar-asignacion-maxxa.ts`) a qué factura asignaste cada uno. Resultado:

**HECHO (limpios, ya enganchados a prod, `scripts/conciliar-f75-f92.ts`, backup `audit-...21-24.json`):**
- **f75 DELPHINCLEAN** ← Nelson Gil $130.000 + $179.400 = $309.400 → **pagada**. ("Nelson Gil" es la persona de DELPHINCLEAN.)
- **f92 INVERSIONES DPM** ← MercadoPago $33.990 → **pagada** (el resto del mov, $3.399, es honorario de JT sin factura; el mov quedó parcial).

**PENDIENTE para vos (no es obvio, no lo toqué):**
- **Cuadros Geométricos — f109** ($790.001, parcial): ya tiene **un** pago de $395.000 y le falta otro. Pero hay **dos** transferencias Cuadros de $395.000 sueltas (03-abr y 12-jun), y en Maxxa asignaste dos a f109. Son **3 transferencias iguales de $395.000** y solo caben dos en f109 → tenés que decidir cuál va a f109 y cuál a otra factura Cuadros (¿f124 Waterloo $859.500?).
- **Icproyectos — f123 / f124**: en Maxxa, el mov $1.208.015 (07-may) va a **f123** ($1.208.015) y el mov $1.000.000 va a **f123** ($815.000) + **f124** ($185.000). Pero en la app **f124 ya figura pagada** y hay un mov Icproyectos de **feb-2025 fuera del rango de Maxxa** ($5.069.000). Enredado → mejor lo mirás vos.
- **"Transf a BLARQ SPA"** (3 movs nov-2025: $3.146.785, $380.677, $862.500): en Maxxa **no las conciliaste a ninguna factura** → son traspasos internos tuyos, no van a compra.

**Nota:** nada de esto afecta los números de las obras (cobrado/gastado salen de las facturas, no de los pagos). Es trazabilidad.

---

## 3b. Cruce completo por glosa (export de facturas Maxxa) — HECHO

Con tu export `exportar (2).xls` (cada factura trae la glosa del movimiento que la pagó), hice el cruce completo (`scripts/cruce-glosa-maxxa.ts`, backup `audit-...21-52.json`):
- **APLICADO: 65 enganchados ($14,4M) + 15 movidos ($1,25M)** a la factura que dice tu Maxxa. Gasto sin cambio. YA_OK pasó de 739 → 809 facturas.
- **12 AMBIGUO ($8,48M) — RESUELTOS (2026-06-01)** con la cartola (que sí trae fecha + tu asignación manual): `scripts/conciliar-ambiguos-cartola.ts`, backup `audit-...23-19.json`. Cada factura gemela quedó con el mov que vos le asignaste en Maxxa por fecha: Victorino Soto f30/f32 (Duplex) y f29/f31 (Eduardo Montes); Transportes Paulo César f9/f10/f11/f14 (Duplex/Williamson); Paula Johanna f1516/f1520, Héctor Soto f223, Frank Harrison f202 (todas Casa Arrau). 8 pasaron a pagada, 4 ya estaban pagadas (solo broche). Gasto sin cambio.
- **10 MOVER ($498k) — RESUELTOS (2026-06-02)** con la cartola: `scripts/conciliar-mover-cartola.ts`, backup `audit-...00-30.json`. Cada mov estaba pegado a una factura equivocada (auto-match por monto) → lo despegué y lo puse en la que vos asignaste en Maxxa. Incluye AKI KB (arreglé un doble-broche: un mov contado en 2 facturas). **11 facturas viejas volvieron a pendiente** (correcto: ese mov nunca las pagó; pueden estar esperando su mov real). Gasto sin cambio. **Punto 1 completo: 22/22 casos del cruce resueltos.**
- **NO accionable acá**: 164 movimientos que no están en la app ($60,6M — otra cuenta o nunca importados) y **97 facturas que Maxxa tiene y la app no** ($93M — boletas/honorarios/sin respaldo que el SII no sincroniza). Son investigaciones aparte (ver punto 4).

## 4. Investigaciones grandes pendientes (no urgentes)

- **97 facturas en Maxxa que no están en la app ($93M)**: probablemente boletas de honorarios, sin respaldo, o compras que el SII no trajo. Decidir si se importan.
- **164 movimientos que Maxxa concilió pero no están en la app ($60,6M)**: faltan cuentas/períodos por importar (Sueldos, o movimientos que nunca entraron).

## 3. Los desacuerdos app↔Maxxa — re-revisados bajo tu premisa (Maxxa manda)

Con tu premisa (Maxxa manda, salvo Maxxa-vacío) + la cartola nueva ene–mar, quedaron **214** desacuerdos. Excel actualizado en `~/Downloads/Desacuerdos_Maxxa_app.xlsx` (columna "Veredicto probable" = la acción). Estado:

- **HECHO — 39 enganchados ($6,08M)**: compras con tarjeta que la app tenía "sin factura" → su factura de Maxxa (`scripts/enganchar-sinfactura-maxxa.ts`, backup `audit-...21-42.json`). Aditivo, no movió números.
- **PENDIENTE — 51 "mover a otro folio del MISMO proveedor" ($12,2M)**: Maxxa pone el mov en otra factura del mismo proveedor que la app. Hay que rehacer la conciliación con cuidado para no dejar la factura original colgando. **Lo armo con dry-run para que apruebes** (decisión MJ: "después armo los 51").
- **A CONFIRMAR — 1 reembolso ($374.820)**: el mov **"Transf a María José" → Sodimac f143439797**. Antes lo llamamos "error de Maxxa" (retiro); bajo tu premisa sería un reembolso tuyo legítimo por una compra Sodimac. **¿Lo engancho a Sodimac f143439797 o lo dejamos sin factura?** (más los otros ~24 "transf a persona" que la glosa no confirma directo).
- **REVISAR — 30** (25 sin_factura/interno + 5 otro proveedor): la glosa no confirma al proveedor; necesitan tu ojo aunque Maxxa los asigne.
- **NO ACCIONABLE — 93 ($21,5M)**: el movimiento no está en la app (otra cuenta, ene-feb fuera de import, o nunca importado).
