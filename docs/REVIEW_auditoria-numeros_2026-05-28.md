# Auditoría de coherencia numérica — 2026-05-28

Sesión de auditoría (solo lectura, sin cambios de código). Objetivo: verificar que
los números de plata y cantidad cuadren entre sí en toda la app, y mapear todo
cálculo duplicado que pueda divergir.

- **Estado de esta entrega**: PASO 3.1 (auditoría estática del código) COMPLETO.
  PASO 3.2 (cruce contra datos reales) **bloqueado** — ver §"Qué falta para cerrar".
- **Identidad contable usada** (modelo BLARQ, confirmado por MJ): el cliente paga
  primero y la factura emitida es comprobante. Identidades válidas:
  `acordado − cobrado = por cobrar` y `emitido ≈ cobrado`. NO se audita ninguna
  identidad tipo "facturado − pagado".

---

## Resumen ejecutivo

`metrics.ts` es efectivamente la fuente de verdad para los totales por proyecto, y
los grandes consumidores (dashboard, lista de proyectos, página /resumen) la
consumen sin recalcular. **El problema no es metrics.ts — es que hay tres lugares
que calculan las MISMAS magnitudes por su cuenta y ya divergieron:**

1. **`fondoSueldos.ts`** — quedó atrás de dos correcciones que sí se aplicaron a
   metrics.ts: la fórmula de obra (usa la vieja, encadenada) y los artefactos
   (suma sin multiplicar por cantidad). También mira una sola versión de obra
   cuando metrics suma anexos.
2. **`/resumen/page.tsx`** — la tabla "Presupuesto vs Real" arma el presupuesto de
   artefactos sin multiplicar por cantidad (el mismo bug que se corrigió en
   metrics en la ronda 30, pero acá quedó).
3. **`CuadroResumen.tsx` y `MueblesPDF`** — no aplican el descuento global de
   muebles que metrics sí aplica.

Ninguno toca el número de "cobrado" ni "gastado" (esos están bien centralizados).
Los descuadres están en **acordado de obra (fondo)**, **presupuesto de artefactos**
y **acordado de muebles con descuento**.

---

## Hallazgos (ordenados por severidad, y dentro de cada nivel por probabilidad)

### MEDIA

---

#### H1 — `fondoSueldos.ts` calcula el acordado de obra con la fórmula vieja (encadenada); el resto de la app usa la aditiva

- **Qué**: el total acordado de obra se calcula distinto en dos lados.
  - **Aditivo** (metrics.ts, CuadroResumen, /presupuesto, /comparar, ObraPDF):
    `neto = CD + CD×GG + CD×Util` → `total = neto × 1,19`.
  - **Encadenado** (fondoSueldos.ts): `total = CD × (1+GG) × (1+Util) × 1,19`.
  - El encadenado agrega un término de más: `CD × GG × Util × 1,19`.
- **Dónde**:
  - Correcto/aditivo: [metrics.ts:168-178](src/lib/projects/metrics.ts:168), [CuadroResumen.tsx:131-136](src/components/proyecto/CuadroResumen.tsx:131), [presupuesto/page.tsx:101-105](src/app/(dashboard)/proyectos/[id]/presupuesto/page.tsx:101), [comparar/page.tsx:28-31](src/app/(dashboard)/proyectos/[id]/presupuesto/comparar/page.tsx:28), [ObraPDF.html.ts:391-396](src/lib/pdf/ObraPDF.html.ts:391).
  - Divergente/encadenado: [fondoSueldos.ts:83](src/lib/banco/fondoSueldos.ts:83).
- **Por qué pasa**: el PR #43 corrigió la fórmula a aditiva en metrics y en la
  pantalla de resumen, pero `fondoSueldos.ts` es un cálculo duplicado que no se
  migró. Quedó con la fórmula encadenada original.
- **Fórmulas lado a lado**:

  | | metrics.ts y resto | fondoSueldos.ts |
  |---|---|---|
  | neto | `CD + CD·gg + CD·util` | `CD·(1+gg)·(1+util)` |
  | total | `neto · 1,19` | `neto · 1,19` |
  | exceso | — | `+ CD·gg·util·1,19` |

