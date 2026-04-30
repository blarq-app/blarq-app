# Auto-revisión crítica — 28-29 abr 2026

Última revisión de los 14 commits aplicados entre el 28 y el 29 de abril, antes de seguir con conciliación bancaria u otros features.

> **Aviso**: este documento NO suaviza el estado. Si algo está a medias o roto, lo digo claro.

---

## 1. Inventario de cambios recientes

| # | Commit | Qué | Por qué | Estado |
|---|---|---|---|---|
| 1 | `43feb51` | Script `import-maxxa-assignments.ts` (recibidas) | Asignar 122 facturas abril desde el Excel de Maxxa | **completo** |
| 2 | `9265bac` | Correlativos cotización/proyecto + rediseño Dashboard, /cotizaciones, /proyectos | Sistema de numeración paralelo + IA reorganizada | **completo** (revisión 27/4 ya validó) |
| 3 | `1eae536` | Orden lógico (no alfabético) de categorías de partidas | Pedido directo de MJ | **completo** |
| 4 | `7d18977` | Script Maxxa múltiples archivos (recibidas ene-feb-mar) | Importar los 3 meses faltantes | **parcial — duplicado con e1146f2** |
| 5 | `540d582` | EditableCell + PATCH `/api/proyectos/[id]` para edición inline | Editar nombre/cliente sin abrir formulario completo | **completo** |
| 6 | `b10c946` | Import OBRA Portofino V1 + capítulos `obra_gruesa`, `adicionales` | Cargar presupuesto del proyecto Portofino | **completo** |
| 7 | `55aa45f` | Import MUEBLES + ARTEFACTOS Portofino V1 | Idem para muebles/artefactos | **completo** |
| 8 | `c75d334` | Fix IVA: gastado se calcula NETO contra presupuesto neto | Bug detectado por MJ — Subcontrato decía 101% siendo 85% | **completo** |
| 9 | `04cb028` | Etiquetas "c/IVA" / "neto" en cada monto | Para que MJ sepa qué representa cada cifra | **completo** |
| 10 | `c5c6000` | Tabla "Presupuesto vs Real" jerárquica con 3 secciones + total | Reestructuración pedida por MJ — antes era plana | **completo** |
| 11 | `862220a` | Filtros tipo Excel en facturas del proyecto + totales reactivos | Pedido directo de MJ | **completo** |
| 12 | `e1146f2` | Script Maxxa acepta múltiples archivos + auto-crea proyectos | Import emitidas (24 facturas) — auto-crear proyecto 61 | **completo** |
| 13 | `eca4206` | Vista dedicada BLARQ + reagrupar Auto como top con subs | BLARQ no es proyecto, vista distinta | **completo** |
| 14 | `7458824` | EERR estructurado con período + variación vs período anterior | Estilo Chipax/Maxxa para análisis financiero | **completo** |

**A medias**: ninguno técnicamente, pero hay decisiones tomadas sobre la marcha que conviene revisar (ver §4 y §7).

**Branch sin mergear**: `modo-b-emision` (commit `808327e`, 7 archivos nuevos de emisión). Esperando certificación SF.

---

## 2. Coherencia interna de los cambios

### 2A. Coherencia visual

**Lo que mantuvo el sistema**:
- Tablas densas estilo BLARQ (`thead.bg-gray-50` + `divide-y divide-gray-100`) en /facturas, /proyectos, /cotizaciones, Resumen, EERR de BLARQ. ✓
- Tipografía y `tabular-nums` consistentes. ✓
- Hover `bg-gray-50` en filas clickeables. ✓
- `rounded-xl` para containers, `rounded-full` para badges. ✓

**Inconsistencias detectadas**:

⚠ **Banner SII en /facturas sigue MORADO** mientras que en el Dashboard quedó gris con la migración del 27/4.
- `/facturas/page.tsx:94` → `bg-purple-50 border-purple-200 text-purple-900` + `📥` emoji
- `Dashboard:114` → `bg-gray-50 border-gray-200` con icono mono

Esto rompe la regla "no morado" que MJ pidió en el rediseño. Quedó pendiente desde el commit del Dashboard y nunca se corrigió en /facturas.

### 2B. Coherencia de datos

⚠⚠ **CRÍTICO — duplicación de cálculos en `/proyectos/[id]/resumen/page.tsx`**

