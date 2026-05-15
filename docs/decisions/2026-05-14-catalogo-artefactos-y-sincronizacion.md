# ADR — Catálogo BLARQ de artefactos + sincronización entre copias

- **Fecha**: 2026-05-14
- **Estado**: aceptado
- **Autor**: MJ

## Contexto

MJ cotiza obra, muebles y artefactos. Para artefactos, repite items entre proyectos (mismos WCs, griferías, accesorios). Antes de esta sesión, cada cotización empezaba desde cero — tipeaba name, marca, precio, descuento, link, imagen item por item, incluso si era el mismo WC ATENAS que usó la semana pasada. Síntomas:

- Tiempo perdido en data entry repetido.
- Inconsistencia entre proyectos (precio viejo en un proyecto, nuevo en otro).
- Precios desactualizados al cotizar (riesgo de pricing equivocado).

Además, el flujo real de MJ tiene dos precios distintos por item:

1. **Precio lista + descuento "web"** (el que ve el cliente, sale del sitio del proveedor).
2. **Precio interno BLARQ** (`realCostBlarq`): cotización privada que le pasa su vendedora, con descuentos específicos. Varía proyecto a proyecto según la negociación.

## Decisión

**Catálogo BLARQ global de artefactos** (tabla `ArtefactoCatalog`) + **sincronización automática** entre copias del mismo `catalogId`.

Cuando MJ promueve un item a catálogo (estrella ★ en el editor) o lo crea desde `/catalogo/artefactos`, queda como referencia central. Los items del presupuesto que apuntan a un catalogId quedan "vinculados" — al editar un campo, se propaga.

**Scope de sincronización por campo**:

| Campo | Otras copias del MISMO budget | Catálogo BLARQ global |
|---|---|---|
| name, detail, brand | ✓ | ✓ |
| listPrice, discountPercent (web) | ✓ | ✓ |
| clientPrice | ✓ | ✓ |
| referenceLink, imageUrl | ✓ | ✓ |
| **realCostBlarq** (cotización privada) | ✓ | ✗ |
| quantity, room, subcategory, sortOrder | ✗ | ✗ |

`realCostBlarq` se sincroniza solo dentro del budget (porque la cotización de la vendedora es por proyecto) pero **no** sube al catálogo global (porque pisaría costos válidos de otros proyectos).

Implementado en:

- Backend: `src/app/api/presupuestos/[id]/artefactos/[itemId]/route.ts` (PUT propaga vía `updateMany` + update del catálogo).
- Frontend: `src/components/presupuesto/ArtefactosEditor.tsx` actualiza el state local para evitar esperar refresh.

## Alternativas descartadas

- **Sin sincronización (estado anterior)**: cada item del budget es independiente. MJ pierde tiempo actualizando precios en cada copia del mismo WC. Descartado por el problema que motivó la decisión.

- **Sincronización opcional con confirmación** (UI que pregunta "¿propagar a las otras copias?" cada vez que MJ edita): más control pero fricción alta. MJ pidió explícitamente "todo se sincroniza siempre". Descartado.

- **Sincronización viva tipo Notion** (cualquier copia es la "fuente", todas reaccionan): no agrega valor sobre lo decidido y complica el modelo mental (¿cuál es el original?).

- **`realCostBlarq` también al catálogo global**: significa que la cotización privada de una vendedora para un proyecto pisaría el costo registrado para los demás. Inaceptable — la cotización varía proyecto a proyecto. Descartado.

## Consecuencias

**Positivas**:

- MJ carga 10-15 items "paleta estándar BLARQ" una vez y los reusa en todos los proyectos.
- Precios del catálogo se actualizan automáticamente cuando MJ cotiza un proyecto nuevo (lo último que ve, queda en el catálogo).
- Mismo WC en 2 baños del mismo proyecto queda consistente sin intervención.
- Cotización privada de vendedora se aplica una sola vez por proyecto y propaga a todas las copias.

**Costos / contras**:

- Cada UPDATE de un item con catalogId dispara 1 update extra al catálogo + 1 updateMany al budget. Performance no es problema mientras los budgets sean < ~200 items.
- Si MJ quiere editar UN item específico sin afectar a las otras copias, no hay UI hoy para "desvincular del catálogo". Workaround actual: borrar y agregar manual sin catalogId.

**Deuda generada**:

- **Botón "desvincular item del catálogo"**: si MJ quiere variar puntualmente un item sin afectar al resto. Pendiente.
- **"Revisar precios actuales" en bulk**: feature siguiente del plan (sesión 3) — recorre items del budget, re-extrae precios actuales de los links y muestra tabla con diferencias para aprobar cambios en bulk.
- **Templates de espacio**: feature de sesión 4 — guardar recetas tipo "Baño con tina 120 + ducha en obra" como listas de itemRefs del catálogo. Acelera el "armar un baño nuevo".

## Referencias

- Commits: PRs #14–#27 mergeados a main el 2026-05-14.
- Archivos clave:
  - `prisma/schema.prisma` (modelos `ArtefactoCatalog` + `ArtefactoItem.catalogId`).
  - `src/lib/import/parseArtefactos.ts` (importador Excel).
  - `src/lib/catalog/fetchArtefactoData.ts` (scraper universal).
  - `src/app/api/catalogo/artefactos/` (CRUD + extract).
  - `src/app/api/presupuestos/[id]/artefactos/[itemId]/route.ts` (PUT con sync).
  - `src/components/presupuesto/ArtefactosEditor.tsx` (editor).
  - `src/components/presupuesto/AddArtefactoFromCatalog.tsx` (buscador del catálogo al agregar item).
  - `src/components/catalogo/ArtefactosCatalogClient.tsx` (página catálogo).
  - `src/lib/pdf/ArtefactosPDF.html.ts` (PDF cliente).
- WIP: ronda 17.