- **Ejemplo numérico trabajado** (inputs reales del comentario de metrics.ts —
  Pauline Dumay: CD = $26.948.285, GG 23%, Util 5%, IVA 19%):
  - Aditivo: neto = 26.948.285 × 1,28 = **$34.493.805**; total = × 1,19 = **$41.047.628**.
  - Encadenado: neto = 26.948.285 × 1,23 × 1,05 = **$34.803.710**; total = × 1,19 = **$41.416.415**.
  - **Diferencia: +$368.787** (el encadenado infla el acordado de obra ~0,9%).
  - Efecto sobre el fondo: `obraGGTotal` es igual en los dos (= CD×GG = $6.198.106),
    pero `pctCobradoObra = obraCobrado / obraTotalAcordado` sale más chico con el
    encadenado (denominador más grande) → `fondoObraGenerado = obraGGTotal ×
    pctCobradoObra` queda **subestimado**. Con un cobro de ejemplo de $20.000.000:
    aditivo → fondo obra = $3.019.717; encadenado → $2.993.064; **$26.653 menos**.
- **Efecto neto**: el "Fondo Sueldos generado" que ve MJ (card FondoSueldosCard)
  sale un poco más bajo de lo que debería. No es plata a la cara del cliente, pero
  sí una decisión de cuánta plata reservar para los socios.
- **SEVERIDAD: media** — afecta el fondo sueldos, no un documento al cliente/banco.
- **PROBABILIDAD: alta** — difiere con certeza siempre que GG>0 y Util>0 (siempre
  en obra).

---

#### H2 — `/resumen` arma el presupuesto de artefactos sin multiplicar por cantidad

- **Qué**: en la tabla "Presupuesto vs Real", la columna **Presupuestado** de la
  sección Artefactos suma el costo por ítem **sin multiplicar por `quantity`**. La
  sección Muebles, dos bloques más arriba en el mismo archivo, **sí** multiplica.
- **Dónde**: [resumen/page.tsx:201-208](src/app/(dashboard)/proyectos/[id]/resumen/page.tsx:201) —
  `artefactosPresupBySub[...] += costoPorItem;` (falta `* it.quantity`).
  Compárese con muebles en [resumen/page.tsx:173](src/app/(dashboard)/proyectos/[id]/resumen/page.tsx:173):
  `mueblesPresupBySub[...] += costoPorUnidad * it.quantity;`.
- **Por qué pasa**: es exactamente el bug que se corrigió en metrics.ts en la ronda
  30 (sumar `clientPrice` sin `× quantity`), pero esta pantalla tiene su propio
  cálculo del presupuesto de artefactos y quedó sin corregir. `clientPrice` es
  precio unitario desde la corrección de ronda 30.
- **Ejemplo numérico** (2 focos a $100.000 c/u, quantity = 2):
  - Correcto: 100.000 × 2 = **$200.000** presupuestado.
  - Esta pantalla: suma 100.000 (sin ×2) = **$100.000**. Subcuenta $100.000.
- **Efecto**: el presupuesto de artefactos sale corto → la columna "Desviación"
  (`real / presupuesto`) sale inflada → puede disparar **alertas falsas de
  "excedido"** en las filas Cocina/Baño/Iluminación; y el subtotal/total de
  "Presupuesto vs Real" no cuadra con el total acordado de artefactos del card de
  arriba.
- **SEVERIDAD: media** — número en pantalla de proyecto, con alerta de sobregasto
  potencialmente falsa y descuadre tabla↔cards.
- **PROBABILIDAD: alta** — difiere con certeza si hay artefactos con quantity>1.
  Tras la corrección de ronda 30 varios proyectos quedaron con cantidad real >1.

---

#### H3 — Descuento global de muebles: metrics lo aplica, CuadroResumen y MueblesPDF no

- **Qué**: el campo `discountPercentage` del presupuesto de muebles (descuento
  global de cierre de trato) se aplica en unos lados y en otros no.
  - **Aplica**: [metrics.ts:186-195](src/lib/projects/metrics.ts:186) (`× (1 − descuento)`),
    [presupuesto/page.tsx:286-287](src/app/(dashboard)/proyectos/[id]/presupuesto/page.tsx:286).
  - **NO aplica**: [CuadroResumen.tsx:139-146](src/components/proyecto/CuadroResumen.tsx:139),
    [MueblesPDF.html.ts:370-372](src/lib/pdf/MueblesPDF.html.ts:370).
- **Por qué pasa**: cálculo duplicado del subtotal de muebles en cuatro lugares;
  dos incorporaron el descuento y dos no.