El page.tsx **NO usa** `computeProjectMetrics()` de `src/lib/projects/metrics.ts`. Recalcula independientemente:

| Cálculo | Lugares que lo computan |
|---|---|
| `realByCategory` / "Real" del EERR | `metrics.ts:184` **y** `resumen/page.tsx:135` |
| `totalGastado` (recibidas neto) | `metrics.ts:140` **y** `resumen/page.tsx:104` |
| `totalCobrado` | `metrics.ts:139` **y** `resumen/page.tsx:95` |
| `obraTotal`, `mueblesTotal`, `artefactosTotal` | calculados en page.tsx, parcialmente en metrics |

El bug del IVA del commit `c75d334` ocurrió **exactamente por esto**: arreglé `metrics.ts` y la pantalla seguía mal porque page.tsx tiene su propia lógica. Después en el mismo commit tuve que arreglar page.tsx también. Es el síntoma más claro de divergencia.

**Riesgo concreto**: cualquier cambio futuro en cálculos contables (ej: cambio de tasa IVA, manejo de retenciones, etc.) requiere acordarme de modificar 2 lugares. **No me voy a acordar**.

### 2C. Coherencia de navegación

✓ Breadcrumbs OK (Proyectos / EN EJECUCIÓN / nombre).
✓ Tabs persistentes funcionan en todas las vistas de proyecto.
✓ Click en proyecto desde lista → Resumen del proyecto. Sin huérfanas.

⚠ **Tabs en BLARQ**: el componente `ProjectTabs.tsx:6-12` define **5 tabs fijos** (Resumen, Presupuesto, Estados de Pago, Facturas, Lista de compra). Para BLARQ (centro de costo interno) **3 de los 5 no aplican**: Presupuesto, Estados de Pago, Lista de compra. Si MJ hace click ahí, ve pantalla vacía o error. No detectamos `isInternal` para condicionar los tabs.

### 2D. Coherencia de terminología

**Términos que cambiaron de "Aprobado" a "ejecucion"**: Project.status migrado correctamente, sin underscore. ✓

**Términos que conviven (intencional o no?)**:
- "Cotización" / "Presupuesto" → en Cotizaciones se usa "Cotización", dentro del proyecto el tab es "Presupuesto". OK, son cosas distintas (la cotización es el proyecto en estado pre-aprobación; el presupuesto es el documento dentro del proyecto). No detecté ambigüedad.
- "Centro de costo" / "Proyecto interno" / "isInternal" → en código se llama `isInternal`, en UI a veces "centros de costo internos" (dashboard, OTROS), en BLARQ se ve como "Gastos empresa". Hay 3 etiquetas para el mismo concepto. Funcional, pero **no es uniforme**.
- "Maestro" / "contratista" / "subcontrato" → existe `Maestro` model + categoría "Subcontrato". MJ se refiere a uno y otro como cosas distintas (maestro = mano de obra de obra, subcontrato = empresa externa contratada). Coherente.

---

## 3. Coherencia con principios del producto

| Principio | ¿Lo cumplen los cambios? |
|---|---|
| Lenguaje editorial denso, sin morado | **Mayormente sí**, excepto banner SII en /facturas (§2A) |
| Memoria espacial por número correlativo | ✓ Reforzado — tablas siempre ordenan por `numeroProyecto` ascendente |
| El cero no ocupa espacio prominente | ✓ Aplicado consistente — `formatCLP(0)` se reemplaza por `<span text-gray-300>—</span>` en tablas |
| Jerarquía por tipografía, no color | ✓ Las nuevas tablas usan peso/tamaño, color solo como semántico (rojo=excedido, verde=OK) |
| Una entidad Proyecto con dos correlativos | ✓ Implementado en commit 9265bac |
| Cantidad ejecutada como base en EPs | No tocado en estos commits |
| Descripciones duales cliente/maestro | No tocado en estos commits |
| Reducir fricción tareas frecuentes | ✓ EditableCell, filtros tipo Excel, EERR con período rápido |

**Refuerzos especialmente buenos**:
- EditableCell: ahorra clicks de abrir un formulario completo solo para corregir un nombre.
- Filtros tipo Excel + totales reactivos: lo que pidió MJ explícitamente.
- EERR estructurado: respuesta directa a "los reportes de Maxxa o Chipax".

