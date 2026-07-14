# ADR — Repartir la obra entre varios maestros: partidas por maestro + EPs por maestro

- **Fecha**: 2026-07-14
- **Estado**: aceptado (diseño Fase 0 — construcción pendiente)
- **Autor**: MJ, con diseño asistido en sesión Claude Code (rama `feat/maestros-por-partida`)

## Contexto

En una obra hay **varios contratistas/maestros**: uno hace la obra gruesa, otro el
porcelanato, etc. (caso real: Paseo del Sena). Hoy la app asume **un solo maestro por
obra** — se asigna a nivel del presupuesto (`Project.maestroId`), la partida (`ObraItem`)
no sabe de qué maestro es (solo tiene `descriptionMaestro`), y el sistema de Estados de
Pago lleva **una sola serie por obra** que mezcla a todos.

MJ necesita dos cosas:
1. Darle a cada maestro **su alcance** (solo sus partidas), sin duplicar versiones a mano.
2. Lo más importante: llevar **Estados de Pago y avances POR MAESTRO** durante toda la obra
   — entregar y pagar a cada uno por separado, midiendo cuánto lleva ejecutado cada uno.

## Decisión

### Modelo de datos (fuente de verdad: una partida = un maestro)

- **Cada partida guarda su maestro** — se agrega `ObraItem.maestroId` (opcional). Una partida
  pertenece a **un solo** maestro (es un contratista el que la ejecuta). `null` = sin asignar.
- **Cada maestro lleva su propia serie de EPs** (Opción B, ver abajo) — se agrega
  `EstadoPago.maestroId` (opcional, `null` = EPs legacy de obra completa). La numeración
  correlativa pasa a ser **por (proyecto, maestro)**: cada maestro tiene su EP 1, 2, 3…
- Los EPs de un maestro contienen **solo las partidas de ese maestro**. El resto del motor de
  EPs (acumuladores por `lineageId`, `quantityExecuted` como base, `amountPaid` congelado al
  cerrar) queda **igual** — al filtrar los items por maestro, los acumuladores ya quedan
  naturalmente separados por maestro.

### UX de asignación (definida con MJ — NO ensucia el editor de presupuesto)

El editor de obra (`ObraEditor.tsx`) **queda igual**, sin columna de maestro. La asignación
vive del lado del maestro:

1. En la obra hay una zona **"Maestros"**: se listan los maestros que trabajan + un cajón
   **"Sin asignar"** con las partidas que nadie tomó.
2. Al entrar a un maestro → **"Sus partidas"**: checklist de todas las partidas de la obra;
   MJ tilda las suyas. Tildar una se la quita a cualquier otro maestro (exclusividad).
3. **"Seleccionar todo / Deseleccionar todo"** en el checklist — para el maestro que tiene
   casi todo, se tilda todo y se destildan las 3-4 que no van (pedido explícito de MJ).
4. Las no tildadas quedan en **"Sin asignar"** (elección de MJ: quedan aparte, fuera de todo
   EP hasta repartirlas — NO caen a un maestro "principal" por default).

### Salidas

- **PDF de alcance por maestro**: sale de la misma base. `ObraMaestroPDF.html.ts` +
  `presupuestos/[id]/maestro/route.ts` filtran `obraItems` por `maestroId` y agregan el
  selector de maestro al exportar. Sin precios (como hoy).
- **EP por maestro**: PDF y editor del EP muestran el nombre del maestro y solo sus partidas.

### Lo que NO cambia

No toca el precio al cliente, los totales del presupuesto, ni `metrics.ts`. Es cómo se
divide y se paga la mano de obra, no cuánto vale.

## Alternativas descartadas

- **Opción A — un solo EP por obra, filtrado por maestro al ver/imprimir.** Más simple y
  cambio chico, pero los maestros avanzan "en el mismo EP": no se puede cerrar y pagarle a
  uno sin cerrarle al otro. Descartada porque es justo lo que MJ necesita hacer (entregar y
  pagar por separado).
- **Columna "Maestro" en el editor de presupuesto (dropdown por partida).** Descartada por
  MJ: mete demasiada información en la pantalla principal del presupuesto. Se reemplazó por
  el selector de partidas desde el maestro (mismo dato `ObraItem.maestroId` por debajo, otro
  punto de entrada en la UI).
- **Asignar por capítulo.** No sirve para Sena: los retiros del porcelanato (1.3/1.5/1.7/1.8)
  viven en el capítulo 1 junto a partidas del maestro de obra.
- **Tabla intermedia maestro↔partidas (muchos a muchos).** Permitiría una partida en varios
  maestros, pero no es la realidad (una partida la ejecuta un maestro) y complica el avance
  (¿quién ejecutó?). Se prefiere `ObraItem.maestroId` único.

## Consecuencias

- **Positivas**: entregar/pagar por maestro de verdad; alcance limpio por contratista sin
  duplicar versiones; presupuesto sin ruido nuevo.
- **Costos / contras**: es el cambio grande — toca schema (2 columnas nuevas), creación de
  EP, numeración correlativa (de `[projectId, number]` a `[projectId, maestroId, number]`),
  UI nueva (zona Maestros + selector de partidas), y el filtrado del PDF de alcance.
- **Deuda / límite conocido**: una partida es de **un solo** maestro. Si un mismo trabajo lo
  comparten dos (uno hace la mitad), no está cubierto — habría que partir la partida en dos.
  Para Sena no hace falta.
- **Migración prod**: la(s) columna(s) nueva(s) se aplican con ALTER quirúrgico sobre la base
  viva `ep-shy-morning`, confirmado con MJ (§4.7 / §4.9), NO con `db push` a ciegas
  (ver gotcha en catálogo). EPs y proyectos existentes quedan con `maestroId = null`
  (comportamiento actual intacto).

## Plan de construcción (dos etapas, sesión aparte)

1. **Base**: `ObraItem.maestroId` + zona "Maestros" + selector de partidas (con seleccionar
   todo) + "Sin asignar" + PDF de alcance filtrado. Ya entrega valor solo.
2. **EPs por maestro**: `EstadoPago.maestroId`, numeración por maestro, creación de EP que
   snapshotea solo las partidas del maestro, editor/PDF del EP por maestro.

Caso de prueba (Sena): maestro obra = todo menos porcelanato; maestro porcelanato =
instalación pavimento 5.1/5.8 + instalación revestimiento 5.9 + retiros 1.3/1.5/1.7/1.8.

## Referencias

- Archivos que tocará: `prisma/schema.prisma` (`ObraItem`, `EstadoPago`, `Maestro`),
  `src/components/estadosPago/EditorEP.tsx`, `src/lib/ep/{calculations,snapshot,sync}.ts`,
  `src/app/api/proyectos/[id]/estados-pago/route.ts`,
  `src/app/api/estados-pago/[id]/**`, `src/lib/pdf/ObraMaestroPDF.html.ts`,
  `src/app/api/presupuestos/[id]/maestro/route.ts`, `src/components/presupuesto/ObraEditor.tsx`.
- Rama de diseño: `feat/maestros-por-partida`.