- **Efecto si un presupuesto de muebles tiene descuento > 0**:
  - En la misma pantalla /resumen, el "acordado muebles" del **Cuadro Resumen**
    sale MÁS ALTO que el total acordado de los **cards** (dos números distintos
    para lo mismo).
  - El **PDF de muebles que recibe el cliente** muestra un total **sin** el
    descuento → el cliente ve un total mayor al pactado.
- **Ejemplo** (muebles subtotal c/IVA $10.000.000, descuento 2%):
  - metrics / lista presupuestos: 10.000.000 × 0,98 = **$9.800.000**.
  - CuadroResumen / PDF cliente: **$10.000.000**. Descuadre de $200.000.
- **SEVERIDAD: media-alta para el PDF** (documento al cliente con total equivocado)
  **si se usa descuento**; media para el descuadre interno tabla↔cards.
- **PROBABILIDAD: media** — depende de si MJ usa el descuento global de muebles
  hoy. **A confirmar con datos** (ver §"Qué falta para cerrar"). Si nunca se usa,
  es un riesgo latente, no un error activo.

---

#### H4 — `fondoSueldos.ts` mira una sola versión de obra; metrics suma los anexos aprobados

- **Qué**: para sumar la obra, `fondoSueldos.ts` usa `bestVersion()` (la última
  aprobada por fecha, **una sola**), mientras metrics.ts usa `allApproved()` (suma
  **todas** las obras aprobadas, p. ej. principal + anexo).
- **Dónde**: [fondoSueldos.ts:66-74](src/lib/banco/fondoSueldos.ts:66) (bestVersion)
  vs [metrics.ts:133-141](src/lib/projects/metrics.ts:133) (allApproved).
- **Por qué pasa**: el soporte de anexos (caso Aguirre V7 + V4-BAÑO-VISITAS) se
  agregó a metrics y CuadroResumen, pero fondoSueldos quedó con la lógica de una
  versión.
- **Efecto**: en un proyecto con anexo de obra aprobado, el fondo sueldos calcula
  GG total y % cobrado sobre **una sola obra**, ignorando la otra. El fondo
  generado de obra queda mal en esos proyectos.
- **SEVERIDAD: media** — afecta fondo sueldos solo en proyectos con anexo.
- **PROBABILIDAD: alta para proyectos con anexo** (hoy: Aguirre), nula para el resto.

---

### COSMÉTICA / BAJA

---

#### H5 — `fondoSueldos.ts` suma artefactos sin multiplicar por cantidad

- **Qué**: [fondoSueldos.ts:97-99](src/lib/banco/fondoSueldos.ts:97) —
  `reduce((s, i) => s + i.clientPrice, 0)`, sin `× quantity`. Mismo bug que H2.
- **Efecto**: `artefactosTotalAcordado` subcuenta si hay quantity>1. **PERO**
  artefactos NO aporta al fondo (es solo informativo en la card), así que el
  impacto sobre el fondo generado es **cero**. Solo el número informativo sale corto.
- **SEVERIDAD: cosmética** — campo informativo, no afecta el cálculo del fondo.
- **PROBABILIDAD: alta** de que el número informativo difiera; impacto nulo.

---

#### H6 — `porCobrar` clampeado a 0 oculta sobre-cobro

- **Qué**: [resumen/page.tsx:361-362](src/app/(dashboard)/proyectos/[id]/resumen/page.tsx:361) —
  `porCobrar = Math.max(0, totalAcordado − totalCobrado)`. Si se cobró MÁS que lo
  acordado, "Por cobrar" muestra $0 en vez de un negativo que indicaría sobre-cobro
  o cobro mal asignado.
- **Efecto**: esconde una señal de anomalía. La barra de `pctCobrado` sí puede
  pasar de 100%, así que la info no se pierde del todo.
- **SEVERIDAD: cosmética/baja** — decisión de diseño, pero tapa una señal de error.
- **PROBABILIDAD: media** — depende de si hay proyectos sobre-cobrados (a confirmar
  en la parte dinámica).

---

#### H7 — Reparto de pagos de artefactos en el Cuadro Resumen es heurístico (by-design)

- **Qué**: [CuadroResumen.tsx:173-200](src/components/proyecto/CuadroResumen.tsx:173) —
  los pagos con `conceptoCobro=artefactos` se reparten cocina/sanitarios/iluminación
  según el **ratio presupuestado**, no según lo realmente cobrado por sub. Si un
  cobro se desvía del split, las columnas no reflejan la realidad exacta.
