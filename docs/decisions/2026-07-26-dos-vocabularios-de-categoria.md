# ADR — Dos vocabularios de categoría (facturas en árbol, movimientos en lista plana): separados a propósito

- **Fecha**: 2026-07-26
- **Estado**: aceptado
- **Autor**: MJ (decisión), asistente (mapeo y opciones)

## Contexto

En la app conviven dos formas de categorizar plata, con dos desplegables distintos que no se hablan:

1. Un **árbol** de categorías de costo (modelo `CostCategory`, dos niveles: Materiales, Mano de obra, Herramientas, Subcontrato, Pérdidas, Muebles, Artefactos, Gastos generales, Gastos extras, Gastos financieros, Auto). Cuelga de la **factura** (`Invoice.categoryId`).
2. Una **lista plana** de texto libre (`BankMovement.category`: sueldo, previred, comisión banco, impuestos, retiro socio, bono socio, préstamo socio, depósito efectivo, otro; más `transfer_interno` y `reembolso_proveedor` que escribe solo el sistema). Cuelga del **movimiento del banco**.

MJ planteó la pregunta con un ejemplo concreto: un gasto de Google llega como factura y usa la CostCategory "Gastos extras"; un pago a un socio no tiene factura y usa `category = "sueldo"`. Para ver "todo lo gastado en X" hay que mirar en los dos lados. ¿Los dejamos separados a propósito o los unificamos?

**Lo que encontró el mapeo (2026-07-26):**

- Los dos sistemas **no se pisan**: un movimiento conciliado contra una factura pierde su categoría (queda `null`) — manda la factura. Nunca hay dos categorías para el mismo peso.
- El árbol **ya sabe cubrir "gasto sin papel"**: los pagos a maestros, las boletas y los gastos internacionales se registran como factura fantasma (`tipoDoc = 1043`) con su `CostCategory` de verdad.
- Lo que queda solo del lado plano son dos grupos muy distintos: **cuatro gastos reales que nunca llegan como documento** (sueldo, Previred, comisión banco — más impuestos, que es pasa-manos) y **seis cosas que no son gasto** (retiros, bonos y préstamos de socios, depósitos en efectivo, traspasos entre cuentas propias, reembolsos de proveedor).
- El "hay que mirar los dos lados" **ya estaba resuelto en las dos pantallas donde importa** — el Centro de costo de BLARQ y el Estado de Resultado vista Caja — pero cosido a mano, por separado en cada una.
- El dolor real no era el modelo: la lista plana estaba **copiada a mano en cuatro archivos** ya desincronizados entre sí (dos copias en la pantalla de movimientos, una en la de reglas con dos etiquetas distintas para las mismas categorías, y una cuarta en el Estado de Resultado con un valor que las otras no tenían), y el endpoint que guarda **no validaba nada** (aceptaba cualquier string).

## Decisión

**Se mantienen los dos vocabularios, porque responden preguntas distintas**, y se ordena el puente entre ellos en un solo lugar.

- El **árbol** responde *"¿en qué se gastó?"*. Es el plan de cuentas de costos.
- La **lista plana** responde *"¿qué tipo de movimiento es, y por qué no tiene factura?"*.

Operativamente:

- Nace `src/lib/banco/categorias.ts` como **fuente única** de la lista plana. Reemplaza las cuatro copias. Cada categoría declara: qué se guarda (`value`), su etiqueta corta para la tabla (`label`), su etiqueta del desplegable si necesita más explicación (`labelOpcion`), su **etiqueta contable** para el Estado de Resultado (`labelEERR`), si la elige MJ o la escribe el sistema (`seleccionable`), si es costo de operar BLARQ (`esGastoDeEstructura`) y **bajo qué nombre aparece junto a los gastos con factura** (`seccionCosto`).
- `seccionCosto` es **el único puente** entre los dos sistemas. Antes estaba escrito a mano y por separado en cada pantalla que lo necesitaba.
- Se conservan **dos registros de etiqueta a propósito**: en la tabla del banco se lee "Sueldo" y "Comisión banco"; en el Estado de Resultado se lee "Sueldos" y "Gastos financieros". La celda de la tabla es angosta y lista movimientos; el cuadro es un estado de resultado y usa nombres de cuenta.
- "Gastos financieros" existe **deliberadamente de los dos lados** (la comisión del banco acá, una `CostCategory` homónima allá) para que caigan en la misma fila.
- El `PATCH` del movimiento ahora **valida** la categoría contra la lista y devuelve 400 si no la conoce. `null` sigue siendo válido (es "sacarle la categoría").
- Se elimina `compra_tarjeta`, que quedó muerta cuando se sacó la inferencia por el prefijo "Compra" de la glosa. Verificado en la base viva: **0 movimientos y 0 reglas**.
- Se agrega `reembolso_proveedor` a las etiquetas de la tabla, donde faltaba: sus 4 movimientos en la base viva se mostraban con el texto crudo.

