# ADR — metrics.ts no filtra facturas anuladas: el total queda bien por disciplina de la NC

- **Fecha**: 2026-05-30
- **Estado**: aceptado (registro de riesgo; sin cambio de código aún)
- **Autor**: MJ + análisis de sesión (comparación Sodimac Maxxa vs app, ronda 35)

## Contexto

Comparando la conciliación de Maxxa contra la app aparecieron facturas con `status="anulada"` que igual tenían pago conciliado. Al revisar `src/lib/projects/metrics.ts` se vio que el gasto del proyecto se calcula filtrando **solo por tipo** (`type === "recibida"`), sin excluir el estado: una factura anulada se suma igual al `totalGastado`.

En los datos de hoy hay 17 facturas recibidas anuladas con proyecto asignado, que suman $18,4M neto entrando al gasto. La pregunta era si eso infla los totales.

**No los infla.** Las 17 tienen su nota de crédito (DTE 61) que las referencia, y `metrics.ts` aplica `sign = -1` a las NC (DTE 61). Entonces, por cada anulada: `+factura − NC = 0` neto. El total queda correcto, pero **no porque el cálculo excluya las anuladas, sino porque siempre existe la NC que las compensa**.

## Decisión

Por ahora **no se toca `metrics.ts`** — los totales están correctos hoy (17/17 anuladas con NC) y `metrics.ts` es el archivo contable más sensible del repo (§4.1: requiere snapshot pre/post). Se deja registrado el riesgo y la defensa futura.

**Defensa futura simple** (cuando se entre a tocar `metrics.ts` por otra razón, o si aparece una anulada sin NC): excluir `status === "anulada"` del cómputo de gastado (las dos sumas de recibidas: `totalRecibidoFacturas` neto y `totalRecibidoFacturasConIva`). Con eso el total no depende de que la NC exista. Cualquier cambio así exige snapshot pre/post de los proyectos afectados (§4.1) y confirmar que ninguna anulada-con-NC mueva su total (deberían cancelarse: dejar de sumar la anulada y dejar de restar la NC).

## Alternativas descartadas

- **Filtrar anuladas ahora mismo** — descartada por ahora: cambio al archivo contable sin necesidad inmediata (totales ya correctos). Se hace cuando haya que tocar `metrics.ts` igual, o si entra una anulada sin NC.
- **Borrar / no importar las facturas anuladas** — descartada: la anulada y su NC son parte del historial tributario real; borrarlas perdería trazabilidad y podría descuadrar contra el SII/Maxxa.

## Consecuencias

- **Positivas**: queda documentado por qué los totales son correctos pese a que el cálculo no filtra anuladas, y cuál es el arreglo si alguna vez deja de cumplirse.
- **Costos / contras**: el total de gasto depende de una invariante implícita ("toda anulada tiene su NC cargada"). Si se anula una factura y no se carga la NC correspondiente, esa anulada quedaría sumando de más sin que nadie lo note.
- **Deuda generada**: ítem de backlog — filtrar `status="anulada"` en el gastado de `metrics.ts` (con snapshot §4.1). No urgente.

## Referencias

- Archivos del repo: `src/lib/projects/metrics.ts` (cómputo de `totalRecibidoFacturas` / `totalGastado`, filtro `type === "recibida"` sin estado; `sign` para DTE 61).
- Análisis: ronda 35 en `docs/WIP.md`.
- Entregable de la sesión: `~/Downloads/Analisis_Sodimac_2026-05-30.xlsx`.