- **Efecto**: imprecisión conocida y documentada (acordada con MJ el 2026-05-15).
  No es bug; es aproximación deliberada porque la factura no distingue sub-artefacto.
- **SEVERIDAD: cosmética** — documentado y acordado.
- **PROBABILIDAD**: by-design, no "roto".

---

#### H8 — `/resumen` recalcula el gasto por categoría con criterio de agrupación distinto a metrics

- **Qué**: la tabla "Desglose de Gastos Reales" en
  [resumen/page.tsx:342-355](src/app/(dashboard)/proyectos/[id]/resumen/page.tsx:342)
  agrupa por categoría top + ids de hijos; metrics agrupa por
  `category.parent?.name ?? category.name` en
  [metrics.ts:299-308](src/lib/projects/metrics.ts:299). Dos cálculos del mismo
  "gasto por categoría" en la misma pantalla con lógicas distintas de agrupación.
- **Efecto**: probablemente dan el mismo total, pero la asignación a cada categoría
  puede diferir en casos borde. Candidato a divergencia silenciosa.
- **SEVERIDAD: baja**.
- **PROBABILIDAD: baja-media** — a confirmar con datos.

---

#### H9 — % de avance de obra calculado en dos lados (misma fórmula)

- **Qué**: el % de avance ponderado por MO se calcula en
  [metrics.ts:326-344](src/lib/projects/metrics.ts:326) y se vuelve a calcular,
  por capítulo, en [resumen/page.tsx:257-296](src/app/(dashboard)/proyectos/[id]/resumen/page.tsx:257).
  Misma fórmula, datos repetidos.
- **Efecto**: coherente hoy; candidato a divergir si una se toca y la otra no.
- **SEVERIDAD: cosmética**. **PROBABILIDAD: baja** (misma fórmula).

---

#### H10 — KPIs globales del dashboard suman `totalAmount` sin restar notas de crédito

- **Qué**: [page.tsx:28-39](src/app/(dashboard)/page.tsx:28) — "total pendiente de
  pagar/cobrar" usa `prisma.invoice.aggregate({ _sum: { totalAmount } })` filtrado
  por `status=pendiente`. Un `_sum` de Prisma no puede aplicar el signo de NC
  (tipoDoc=61), así que si una NC quedara en estado "pendiente" se sumaría como
  positiva.
- **Efecto**: posible leve sobreestimación de los KPIs globales "pendiente". A nivel
  por-proyecto NO pasa (ahí se usa metrics con signo). Es solo el agregado global.
- **SEVERIDAD: baja**. **PROBABILIDAD: baja** — depende de que haya NCs en estado
  pendiente, raro.

---

## Sano y verificado (parte estática)

- **Cobrado / cobrado neto / gastado / gastado c-IVA**: centralizados en metrics.ts.
  La página de facturas del proyecto los replica con el mismo helper de signo de NC
  — coherente. ✓
- **Signo de nota de crédito** (`tipoDoc === 61 ? −1 : 1`): aplicado consistente en
  metrics.ts, fondoSueldos.ts, resumen/page.tsx y facturas/page.tsx. ✓
- **Acordado de obra (aditivo)**: idéntico en metrics, CuadroResumen, /presupuesto,
  /comparar y ObraPDF. El único desvío es fondoSueldos (H1). ✓
- **Artefactos × cantidad**: correcto en metrics, CuadroResumen, ArtefactosEditor,
  ArtefactosPDF y /presupuesto. Solo fallan fondoSueldos (H5) y el presupuesto de
  artefactos de /resumen (H2). ✓
- **Muebles × cantidad**: correcto en todos lados. El único punto abierto es el
  descuento global (H3), no la cantidad. ✓
- **IVA**: neto y total se guardan separados por factura; metrics compara neto
  contra neto (presupuesto está en neto). No se vio doble aplicación de IVA. ✓
- **Estados de Pago — preservación entre versiones** (estático): `amountPaid` es
  snapshot inmutable; `buildPrevAccumulators` acumula lo pagado por `lineageId`
  desde EPs **cerrados**, y `computeSyncDiff` nunca recalcula lo ya pagado (solo
  clasifica partidas removidas como "safe" vs "con pagos"). El diseño preserva lo
  pagado al subir de versión. **No verificable dinámicamente todavía** — ver abajo. ✓ (diseño)