**Contradicciones**:
- **Banner morado en /facturas**: contradice "sin morado".
- **Tabs irrelevantes en BLARQ**: contradice "reducir fricción para tareas frecuentes" — MJ se topa con tabs que no hacen nada útil.

---

## 4. Gaps y decisiones tomadas sobre la marcha

| Decisión | Fundamento | ¿Conviene revisar? |
|---|---|---|
| **Auto-creación de proyectos via Maxxa con status `"ejecucion"` hardcoded** (`import-maxxa-assignments.ts:238`) | Asumí que si MJ ya tiene gastos cargados a un centro de costo en Maxxa, ese proyecto está en obra. | **Sí** — un proyecto recién creado desde import podría haber sido cotización vieja descartada. ¿Debería arrancar en `cotizacion`? Decisión de MJ. |
| **Centros con `00_*` se tratan como `isInternal`** | Patrón observado en datos (BLARQ, CASA en imports). | Aceptable como heurística, pero frágil. Si llega un proyecto con prefijo `00_` que NO es interno, lo trata mal. |
| **Override numérico hardcoded** `"52_Pauline Dumay" → 53` (línea 213) | MJ dijo verbalmente "Pauline es 53". | OK por ahora pero es un mapping rígido en código. Si aparece otra discrepancia, va a haber que volver a tocar el script. |
| **Conflicto de `numeroProyecto`**: cuando Excel tiene 2 centros con mismo número, el segundo queda con `null`. | Para no romper unique constraint. | Tu decisión: confirmaste que Del Candil queda con 52 y Pauline con 53. Pero el comportamiento default no fue confirmado para casos futuros. |
| **Período "Tendencia mensual" siempre últimos 12 meses, no afectado por selector de período** (`CentroCostoView.tsx:152`) | Asumí que querías ver siempre la tendencia larga, independiente del período seleccionado para EERR. | **Sí** — si seleccionás "Mes actual" en el filtro y la tendencia muestra 12 meses, hay disonancia. ¿La hago consistente con el período? |
| **"Vencidas / por vencer" siempre próximos 7 días, no afectado por período** | Es un alerta de "qué pagar pronto", no algo de período histórico. | Probablemente OK — son cosas distintas. Pero si la idea fuera "qué venció en este período", habría que cambiarlo. |
| **EERR sólo muestra gastos para BLARQ, no ingresos** | Vos confirmaste "solo gastos" para BLARQ. | Ya confirmado. ✓ |

**Estados UI que faltan**:
- Loading: ninguna pantalla muestra skeleton mientras carga. Como son server components con `await prisma.findMany`, el SSR resuelve antes — no se ve "spinner". Pero si la query se vuelve lenta, no hay degradación graceful.
- Error de red en EditableCell: sí lo manejo (muestra "Error de red" en rojo). ✓
- Estado vacío en filtros sin resultado: sí lo manejo en /facturas/[proyecto]. ✓
- Estado "sin permisos": no aplica hoy (todo usuario logueado es admin).

**Validaciones que faltan**:
- En el form de emisión (Modo B branch): no hay validación de RUT chileno (formato + dígito verificador). Si MJ escribe un RUT mal, SimpleFactura lo rechaza pero el feedback es del lado de SF, no nuestro.
- En PATCH de proyecto: el endpoint acepta cualquier campo whitelisted pero **no valida que `numeroProyecto` sea único** antes de update. Si MJ edita inline y mete un número duplicado, va a explotar el constraint en Prisma con error feo. La validación está implícita en DB pero la UI no avisa.
- Categoría "Pendiente de asignar" con sortOrder=999 — funcional, pero si una nueva categoría se crea con sortOrder=999 también, conflicto silencioso.

---

## 5. Deuda técnica generada

### Crítica
1. **Duplicación de cálculos en `resumen/page.tsx` vs `metrics.ts`** (§2B). Refactor: que `resumen/page.tsx` use `computeProjectMetrics()` y deje de calcular por su cuenta.

### Significativa
2. **Lógica de import en 4 scripts (`import-maxxa-assignments.ts`, `import-portofino-v5.ts`, `import-portofino-muebles-artefactos.ts`, `import-lefevre-v5.ts`)** comparte ~30% de código (parser HTML, lookup catálogo, helpers). No están unificados pero no es urgente — son scripts manuales, no parte del runtime.

