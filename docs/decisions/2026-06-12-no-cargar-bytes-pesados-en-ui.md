# ADR — No cargar campos Bytes pesados (`pdfContent`) en queries de UI

- **Fecha**: 2026-06-12
- **Estado**: aceptado
- **Autor**: MJ (a partir de la auditoría de rendimiento) + Claude Code

## Contexto

La app se sentía lenta al navegar. Una auditoría de rendimiento (2026-06-12, ver `docs/WIP.md`) encontró como causa crítica que las pantallas principales —Dashboard (`/`), `/proyectos`, `/cotizaciones` y `/proyectos/[id]/resumen`— traían el campo `Invoice.pdfContent` de **todas** las facturas en cada carga.

`pdfContent` (Bytes) es el PDF oficial del SII cacheado en la BD vía el sync local con cert digital (~100-200 KB por factura). Esas pantallas no muestran el PDF ni lo usan en ningún cálculo: `computeProjectMetrics` (`src/lib/projects/metrics.ts`) nunca lo lee. Resultado: cada carga del Dashboard descargaba decenas/cientos de MB desde Neon y los descartaba. Medido en dev: un solo proyecto (Francisco de Aguirre, 153 facturas) arrastraba 22,7 MB; el Dashboard carga **todos** los proyectos en ejecución a la vez.

La regla "nunca cargar `pdfContent` en queries de UI" ya existía, pero solo como conocimiento tribal: un comentario en `prisma/schema.prisma` y una nota en `docs/architecture.md`. `/facturas` la respetaba (`omit: { pdfContent: true }`), pero el include de métricas y el Resumen no — y nadie lo notó hasta que apareció la lentitud. Una regla que vive solo en comentarios se rompe.

## Decisión

Toda query que alimente la UI **excluye `pdfContent`** (y cualquier futuro campo Bytes pesado equivalente). La única excepción es el código que efectivamente sirve el PDF: el endpoint `api/facturas/[id]/pdf/route.tsx` y la ficha de factura individual (`facturas/[id]/page.tsx`, que lo carga server-only para pasarlo al endpoint).

**Implementación de hoy (la mínima):** `omit: { pdfContent: true }` en dos lugares —

- `PROJECT_METRICS_INCLUDE` en `src/lib/projects/metrics.ts` (cubre Dashboard, `/proyectos`, `/cotizaciones`).
- la query del Resumen en `src/app/(dashboard)/proyectos/[id]/resumen/page.tsx`.

No cambia ningún cálculo: verificado cargando los mismos proyectos con y sin el campo, `computeProjectMetrics` da gastado/vendido/avance/utilidad idénticos.

**Recomendación a futuro (no implementada hoy):** migrar al `omit` **global** del cliente Prisma —

```ts
new PrismaClient({ omit: { invoice: { pdfContent: true } } })
```

en `src/lib/prisma.ts`. Eso excluye `pdfContent` por defecto en **toda** la app de una sola vez, y obliga a las pocas excepciones (endpoint del PDF, ficha individual) a pedirlo explícito. Convierte la regla "acordate de excluirlo en cada query" en "está excluido salvo que lo pidas", que es a prueba de olvidos. Queda como tarea para una sesión futura porque requiere tocar la ficha de factura individual para que vuelva a pedir el campo, y reprobar que el PDF oficial siga abriendo.

## Alternativas descartadas

- **`select` con lista blanca de campos** — explícito, pero frágil: cada campo nuevo del modelo hay que acordarse de agregarlo o desaparece de la UI sin aviso. `omit` ("todo menos esto") evita ese modo de falla.
- **No hacer nada / dejarlo como comentario** — es lo que ya había, y se rompió. Descartado: la regla necesita estar en el código (omit), no solo en la documentación.
- **`omit` global ahora mismo** — es la mejor opción de fondo (ver Decisión), pero excede el alcance acordado para la sesión del fix ("un solo cambio, sin refactorizar de más") y toca la ficha de factura individual. Se difiere, no se descarta.

## Consecuencias

- **Positivas**: Dashboard, `/proyectos`, `/cotizaciones` y Resumen dejan de transferir el PDF crudo. Ahorro de la mayor parte del payload de esas pantallas, sin ningún cambio en los números.
- **Costos / contras**: con la implementación por-query (la de hoy), cada query nueva que traiga facturas tiene que acordarse del `omit`. Esa deuda se salda con la migración al omit global.
- **Deuda generada**: tarea futura — migrar a `omit` global en `src/lib/prisma.ts` y ajustar las excepciones (ficha de factura individual). Mientras tanto, cualquier query de UI nueva sobre `Invoice` debe incluir `omit: { pdfContent: true }`.

## Referencias

- Commit del fix: `perf(metrics): excluir pdfContent de las queries de métricas`.
- Archivos: `src/lib/projects/metrics.ts`, `src/app/(dashboard)/proyectos/[id]/resumen/page.tsx`, `src/app/(dashboard)/facturas/page.tsx` (patrón previo), `prisma/schema.prisma` (campo `pdfContent` y su comentario).
- Auditoría que lo originó: entrada de `docs/WIP.md` del 2026-06-12.
- ADR relacionado: `2026-05-30-metrics-no-filtra-anuladas.md` (otra regla sobre el alcance de `metrics.ts`).
