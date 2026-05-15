# ADR — Sync diferencial cotización ↔ catálogo con regla contractual

- **Fecha**: 2026-05-15
- **Estado**: aceptado
- **Autor**: MJ (planteamiento del problema y regla contractual), implementación en PR #31

## Contexto

Hasta el 2026-05-13 (ronda anterior), el sync entre catálogo y presupuestos solo cubría **actualizaciones de precios de materiales**. Cuando MJ:

1. Agregaba un componente nuevo a una partida del catálogo, o
2. Borraba un componente,

los presupuestos en borrador no se actualizaban. El botón "Actualizar" del banner amarillo solo recalculaba componentes ya existentes con su `MaterialCatalog`, no detectaba faltantes ni huérfanos.

Caso real disparador (2026-05-15): MJ agrega "FLEXIBLE GAS 1MT HI-HI1/2" al catálogo de la partida "INSTALACION ENCIMERA GAS", abre la cotización de "Paseo del Sena", aprieta refrescar, y no pasa nada.

Además, el flag `ObraItem.isCustomized` era demasiado grueso: cualquier edición a un componente individual marcaba la partida entera como customizada y la blindaba del sync. MJ pidió granularidad fina — editar la mano de obra del maestro no debería bloquear los materiales.

Por último, MJ planteó una regla contractual no implementada: una partida que ya viajó a un cliente en una versión enviada/aprobada NO puede modificarse automáticamente, aunque después se abra una V2 en borrador. Cambiarle el costo "por actualización" sin que el cliente lo sepa es inaceptable.

## Decisión

Se implementa un **sync diferencial completo** entre `PartidaCatalog` y los `ObraItem` derivados, con tres reglas de blindaje:

1. **Granularidad fina**: editar/agregar un componente puntual blinda solo ese componente (`ObraItemComponent.isCustomized=true`), no la partida entera. Borrar un componente registra un descarte intencional en una tabla nueva (`ObraItemDiscardedCatalogComponent`) para que el sync no lo recree.
2. **Diff completo (`syncBudgetWithCatalog`)**: agrega componentes faltantes del catálogo, actualiza los stale, borra los huérfanos (cuyo origen ya no existe en el catálogo), respetando los componentes customizados y los descartados intencionalmente.
3. **Regla contractual MJ 2026-05-15**: una partida con `lineageId` presente en una versión enviada/aprobada del mismo proyecto+tipo queda blindada — el sync no la toca, aunque su versión actual sea borrador. Las partidas con `lineageId` nuevo (creadas en esta versión, no heredadas) sí se sincronizan.

Schema (aditivo, aplicado en dev y prod):

- `ObraItemComponent.originComponentId` (FK opcional a `PartidaComponent`) — habilita matching exacto entre catálogo y cotización.
- `ObraItemDiscardedCatalogComponent` (nueva tabla, `obraItemId` + `partidaComponentId` con índice único) — registra borrados intencionales.

Backfill: `scripts/backfill-origin-component-id.ts` pobló `originComponentId` para data anterior al 2026-05-15. En prod mapeó 1562 de 1625 componentes (96%); los 63 sin match están protegidos contra duplicación por una guarda defensiva en el sync (si todos los componentes de un `ObraItem` están unmapped, el sync no agrega ni borra para evitar duplicados; al agregar, un loose match por `type+description+unit+materialId` previene reintroducir componentes ya presentes).

Helper compartido: `src/lib/catalog/frozenLineage.ts` centraliza la lógica de "qué lineageIds están congelados por contrato", usado por `syncBudgetWithCatalog`, `syncMaterial` (propagación a borradores), el PUT del catálogo de partidas, y la segunda pasada del endpoint `/api/catalogo/auditoria-precios/sync`.

## Alternativas descartadas

- **Sync solo manual por partida** (un botón "Refrescar esta partida desde catálogo" en cada fila): demasiado fricción para casos comunes; obliga a MJ a recordar qué partidas modificó. Descartado, el sync masivo respetando blindajes individuales es más práctico.
- **Marcar partida entera como custom al editar cualquier componente** (regla vieja): demasiado grueso. Si MJ paga más al maestro en una partida, no quiere quedar sin sync de los materiales. Reemplazado por granularidad por componente.
- **Borrados desde catálogo NO propagan** (Opción B planteada el 2026-05-15): MJ rechazó. Su razón: "si borré en catálogo es porque quiero declararlo un cambio para todo". Se elige Opción A (propagar borrados), salvo si el componente está customizado o la partida tiene lineage congelado.
- **Detectar `originComponentId` por matching loose en runtime** en vez de FK: frágil ante renames. Se prefirió FK + backfill + guarda para los casos que el backfill no mapeó.

## Consecuencias

- **Positivas**:
  - El flujo "modifico el catálogo, recargo la cotización en borrador, aprieto Actualizar, se baja el cambio" ahora funciona end-to-end para precios, descripciones, agregados y eliminados de componentes.
  - Cotizaciones enviadas quedan blindadas por contrato, incluso si la V2 está en borrador para agregar nuevas partidas.
  - Granularidad fina permite blindar decisiones específicas (más MO al maestro) sin perder sync de los demás componentes.
- **Costos / contras**:
  - Una tabla nueva y una columna nueva para mantener.
  - El helper `frozenLineage.ts` tiene un cache por proceso — si dos requests concurrentes leen estados diferentes, podrían divergir. En la práctica el riesgo es bajo (Vercel serverless, cada request tiene cache propio).
  - El backfill no es 100%: 63 componentes en prod quedan sin `originComponentId` (ambiguos por matching o sin coincidencia). No se rompen, pero esos componentes específicos no participan del sync diferencial — funcionan como antes (solo se sincronizan precios de materiales si están linkeados a `MaterialCatalog`).
- **Deuda generada**:
  - Si en una sesión futura MJ corre el backfill de nuevo con criterio más agresivo (ej: matching por similitud), debería invalidar la guarda `legacyUnmapped`.
  - Eventualmente conviene mover la "regla contractual" al schema (constraint o trigger), no solo al código.

## Referencias

- Commit: `d28fe6d` (PR #31 mergeado a main 2026-05-15).
- Archivos clave:
  - `src/lib/catalog/syncBudgetWithCatalog.ts` (función nueva).
  - `src/lib/catalog/frozenLineage.ts` (helper compartido).
  - `src/app/api/catalogo/auditoria-precios/route.ts` (banner amarillo cuenta también faltantes/huérfanos).
  - `src/app/api/catalogo/auditoria-precios/sync/route.ts` (botón "Actualizar" hace diff completo).
  - `scripts/backfill-origin-component-id.ts` (backfill idempotente).
  - `prisma/schema.prisma` — `ObraItemComponent.originComponentId`, `ObraItemDiscardedCatalogComponent`.
- Conversación: chat de Claude Code del 2026-05-15 (sesión `funny-edison-455814`).