3. **Branch `modo-b-emision` divergente**: `git diff --stat main modo-b-emision` muestra **+1362/-2329 líneas**. Esa rama está atrás del main porque main tuvo 14 commits desde que el branch se creó. Cuando llegue la certificación SF, el merge va a tener conflictos significativos en `resumen/page.tsx`, `facturas/page.tsx`, `proyectos/[id]/facturas/page.tsx`.

### Menor
4. **`scripts/regroup-auto-categories.ts`** ya se ejecutó en DB. El script es idempotente pero queda en el repo sin marca de "ya aplicado". Convendría borrarlo o moverlo a `scripts/done/`.

5. **`PROJECT_STATUSES` en `utils.ts`** define `archivado` como `"bg-gray-100 text-gray-500"` pero ningún componente lo usa visualmente todavía (las cotizaciones archivadas no muestran el badge). Funcional pero sin verificación visual.

6. **`computePeriodRange`** en `lib/periods.ts` recibe `now` por parámetro para testabilidad — buena práctica, pero **no hay un solo test** del archivo. Cualquier bug de cálculo de períodos pasa sin red.

7. **Helpers de fecha esparcidos**: `relativeDate` (utils.ts), `formatDate` (utils.ts), `formatMonthEs` (CentroCostoView.tsx + periods.ts duplicado). Convendría centralizar.

---

## 6. Riesgos para lo que viene

### Bloqueante para conciliación bancaria
- **El cálculo de "pagado" hoy es manual**: factura.status="pagada" se setea a mano. Cuando importemos cartola, hay que decidir si conciliar **modifica el status** automáticamente y, si sí, qué pasa con los stats que ya recalculan basados en eso. Sin antes consolidar dónde se calcula "pagado vs pendiente" (hoy hay duplicación), el merge de conciliación va a duplicar el problema.

### Bloqueante para Modo B (cuando llegue certificación SF)
- El branch tiene **demasiada divergencia**. Si esperamos más, peor. Cuando llegue, **alguien tiene que dedicar 2-3h a resolver conflictos manualmente** o re-aplicar el feature sobre main fresh.

### Estabilizar antes de seguir
- **Schema de Project**: `numeroCotizacion` y `numeroProyecto` siguen siendo `Int? @unique` (nullable) en el schema. La intención era hacerlos requeridos eventualmente. Si seguimos creando proyectos auto desde Maxxa (que ahora pueden venir con `numeroProyecto=null` por conflictos), nunca van a poder ser required.

- **`isInternal`**: hoy solo BLARQ y CASA lo tienen. Si crece el concepto (más centros: Marketing, Oficina, Personal), el modelo lo soporta pero no hay UI para crear un centro de costo nuevo desde la app — solo via SQL. Hay que decidir si crece el concepto.

---

## 7. Priorización

### A. Arreglar YA (antes de seguir)

| # | Problema | Por qué urge | Esfuerzo |
|---|---|---|---|
| A1 | **Banner SII en /facturas sigue morado** | Contradice principio "sin morado", MJ ya lo señaló al rediseñar Dashboard. 1 línea. | **S** (10 min) |
| A2 | **Tabs irrelevantes en BLARQ** (Presupuesto, Estados de Pago, Lista de compra) | Confunden y rompen UX. Hay que filtrar en `ProjectTabs.tsx` cuando `isInternal=true`. | **S** (30 min) |
| A3 | **Validación de `numeroProyecto` único en PATCH `/api/proyectos/[id]`** | Si MJ edita inline duplicando un número, error 500 sin feedback. UX rota silenciosa. | **S** (20 min) |

### B. Consolidar antes de seguir

| # | Refactor | Qué se gana | Esfuerzo |
|---|---|---|---|
| B1 | **Eliminar duplicación de cálculos resumen/page.tsx ↔ metrics.ts** | Próximos cambios contables (conciliación, cambio IVA, etc.) tocan un solo lugar. Evita futuros bugs como el del IVA del 29-abr. | **M** (2-3h) |
| B2 | **Mergear o resolver branch `modo-b-emision`** (cuando llegue cert SF) | Cuanto más espera, más conflicto. Si SF se demora, considerar rebase preventivo sobre main. | **M** (2-3h) |
| B3 | **Filtros de /facturas global → mismo set que por-proyecto** | Coherencia UX (categoría, dateFrom/dateTo, q faltan en global). | **S** (45 min) |
| B4 | **Cleanup**: borrar `scripts/regroup-auto-categories.ts` (ya ejecutado) | Reducir ruido en repo. | **S** (5 min) |
| B5 | **Decidir: tendencia mensual sigue período o queda 12 meses fijo** | Hoy es ambiguo. | **S** (15 min de decisión + 15 de implementación si se cambia) |

