# ADR — Cantidad ejecutada (no porcentaje) como verdad financiera en EPs

- **Fecha**: 2026-04-26
- **Estado**: aceptado
- **Autor**: MJ + Claude, sesión `7d005099`.

## Contexto

El Estado de Pago (EP) es el documento periódico que BLARQ paga al maestro contra avance. La pregunta de modelado: ¿qué se almacena por partida?

- **Opción A**: porcentaje de avance (`percent: 0-100`).
- **Opción B**: cantidad ejecutada acumulada (`quantityExecuted: number`).

El issue es qué pasa si el presupuesto cambia mid-project (V3→V4, típico cuando el cliente agrega/saca partidas o cambia cantidades):

- Si guardás **%**: una partida que estaba al 50% (ej: 50 m² de 100) sigue al 50%, pero ahora 50% son 60 m² porque el cliente agregó 20 m². ¿Pagamos al maestro como si hubiera hecho 60 cuando hizo 50? Conflicto.
- Si guardás **cantidad ejecutada**: el dato es verificable en obra (50 m² hechos son 50 m² hechos, sin importar cuánto pueda haber al final). El % se calcula a posteriori.

Análisis de los 5 EPs reales del proyecto Portofino mostró además otro patrón: el Excel de BLARQ **recalcula retroactivo** cuando cambia el P.U. mid-project. Si el P.U. de "1.3 RETIRO PISO" pasa de $3.000 a $6.000 en EP2, el "$ a pagar" cumulative del Excel sube como si el precio hubiese sido $6.000 desde el inicio.

MJ definió que la app **no debe replicar este recálculo retroactivo** — debe preservar montos ya pagados al precio viejo. Por eso `amountPaid` se snapshotea inmutable al cerrar el EP.

## Decisión

Modelo:

```prisma
model EstadoPagoItem {
  quantityExecuted Float       // cantidad acumulada al cierre de este EP
  amountPaid       Float       // snapshot inmutable al cerrar (cantidad × P.U. del EP)
  lineageId        String      // identidad estable de la partida a través de versiones
  // ...
}
```

- **`quantityExecuted` es la verdad financiera**. La UI muestra `%` como input cómodo, pero internamente se convierte a cantidad antes de guardar.
- Al **cerrar un EP** (`status = 'cerrado'`), `amountPaid` queda snapshot inmutable (cantidad ejecutada del delta × P.U. vigente).
- **No hay recálculo retroactivo**: si el P.U. cambia en V4, los pagos pasados al precio V3 se mantienen. La diferencia se aplica solo a cantidad nueva.
- `lineageId` permite identidad estable: si un item se renumera o el catálogo cambia su `obraItemId`, el EP sigue vinculado a la partida correcta.

## Alternativas descartadas

- **Guardar % puro**. Frágil ante cambios de cantidad en versiones nuevas.
- **Replicar el recálculo retroactivo del Excel**. MJ explícitamente lo rechazó: prefiere preservar montos pagados (Caso 4 del spec original).
- **Snapshotear cantidad pero no monto**. El monto en BD permitiría recalcular siempre con el P.U. vigente. Rechazado: implica que un cambio de P.U. mid-project altera retroactivamente lo que se ya se le pagó al maestro en su recibo. Confuso y peligroso.

## Consecuencias

**Positivas**:
- 26 tests unitarios sobre la lógica pura (`scripts/test-ep-calculations.ts`) cubren los casos.
- Auditable: cada EP cerrado tiene un monto fijo verificable contra el documento que se le entregó al maestro.
- El sync entre EPs y versiones de presupuesto matchea por `lineageId`, sobreviviendo cambios de orden o renumeración.

**Costos / contras**:
- Si MJ decide en el futuro que prefiere el modelo del Excel (recálculo retroactivo), hay que cambiar la lógica de close + sync para no snapshotear `amountPaid` (o snapshotearlo en cantidad, no en dinero). No es trivial.
- La UI tiene una capa de conversión % ↔ cantidad que requiere cuidado al editar.

**Deuda generada**: ninguna — la lógica está cubierta por tests.

## Referencias

- Commits relacionados: implementación EP Phase 1 + sync (sesión 2026-04-26).
- Test suite: `scripts/test-ep-calculations.ts` (26 asserts).
- Editor: `src/components/ep/EditorEP.tsx`.
- API: `POST /api/proyectos/[id]/estados-pago` (hereda quantityExecuted de EPs cerrados via lineageId).
- Schema: `EstadoPagoItem` en `prisma/schema.prisma`.
