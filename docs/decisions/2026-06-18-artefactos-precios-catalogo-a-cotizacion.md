# ADR — Precios de artefactos: el catálogo baja a las cotizaciones (no al revés)

- **Fecha**: 2026-06-18
- **Estado**: aceptado
- **Autor**: MJ (decisión de negocio), implementado con Claude Code.

## Contexto

Hasta hoy el flujo de precios de artefactos estaba **invertido** respecto de cómo
MJ piensa el presupuesto:

- El catálogo NO bajaba a las cotizaciones en borrador. Al agregar un artefacto
  del catálogo, la cotización **copiaba** el precio (snapshot) y se quedaba con su
  copia; cambiar el precio maestro después no actualizaba los borradores.
  (`AddArtefactoFromCatalog.tsx` + `ArtefactosEditor.tsx`.)
- Editar a mano una línea con `catalogId` dentro de una cotización **SÍ subía al
  catálogo global** y lo pisaba para todos los próximos proyectos. El botón
  "Revisar precios online" dentro de la cotización pasaba por el mismo PUT, así
  que también subía. (`/api/presupuestos/[id]/artefactos/[itemId]` PUT.)

MJ quiere lo contrario, y que funcione como el presupuesto de obra: el maestro
manda sobre los borradores, y un descuento puntual a una clienta queda solo en su
cotización.

## Decisión

1. **El catálogo es el precio MAESTRO y baja a los borradores.** Al editar un item
   del catálogo (a mano o aplicando "Revisar precios"), el cambio se propaga a las
   líneas de cotización que: apuntan a ese item (`catalogId`), no fueron editadas a
   mano (`priceOverridden = false`) y están en **borrador**. Las enviadas/aprobadas
   y las despegadas no se tocan. (`propagateCatalogToBorradores` en
   `src/lib/catalog/syncArtefactos.ts`, llamada desde el PUT del catálogo.)

2. **Editar una línea dentro de una cotización la "DESPEGA".** Se agregó el flag
   `ArtefactoItem.priceOverridden` (default `false`), equivalente por línea de
   `ObraItem.isCustomized`. Cuando MJ edita un campo que viene del catálogo
   (precio, descuento, precio cliente, nombre, detalle, marca, link, foto) la línea
   pasa a `priceOverridden = true` y el catálogo no la vuelve a pisar nunca. Cambiar
   solo cantidad / ambiente / orden NO despega. La detección compara contra el valor
   guardado (`editoCampoDeCatalogo`), porque el editor manda la fila completa.

3. **Editar dentro de una cotización ya NO sube al catálogo.** Se eliminó el
   `prisma.artefactoCatalog.update` del PUT de la línea. Para cambiar el precio
   maestro se edita desde /catálogo. El botón "Revisar precios online" de la
   cotización ahora actualiza solo esa cotización (y despega esas líneas).

4. **Congelado de las enviadas** = lo da el estado (el catálogo solo toca
   borradores), igual que en obra. Además se activó **"Volver a lo enviado" para
   artefactos** (`restoreArtefactosFromSnapshot`), antes solo disponible para obra.

## Alternativas descartadas

- **Alinear artefactos con la regla de obra (catálogo opt-in, no propaga solo).**
  En obra el catálogo NO baja automáticamente: cada cambio se aplica a mano y las
  partidas heredadas de una versión enviada quedan congeladas por `lineageId`. Para
  artefactos MJ pidió EXPRESAMENTE lo contrario (que el maestro baje solo a los
  borradores). Es una diferencia consciente, no un descuido — por eso este ADR.
- **Congelar por `lineageId` como obra.** Los `ArtefactoItem` no tienen `lineageId`
  ni se versionan partida-a-partida; el congelado por estado (borrador vs
  enviado/aprobado) alcanza y es más simple.
- **Mantener que editar la cotización suba al catálogo, con un toggle opt-in.**
  Descartado por MJ: el catálogo se edita desde /catálogo y punto.

## Consecuencias

- **Positivas**: el precio maestro se cambia en un solo lugar y baja solo a los
  borradores; un descuento puntual no contamina el catálogo ni otras cotizaciones;
  lo enviado al cliente queda inmutable.
- **Costos / contras**: a partir de ahora, tocar el catálogo PUEDE mover el
  "Total acordado" de un proyecto si su cotización de artefactos vigente es un
  borrador (es justamente lo deseado). Es esperable, no un bug.
- **Deuda generada**: el editor no muestra todavía un indicador visual de "línea
  despegada"; la lógica funciona sin él. Restaurar muebles desde la foto sigue
  pendiente (solo obra y artefactos lo tienen).

## Verificación (regla §4.1)

- Snapshot de totales de todas las cotizaciones de artefactos ANTES/DESPUÉS:
  idéntico (`scripts/snapshot-artefactos-totales.ts`). Agregar la columna no movió
  ningún total.
- Test de integración contra la base dev, 10/10 OK
  (`scripts/test-artefactos-propagacion.ts`): los 3 casos + detección de despegue +
  "volver a lo enviado".
- Verificación visual en vivo (Chrome de MJ, dev): editar el catálogo a $130.000
  actualizó la línea no tocada del borrador, dejó la despegada en $80.000 y la
  enviada en $100.000.

## Referencias

- Archivos: `src/lib/catalog/syncArtefactos.ts`, `src/lib/catalog/budgetSnapshot.ts`,
  `src/app/api/catalogo/artefactos/[id]/route.ts`,
  `src/app/api/presupuestos/[id]/artefactos/[itemId]/route.ts`,
  `src/app/api/presupuestos/[id]/restaurar-enviado/route.ts`,
  `prisma/schema.prisma` (`ArtefactoItem.priceOverridden`).
- ADRs relacionados: `2026-05-14-catalogo-artefactos-y-sincronizacion.md`,
  `2026-05-15-sync-diferencial-cotizacion-catalogo.md` (la regla de obra que acá NO
  se replica a propósito).