- **Dashboard y lista de proyectos**: usan `computeProjectMetrics`, no recalculan
  por proyecto. ✓
- **Estado de factura** (`recomputeInvoiceStatus`): pendiente/parcial/pagada con
  tolerancia de $1 CLP sobre la suma de `amountApplied`. Coherente con cobros
  parciales. ✓

---

## Qué falta para cerrar (necesito de MJ)

### 1. Parte dinámica (PASO 3.2) — BLOQUEADA por falta de credenciales de prod

El único `.env` disponible apunta a **dev** (`ep-solitary-mud`), que según el WIP
está desactualizado y no sirve para validar. Para el cruce contra datos reales
necesito la **cadena de conexión read-only de prod** (`ep-shy-morning`).

- **Cómo propongo hacerlo (opción a de tu mensaje, la más segura)**: con la URL de
  prod, corro un script **read-only** que hace SELECT de los proyectos elegidos +
  sus relaciones y los vuelca a un **JSON local**. Después audito ese JSON offline.
  Prod se toca **una sola vez, solo lectura, cero writes, cero migraciones**, y
  acotado a los proyectos elegidos. Te aviso antes de correrlo. (No tengo la URL,
  así que no puedo tocar nada todavía.)
- **Proyectos elegidos por cobertura de casos**:
  - **Portofino** — mezcla obra + muebles + artefactos; tiene la devolución a
    Carolina Ovalle (prueba el manejo de signo negativo / NC en cobrado).
  - **Francisco de Aguirre** — mezcla completa + **anexo de obra** (V7 + V4-BAÑO-
    VISITAS, ambos aprobados) + columna de iluminación. Es el caso que dispara H4
    (fondo con una sola obra) y prueba allApproved vs bestVersion.
  - **JNC-Vitacura** (ex Lefevre) — mezcla completa ya validada contra su cuadro
    al cliente; sirve de control "sano".
  - **Smoke secundario**: un centro de costo interno (BLARQ) para confirmar que la
    vista interna no rompe.

### 2. Dato que no puedo resolver solo

- **¿Algún presupuesto de muebles tiene `discountPercentage > 0` hoy?** De eso
  depende si H3 es un error activo (con plata mal mostrada al cliente) o un riesgo
  latente. Lo confirmo yo mismo con el dump de prod si me das la URL; si lo sabés
  de memoria, mejor aún.

### 3. Límite conocido de la parte dinámica

- Según el WIP (ronda 27), **ningún proyecto tiene EPs cerrados cargados en la
  app** (los de los maestros se hicieron en Excel). Si sigue así, la prueba
  dinámica de "lo pagado en versiones previas sobrevive al subir de versión" **no
  tiene datos reales** contra qué correr — solo queda la verificación estática (ya
  hecha, ✓ diseño) y el script sintético `scripts/test-ep-flow.ts`. Avisame si hay
  algún proyecto con EPs reales que yo no esté viendo.

---

## Tabla de hallazgos (resumen)

| # | Hallazgo | Severidad | Prob. | Archivo clave |
|---|---|---|---|---|
| H1 | Fondo obra: fórmula encadenada vs aditiva | media | alta | fondoSueldos.ts:83 |
| H2 | Presupuesto artefactos /resumen sin × cantidad | media | alta | resumen/page.tsx:207 |
| H3 | Descuento muebles no aplicado en CuadroResumen/PDF | media-alta* | media | CuadroResumen.tsx:139, MueblesPDF:370 |
| H4 | Fondo usa una sola obra (ignora anexos) | media | alta (con anexo) | fondoSueldos.ts:66-74 |
| H5 | Fondo artefactos sin × cantidad (informativo) | cosmética | alta | fondoSueldos.ts:98 |
| H6 | `porCobrar` clampeado oculta sobre-cobro | baja | media | resumen/page.tsx:361 |
| H7 | Reparto artefactos heurístico (by-design) | cosmética | — | CuadroResumen.tsx:173 |
| H8 | Gasto por categoría recalculado con otra agrupación | baja | baja-media | resumen/page.tsx:342 |
| H9 | % avance obra calculado en dos lados | cosmética | baja | resumen/page.tsx:257 |
| H10 | KPIs globales suman sin restar NC | baja | baja | page.tsx:28-39 |

\* H3 sube a media-alta solo si hay presupuestos de muebles con descuento > 0
(pendiente de confirmar con datos).
</content>
</invoke>