**Regla para adelante:** los retiros, bonos y préstamos de socios, los depósitos en efectivo, los traspasos entre cuentas propias y los reembolsos de proveedor **no son gasto** y no deben entrar al árbol de costos. Meterlos infla el gastado. Esa es la razón de fondo por la que la lista plana no se disuelve.

## Alternativas descartadas

- **Unificar todo en el árbol** — que sueldo / Previred / comisión / impuestos se volvieran `CostCategory` de verdad, que `BankMovement` ganara un `categoryId`, y que la lista plana quedara solo con lo que no es gasto (renombrada a "tipo de movimiento"). Es la opción **conceptualmente más limpia** y la que habilitaría crear una categoría de gasto sin factura sin tocar código. Se descartó **por costo/beneficio ahora, no por estar mal**: exige cambio de schema y migración de la base viva, y toca el Estado de Resultado Caja, el Centro de costo, los guardias del período de sueldo, el motor de reglas del banco y el filtro de columna. Como la app no tiene tests automáticos de cálculo, un error se vería como plata mal calculada. Estimado 2–3 sesiones contra 1. **Queda como camino abierto**: dejar el puente en un solo archivo es exactamente el paso previo.
- **Unificar a lo bruto** — meter toda la lista plana en el árbol de costos. Descartada de plano: seis de las once categorías no son gasto, y contarlas como gasto sería un error de plata visible.
- **Meter los sueldos por el mecanismo del 1043** — reusar la factura fantasma que ya existe para pagos sin documento, creando un 1043 por cada sueldo. Descartada: rompería las exclusiones del F29 y de la vista Facturación (que filtran justamente por `tipoDoc = 1043`), y el sueldo necesita su propio período (`salaryPeriod`), que la factura no modela.
- **Solo documentar, sin tocar código** — dejar las cuatro copias como estaban. Descartada por MJ: no arregla nada y el próximo reporte vuelve a coser a mano.

## Consecuencias

- **Positivas**: una sola lista que editar cuando aparece una categoría nueva; imposible que la tabla y el Estado de Resultado se desincronicen; el puente entre los dos sistemas es visible y está en un solo archivo; un typo en la categoría ya no se guarda en silencio; el test `scripts/test-categorias-banco.ts` congela las etiquetas contables (si alguien las cambia sin querer, falla).
- **Costos / contras**: sigue habiendo que tocar código para agregar una categoría de gasto sin factura (ej. un arriendo pagado por transferencia sin boleta). Es el precio de no hacer la Opción B.
- **Cambio visible menor**: en la pantalla de reglas de banco, dos etiquetas ahora dicen lo mismo que en la tabla del banco ("Préstamos socios" en vez de "Préstamo socio", "Otro" en vez de "Otro / sin factura"). En la tabla del banco desaparece "Compra tarjeta" (no había ninguno) y aparece "Reembolso proveedor" en los 4 que mostraban texto crudo.
- **Deuda generada**: ninguna nueva. La deuda que queda es la pre-existente y es la Opción B, ahora escrita.

## Referencias

- Archivos: `src/lib/banco/categorias.ts` (la lista y el puente), `src/lib/dashboard/estadoResultadoCaja.ts`, `src/app/(dashboard)/proyectos/[id]/resumen/page.tsx` (`getGastosBancoBlarq`), `src/app/(dashboard)/banco/movimientos/page.tsx`, `src/app/(dashboard)/banco/reglas/page.tsx`, `src/app/api/banco/movimientos/[id]/route.ts`.
- Vocabulario del árbol: `prisma/schema.prisma` (`CostCategory`), `prisma/seed.ts`, `docs/business-model.md` §6.
- Verificación: `scripts/test-categorias-banco.ts` (45 checks), `scripts/snapshot-eerr-caja.ts` (snapshot antes/después del Estado de Resultado Caja — idéntico), `scripts/diag-categorias-banco-uso.ts` (qué valores existen de verdad en la base).
- Relacionado: ADR `2026-07-18-plata-que-no-es-gasto-ni-ingreso.md` — la misma distinción, aplicada al bloque no operativo del Estado de Resultado.