### C. Puede esperar

- C1. Centralizar helpers de fecha (`formatMonthEs`, etc.) — funcional, no urgente.
- C2. Schema: `numeroCotizacion` required — depende de cómo crezca el flujo.
- C3. Tests de `computePeriodRange` — solo si crece el módulo.
- C4. UI para crear centros de costo desde la app — solo si MJ lo necesita.
- C5. Unificar lógica de los 4 scripts de import — ahorraría algo pero los scripts son one-shot, no es prioridad.

---

## ALERTAS

### ⚠⚠ El bug de IVA pudo NO haberse detectado

El bug del 29-abr (Subcontrato 101% siendo 85%) lo encontraste vos por **inspección visual** ("¿no será que están sin IVA y los comprados con IVA?"). Sin esa observación, hubiéramos seguido reportándote números inflados. **No tenemos ningún test, ninguna alerta, ningún chequeo** que detecte que un cálculo financiero usa el campo equivocado. Es 100% MJ-dependent.

Esto refuerza la urgencia del refactor B1 (consolidar cálculos en metrics.ts) y abre la pregunta de si conviene escribir aunque sea **2-3 tests rápidos** para los cálculos de gasto/cobrado/utilidad en metrics.ts. No para alcanzar coverage, sino para que un cambio en 6 meses no rompa silenciosamente el dato base.

### ⚠ El comentario "TODO: esto debería ser un cost center, no un proyecto"

En `import-maxxa-assignments.ts:73` está comentado:
```
"00_BLARQ": "CREATE", // TODO: esto debería ser un cost center, no un proyecto
```
El TODO ya se "resolvió" en el sentido de que ahora los `00_*` se crean con `isInternal=true`. Pero el comentario quedó. **Borrarlo o reemplazarlo** para que el repo no parezca con TODOs muertos.

---

## Preguntas que tengo

Antes de seguir con conciliación bancaria u otra cosa, necesito que confirmes:

1. **¿Auto-creación de proyectos via import Maxxa debería arrancar en `cotizacion` o `ejecucion`?** Hoy es `ejecucion` por default. Si la respuesta es `cotizacion`, hay que ajustar el script + posible re-clasificación de los 6 proyectos creados en este flujo (51, 55, 56, 61).

2. **Tendencia mensual en BLARQ**: ¿la dejo en "siempre últimos 12 meses" (hoy) o que respete el período seleccionado?

3. **Branch `modo-b-emision`**: ¿prefieres que haga rebase preventivo ahora (1h) para reducir el conflict cuando llegue la certificación SF, o esperar?

4. **Tests de `metrics.ts`**: ¿agrego 3-4 tests básicos para los cálculos contables ahora, antes de tocar algo más? Sería ~30 min y reduce el riesgo de bugs silenciosos como el del IVA. (Mi voto: sí.)

5. **Banner SII en /facturas**: lo arreglo en este sprint o lo agendo para después? (Es trivial, mi voto: ahora junto con A1-A2-A3.)

---

## Resumen ejecutivo

- **Funcional**: los 14 commits están todos cerrados y andando.
- **Frágil**: hay duplicación de cálculos contables entre `resumen/page.tsx` y `metrics.ts` que ya causó un bug y va a causar otros.
- **Inconsistencias visuales menores**: banner SII morado, tabs irrelevantes en BLARQ.
- **Branch grande sin mergear**: `modo-b-emision` cada vez más caro de integrar.
- **Cero tests** sobre lógica financiera — el detector de errores hoy se llama María José.

**Mi recomendación**: antes de arrancar conciliación bancaria, hacer **A1+A2+A3** (1h total) y **B1** (2-3h) para que la base esté consolidada. Después sí, conciliación bancaria sobre piso firme.
