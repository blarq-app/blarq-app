# ADR — Plata que no es gasto ni ingreso: préstamos con socios, reversas y sobrepagos

- **Fecha**: 2026-07-18
- **Estado**: aceptado
- **Autor**: MJ (planteó el problema y propuso el modelo final)

## Contexto

No toda la plata que entra o sale del banco es venta o gasto. Hay movimientos que
solo **mueven plata** sin que el negocio gane ni pierda, y si se cuelan al
Resultado de Operación ensucian la utilidad.

El problema apareció mirando los movimientos a los socios. Había **una sola
categoría "Préstamo socio"** para las dos direcciones, y eso rompía dos cosas:

1. El recuadro de saldos salía **dado vuelta**: mostraba "María José le debe
   −$19M a la empresa" cuando es al revés (la empresa le está devolviendo).
2. Un préstamo cuya contraparte **no era el socio** (BLARQ le pagó $500.000 a un
   tercero por cuenta de JT, porque JT no tenía plata en su cuenta) caía en el
   bloque **operativo** y **restaba de la utilidad** como si fuera un gasto del
   negocio. Prestar plata no es costo de operar.

Al ordenarlo aparecieron otros dos casos parecidos que conviene no confundir:
pagos por error que vuelven, y sobrepagos sobre una factura que se devuelven.

## Decisión

Se distinguen **tres familias**, cada una con su mecanismo:

### A. Préstamos con los socios → una cuenta corriente

**Una sola categoría `prestamo_socio`**, que funciona como cuenta corriente con
los socios **en conjunto** (no separada por persona). El **signo** hace todo:

| Movimiento | Efecto en el saldo |
|---|---|
| **Entra** plata (el socio pone o devuelve) | BLARQ les debe **más** |
| **Sale** plata (BLARQ devuelve o adelanta) | BLARQ les debe **menos** |

No se distingue "préstamo" de "devolución": **es información redundante**, porque
la suma es idéntica en los dos casos. El saldo corrido dice quién le debe a
quién (positivo = BLARQ les debe; negativo = los socios le deben a BLARQ).

Estos movimientos van **siempre al bloque no operativo**, aunque la contraparte
del banco no sea el socio.

**Saldo de partida**: `SALDO_INICIAL_PRESTAMOS_SOCIOS = $14.000.000` en
`src/lib/banco/socios.ts` — la camioneta que los socios financiaron en 2022. Esos
movimientos son anteriores a la app y no están en el banco; sin este número el
saldo arrancaría en cero y mostraría que los socios le deben plata a BLARQ, que
es justo al revés.

Sueldos, retiros y bonos a socios **no** son parte de esta cuenta: no son deuda,
y tienen sus propias categorías (también no operativas).

### B. Reversa por error → "Devolución (neto cero)"

Un pago que salió por error y **volvió entero** (propio o de un cliente). Se
seleccionan los dos movimientos (la salida y la entrada) y se usa la acción
**Resolver → "Devolución (neto cero)"**: quedan emparejados con un
`netZeroGroupId`, status `neto_cero`, y el Estado de Resultado **los ignora**. Es
como si no hubiera pasado nada. Reversible con "Deshacer devolución neto cero".

Ya funcionaba; no se tocó.

### C. Sobrepago sobre una factura → pendiente

Un cobro/pago que excede la factura y cuyo **excedente** se devuelve. Va en las
dos direcciones: el cliente paga de más y se le devuelve, o BLARQ le paga de más
a un proveedor y le devuelven. La parte de la factura se concilia bien (esa sí es
venta o gasto real), pero el **excedente y su devolución quedan en "No asignado"**:
netean en el total, pero sueltos.

**No está resuelto.** Hoy el sistema rechaza marcarlos como neto cero
(*"Algún movimiento ya está conciliado a una factura"*), justamente porque el
movimiento grande ya está pegado a su factura, que es lo correcto. Falta poder
marcar como neto cero **solo el excedente** de un movimiento ya conciliado.

## Alternativas descartadas

- **Dos categorías "Préstamo" y "Devolución"** (primer intento, PR #306) — el
  usuario marcaba explícitamente cada movimiento. Descartada: obligaba a
  re-etiquetar todos los movimientos viejos, y la etiqueta no aportaba nada que
  el signo no dijera ya. Más piezas para el mismo resultado.
- **Dos relaciones `prestamo_socio` / `adelanto_socio`** (segundo intento, mismo
  PR) — según quién fuera el que presta. Descartada por lo mismo: el saldo se
  calcula igual sumando con signo, sin necesidad de saber quién prestó.
- **Saldo separado por socio** — se descartó por ahora (decisión de MJ: "no lo
  separaría"). La columna `BankMovement.socioRut` queda en el schema, vacía y
  documentada como reservada, por si más adelante se quiere abrir.
- **Perseguir los movimientos del préstamo original de 2022** para que el saldo
  netee solo. Descartada: son anteriores a la app. Se reemplaza por un único
  número de partida, que además se corrige en una línea.

## Consecuencias

- **Positivas**: la utilidad deja de comerse los préstamos (se corrigieron
  $500.000 que restaban como gasto). El saldo con los socios se lee en un número
  y se puede auditar (el recuadro muestra partida / entró / salió). Menos
  categorías que mantener y menos decisiones al catalogar.
- **Costos / contras**: el saldo depende de un número de partida cargado a mano.
  Si la camioneta no fueron $14.000.000 exactos, el saldo queda corrido en esa
  diferencia (se corrige en una línea).
- **Deuda generada**:
  - **Familia C sin resolver** — falta el "neto cero parcial" sobre el excedente
    de un movimiento ya conciliado.
  - **Datos por revisar** — al 2026-07-18 la cuenta da $14.000.000 − $22.149.894
    = **−$8.149.894** ("los socios le deben a BLARQ"), que no es real: unos $8,1M
    de los movimientos marcados como préstamo son probablemente **sueldos o
    retiros mal etiquetados**. Las devoluciones reales deberían sumar ~$14M. El
    recuadro avisa en ámbar cuando el saldo se da vuelta. Lo revisa MJ.

## Referencias

- PRs: #306 (primer intento, superado), #307 (modelo final).
- Archivos: `src/lib/banco/socios.ts` (categoría y saldo de partida),
  `src/lib/dashboard/estadoResultadoCaja.ts` (`computeSaldoPrestamosSocios`,
  ruteo a no operativo), `src/components/dashboard/EstadoResultadoChart.tsx`
  (recuadro), `src/app/api/banco/movimientos/bulk/route.ts` (neto cero).
- El reembolso a un socio que adelantó un gasto de su bolsillo **no** pasa por
  acá: se resuelve conciliando el egreso contra la factura del proveedor y queda
  como gasto de operación (PR #239).
