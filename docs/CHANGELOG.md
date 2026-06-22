# CHANGELOG

Log cronológico de cambios estructurales. 3-5 líneas por entrada, las más nuevas arriba. Plantilla en [`_templates/CHANGELOG-entry.md`](_templates/CHANGELOG-entry.md).

---

## 2026-06-22 — Fondo Sueldos: tarjeta rediseñada como forma de pago

- **Rediseño de `FondoSueldosCard`** (resumen del proyecto), pedido por MJ sobre JNC. Antes: columnas Cobrado / % cobrado / Generado (la columna Cobrado venía inflada porque el resumen le pasaba TODAS las facturas a `computeFondoSueldos`). Ahora: por tipo se muestra **costo directo** + **utilidad a generar** (GG obra / utilidad muebles, destacada).
- **Desglose por forma de pago del cliente** (anticipo/avances/saldo del presupuesto, modelo `PaymentTerm` — NO confundir con los Estados de Pago a maestros): cada tramo con su **monto a cobrar** (% × total acordado obra) y la **utilidad que genera** (% × GG), marcado **cobrado / parcial / pendiente** según lo realmente cobrado (solo emitidas, cálculo correcto).
- **Módulo nuevo `src/lib/banco/formaPagoFondo.ts`** (`computeFormaPagoFondo`), aditivo y de solo lectura: no toca `fondoSueldos.ts` (que sigue usándolo el dashboard de banco) ni `metrics.ts`. Suma todas las obras aprobadas (como metrics/utilidadPorCobro). La forma de pago se lee de la versión de obra aprobada; si no la tiene cargada (caso JNC, está en la enviada), cae a la versión de obra más reciente que la tenga y lo avisa.
- **Convive con la tarjeta "Utilidad por cobro"** (realidad factura por factura) que va debajo: arriba el plan, abajo lo cobrado. Decisión de MJ.
- **Sin cambio de schema.** Verificado en vivo (dev, proyecto 46 con forma de pago sembrada temporal): tramos suman el GG, marcado cobrado/parcial/pendiente correcto, pie ya transferido/falta. Test de lógica `scripts/test-formapago.ts`. `tsc` limpio.

## 2026-06-21 — Banco: conciliar transferencias internas (Operativa→Sueldos) con obras

- **Nuevo campo `BankMovement.projectId`** (nullable, relación a `Project` con `onDelete: SetNull`, índice). Permite imputar A MANO un movimiento a una obra. Hoy se usa solo para las transferencias internas Operativa↔Sueldos (`category="transfer_interno"`); nunca se auto-asigna (mismo criterio que las facturas).
- **UI de asignación**: en `/banco/movimientos`, cada transferencia interna trae un desplegable de obra (formato "número · nombre", reusado del PR #171) en la columna IMPUTACIÓN. Asignar/desasignar etiqueta **los dos lados del par linkeado** (sale −X de Operativa, entra +X a Sueldos) vía `PATCH /api/banco/movimientos/[id]` con `internalProjectId`. Componente `InternalTransferProjectSelect.tsx`.
- **Cálculo "transferido por obra"**: suma NETA de las internas conciliadas a la obra, contando **solo el lado que entra a Sueldos** (`bankAccount.role="salary_fund"`) — nunca los dos lados, o se duplicaría. Las devoluciones (Sueldos→Operativa) vienen con monto negativo en esa cuenta, así que netean solas. Query inline en `resumen/page.tsx`.
- **`FondoSueldosCard`** extendida con dos líneas: "Ya transferido a sueldos" y "Falta transferir" (= máximo de la obra al 100% − transferido, decisión de MJ). Aviso ámbar si transferido > generado hasta ahora ("traspaso adelantado").
- **Alcance contable**: ADITIVO. No toca `fondoSueldos.ts` ni `metrics.ts` ni el cálculo de "generado". Snapshot de "generado" ANTES/DESPUÉS idéntico (`scripts/snapshot-fondo-generado.ts`). Verificado en vivo (dev, Chrome MJ): asignar la transferencia de $1.000.000 a la obra 46 etiqueta ambos lados y la card muestra transferido $1.000.000 / falta $1.669.408 (cuenta una sola vez); desasignar revierte. `tsc` limpio.

## 2026-06-18 — Artefactos: el catálogo baja a las cotizaciones (flujo invertido)

- **Se invirtió el flujo de precios de artefactos** para que funcione como el presupuesto de obra (decisión de negocio de MJ; ver ADR `2026-06-18-artefactos-precios-catalogo-a-cotizacion.md`). Antes: el catálogo NO bajaba a los borradores y editar una cotización SÍ pisaba el catálogo global. Ahora: al revés.
- **Catálogo = precio maestro → baja a borradores.** Editar un item del catálogo (a mano o "Revisar precios") propaga a las líneas de cotización que lo usan, **solo** si están en borrador y no fueron editadas a mano. Lógica en `src/lib/catalog/syncArtefactos.ts` (`propagateCatalogToBorradores`), llamada desde el PUT del catálogo.
- **Despegar por línea**: nuevo flag `ArtefactoItem.priceOverridden` (default false), equivalente de `ObraItem.isCustomized`. Editar precio/descuento/nombre/detalle/marca/link/foto de una línea la marca como despegada → el catálogo no la vuelve a tocar. Cambiar solo cantidad/ambiente/orden no despega.
- **Editar la cotización ya NO sube al catálogo** (se eliminó el `artefactoCatalog.update` del PUT de la línea). "Revisar precios online" dentro de la cotización ahora actualiza solo esa cotización. Las enviadas quedan congeladas por estado; se activó **"Volver a lo enviado" para artefactos** (antes solo obra).
- **Alcance contable**: snapshot de totales ANTES/DESPUÉS idéntico (`scripts/snapshot-artefactos-totales.ts`); test de integración 10/10 (`scripts/test-artefactos-propagacion.ts`); verificado en vivo en dev. Tocar el catálogo ahora PUEDE mover el "Total acordado" de un proyecto cuya cotización de artefactos vigente sea borrador — es lo deseado, no un bug. `tsc` limpio.

## 2026-06-18 — Catálogo de artefactos: buscador + "+ agregar" por tipo

- **Buscador por texto libre** (vuelve, pero claro): input arriba de la lista que filtra la pestaña activa por cualquier palabra contra nombre, marca, detalle, línea, color, tipo y proveedor (cada palabra tiene que aparecer; AND). Ej. "mampara", "brushed". Tiene × para limpiar. (Antes se había sacado por confuso — A8; ahora con placeholder de ejemplos y matcheo amplio.)
- **"+ agregar" por tipo** (A7): cada encabezado de grupo (ACCESORIOS, MAMPARAS, WC…) tiene un botón "+ agregar" que abre el alta con el tipo (`tag`) y la pestaña ya puestos, y hace scroll al formulario. Así no hay que elegir la subcategoría/tipo a mano.
- **Alcance**: solo `ArtefactosCatalogClient.tsx`. El buscador es within-tab (filtra la pestaña activa, no cruza Sanitario/Cocina/Iluminación). No toca cálculos. Verificado en dev: "mampara" filtra a mamparas; "+ agregar" en MAMPARAS abre el alta con tag=Mamparas. `tsc` limpio.

## 2026-06-18 — Cotización de artefactos: reordenar y duplicar ambientes

- **Reordenar ambientes (bloques) arrastrando**: cada banner de ambiente tiene una manija ⋮⋮ a la izquierda; se agarra el bloque entero y se sube/baja sobre otro (ej. "Baño 3" arriba de "Baño 2"). dnd-kit anidado: contexto de bloques (rooms) por subcategoría + el contexto de filas dentro de cada uno (ya existente).
- **Duplicar ambiente**: botón "Duplicar ambiente" en el banner; copia TODOS los artefactos del ambiente a uno nuevo "<nombre> (copia)" que queda justo debajo. Sirve para armar un baño igual a otro y después renombrarlo.
- **Modelo de orden**: el orden de los ambientes pasó a basarse en el `sortOrder` mínimo de cada bloque (antes ROOM_ORDER + orden de aparición; para nombres libres da el mismo resultado, así que la vista existente no cambia). Reordenar bloques, reordenar filas y duplicar pasan todos por un renumerado global de la subcategoría (`applyOrder`), para que los rangos de `sortOrder` entre ambientes nunca se pisen.
- **Alcance**: solo `ArtefactosEditor.tsx`. No toca `metrics.ts`. Verificado en vivo (Portofino dev): duplicar copia los 8 ítems en orden justo debajo; arrastrar un bloque reordena y persiste; orden existente intacto al cargar. `tsc` limpio.

## 2026-06-18 — Cotización de artefactos: ambiente editable inline + agregar arriba + foto +50%

- **Nombre del ambiente editable directo**: se eliminó el botón "Editar ambiente" con desplegable (que se había agregado hoy mismo). Ahora el nombre del banner gris es un `<input>` que se edita en el lugar (clic y escribís); al salir/Enter reasigna el ambiente de todo el bloque (`changeRoomForGroup`), Escape descarta. `RoomBanner` quedó como un input simple (sin select ni botones). MJ prefiere escribir el nombre directo.
- **"+ Agregar artefacto" arriba**: el botón pasó del fondo del bloque (después de los totales, donde confundía) a la **misma línea del banner del ambiente**, a la derecha. El formulario de catálogo (`AddArtefactoFromCatalog`) aparece justo debajo del banner cuando está activo.
- **Foto del producto +50% en el editor** (no en el PDF): thumbnail 44px → 66px (`w-[66px] h-[66px]`); columna IMG de la grilla 3.25rem → 5rem. Texto sin cambios.
- **Alcance**: solo `ArtefactosEditor.tsx`. No toca `metrics.ts` ni el PDF. Verificado en vivo (Portofino dev, Chrome MJ): renombrar persiste (9 ítems), agregar abre arriba, foto 66px; `tsc` limpio.

## 2026-06-18 — PDF de artefactos: encabezado igual al de obra

- **Formato unificado**: el encabezado del PDF de artefactos tenía otra disposición (etiquetas inline en mayúscula, sin "Version:", profesional/fecha en grilla 2×2). Se reemplazó por el **mismo formato del PDF de obra** (`ObraPDF.html.ts`): franja con logo (izq) + "Version:" / "Vx COTIZACION" / "ARTEFACTOS" / "Profesional a cargo" (der), y grilla de campos Mandante/Proyecto/Direccion (izq) · Celular/Fecha/Valor UF (der). Se copiaron las clases y specs (`.header-strip`, `.header-fields`, `.field/.label/.value`, etc.) tal cual obra. Subtítulo "ARTEFACTOS" y profesional "MARÍA JOSÉ BLANCO" se mantienen (propios del tipo de documento).
- **Datos**: se agregaron `clientPhone` y `ufReference` a `ArtefactosHTMLInput.project` (ya venían en `budget.project`, solo faltaba declararlos) para mostrar Celular y Valor UF como en obra.
- **Alcance**: solo `ArtefactosPDF.html.ts`. No toca cálculos. Verificado generando el PDF real (Portofino V1, dev): encabezado idéntico en estructura al de obra. `tsc` limpio.

## 2026-06-18 — Cotización de artefactos: manija de arrastre a la izquierda

- **Reordenar filas más fácil**: la manija de arrastre (⋮⋮) de cada artefacto pasó de la última columna (que quedaba fuera de pantalla a la derecha en esta tabla ancha) a la **primera columna, siempre visible**. Se agregó una columna de 1.5rem al inicio de la grilla (`gridColsCost`/`gridColsClean`), una celda vacía en el header, y los dos subtotales pasaron de `col-span-9` a `col-span-10`. El arrastre sigue reordenando **solo dentro del mismo ambiente** (lógica `onDragEndRoom` sin cambios). Verificado en vivo (Portofino dev, Chrome MJ): arrastrar reordena y persiste; grilla alineada. Solo UI; no toca `metrics.ts`.

## 2026-06-18 — Cotización de artefactos: ambiente editable + link al producto

- **Ambiente editable por bloque**: el banner gris de cada ambiente (room) en el editor de artefactos (`ArtefactosEditor.tsx`) pasó a tener "Editar ambiente" → reasigna el `room` de **todo el bloque** a otro ambiente conocido o uno nuevo escrito a mano. Resuelve el caso de artefactos cargados en el ambiente equivocado (ej. cocina/iluminación que quedaron en "Baño principal"), que antes no se podían mover. Reusa `updateItem` (persiste por item); `room` no está en los campos de sync, así que no contagia a copias del mismo producto en otros ambientes.
- **Botón "+ Nuevo ambiente"**: en la barra superior, abre el modal "Agregar del catálogo" ya posicionado en "+ Otro ambiente…" con el campo de texto listo (ej. "Baño 3"). Antes ese camino estaba escondido dentro del desplegable y no se encontraba.
- **Flechita ↗ al lado del nombre**: cada artefacto con `referenceLink` cargado muestra una ↗ que abre la página del producto en la tienda (mismo patrón que el buscador del catálogo). Solo aparece si hay link.
- **Alcance**: solo UI del editor de artefactos, un archivo. No toca `metrics.ts` ni cálculos. Verificado en vivo (Portofino, dev `ep-solitary-mud`, Chrome de MJ): los tres comportamientos OK; `tsc` limpio.

## 2026-06-17 — Dashboard EERR: vista Caja en dos niveles (operación / no operativo)

- **Por qué**: comparando la vista Caja contra Maxxa mes a mes (auditoría sobre prod), las diferencias de egreso (mayo +$17M, marzo +$9M vs Maxxa) se explicaron: el app contaba como egreso los **retiros de los socios** (transferencias a MJ/JT, categoría `sueldo`/`retiro_personal`) y el **pago de IVA al SII** (categoría `impuestos`), que Maxxa NO mete en el resultado. Los ingresos calzan bien con Maxxa sacando los "pagos proyectados" (ene/feb/jun dan exacto).
- **Decisión con MJ**: la vista Caja se muestra en dos niveles, sin esconder nada. (1) **Resultado de operación** = ingresos − gastos del negocio (materiales, mano de obra, subcontrato, sueldos de empleados, etc.) → responde "¿el negocio gana?". (2) Bloque **No operativo**: "Retiros de socios" + "Impuestos (SII)" — plata que sale pero no es costo de operar. (3) **Total mes (flujo real)** = operación + no operativo = flujo de caja completo.
- **Cómo se detecta el retiro de socio**: egreso cuyo `counterpartyRut`/nombre matchea a JT (18022887) o MJ (18023983). Los sueldos a empleados (no socios) se quedan como costo de operación. El pago de IVA = categoría `impuestos`.
- **Archivos**: `estadoResultadoCaja.ts` (clasificación op/no-operativo) y la tabla en `EstadoResultadoChart.tsx`. No toca la vista Facturación ni `metrics.ts`.

## 2026-06-17 — Dashboard EERR: dos vistas (Facturación SII / Caja banco) + arreglo de base

- **Problema detectado por MJ comparando contra Maxxa**: el gráfico mostraba utilidad año −$30,8M (pérdida), pero Maxxa daba +$53M. Auditoría contra prod (`ep-shy-morning`) encontró que el gráfico estaba **mal de base**: mezclaba ingresos solo-facturas con egresos facturas + banco (sueldos/previred/impuestos), quedando cojo (egresos casi completos, ingresos a medias) → pérdida ficticia. Tres mediciones limpias e independientes (facturas, caja, Maxxa sin "pagos proyectados") dan todas **entre +$12M y +$18M, en positivo**. Maxxa +$53M está inflado por "pagos proyectados" (+$35,5M, pagos que aún no ocurren).
- **Decisión con MJ**: separar en **dos vistas** con un toggle "Facturación / Caja" en el mismo bloque del dashboard.
  - **Facturación** (default): lee SOLO facturas (DTE) — lo que se declara al SII. Ingresos = emitidas; egresos = recibidas reales desglosadas por categoría (Materiales, Mano de obra, Subcontrato, Muebles, Artefactos…); **excluye sueldos, previred, impuestos y pagos sin factura 1043** (nada de eso es DTE ni va en el F29). Bloque de IVA débito/crédito/a pagar para leer el F29. Utilidad facturación prod 2026 ≈ **+$31,6M**.
  - **Caja**: tabla mensual estilo Maxxa desde movimientos bancarios + conciliación (flujo real, con sueldos y todo). Conciliado→categoría de su factura; sin factura→categoría del banco; sin clasificar→"No asignado"; traspasos internos en su fila (suman cero); neto-cero excluido. Validación: feb/mar 2026 calzan exacto con la tabla de Maxxa de MJ.
- **Archivos**: `estadoResultado.ts` reescrito (solo facturas + categorías + IVA), nuevo `estadoResultadoCaja.ts`, API devuelve ambas vistas, `EstadoResultadoChart.tsx` con toggle + tabla. La línea sigue mostrando utilidad del mes (no acumulada). No toca `metrics.ts`.

## 2026-06-17 — Dashboard EERR: la línea pasa de utilidad ACUMULADA a utilidad DEL MES

- **Por qué**: la línea acumulada (suma corrida del año, eje propio) confundía a MJ — no se entendía que arrancaba de cero cada enero (por eso 2025 salía toda verde y 2026 toda roja, sin relación entre años), y al estar en un eje aparte se veía desproporcionada ("muy arriba"). Decisión de MJ: que la línea muestre la utilidad de **cada mes**, no el acumulado.
- **Qué cambió** (solo presentación, en `EstadoResultadoChart.tsx`): la línea ahora grafica `utilidadNeta` mes a mes — verde si ese mes entró más de lo que salió, rosa si no. Como hay meses arriba y abajo del cero, la referencia de cero queda al medio (con 10% de aire arriba/abajo) y deja de pegarse al borde. El campo `utilidadAcumulada` sigue calculándose en la lib pero ya no se dibuja. Leyenda: "Utilidad del mes (neto)".
- **No toca cálculos**: `estadoResultado.ts` ya devolvía `utilidadNeta` por mes; solo cambió qué serie consume el gráfico.

## 2026-06-17 — Dashboard: gráfico "Estado de Resultado Anual" (ingresos vs egresos por mes)

- **Qué**: bloque nuevo en el Dashboard (debajo de los KPIs) que replica el gráfico que MJ miraba en Maxxa, con estética BLARQ. Una barra de **ingresos** (gris oscuro) y una de **egresos** (gris medio) por mes (ene–dic), con selector de año arriba a la derecha y **sin** botón Sync (la data ya vive en la app). Línea de **utilidad acumulada (neto)** superpuesta — verde si el acumulado va positivo, rojo si negativo (único uso de color, con significado). Al pasar el mouse por un mes, panel lateral con el desglose (Ventas/Devoluciones · Proveedores/Sueldos/Otros egresos), la utilidad del mes y el **IVA a pagar** (débito − crédito).
- **Base de los montos (decidido con MJ)**: barras y desglose en **c/IVA** (magnitud real de plata, igual que Maxxa); utilidad e IVA a pagar en **neto** (el IVA es de paso al SII, no es resultado — coincide con `utilidadReal` de `metrics.ts`).
- **Datos**: corte mensual de TODO el estudio (no por proyecto). Ingresos = facturas emitidas por `issueDate` (NC emitida resta). Egresos = facturas recibidas + pagos sin factura (1043) + egresos del banco sin factura (sueldos = `category=sueldo`; previred/comisiones/impuestos/tarjeta s/factura = otros egresos), excluyendo conciliados/internos/neto-cero para no doble-contar. Misma convención de signo de NC que `metrics.ts`.
- **Alcance**: NO toca `metrics.ts`. Cálculo nuevo en `src/lib/dashboard/estadoResultado.ts` (no duplica métricas por proyecto — es otro corte). API `GET /api/dashboard/estado-resultado?year=` (auth en el handler). Componente cliente `EstadoResultadoChart.tsx` (barras con divs, línea con `<svg>`, sin librería de gráficos). Verificado en vivo contra Neon dev: totales del año y desglose de abril cuadran con las facturas reales.

## 2026-06-17 — Presupuesto: unificar mano de obra por oficio en "Detalle por costo directo"

- **Síntoma**: en Presupuesto → Detalle por costo directo, la sección Mano de obra mostraba el mismo oficio repetido (MAESTRO 3-4 veces, igual PINTOR, GASFITER, CERAMISTA, JORNAL). Causa: la clave de agrupación era `descripción + unidad`, y un mismo oficio se carga con distinta unidad según la partida (GL en una, UN o M2 en otra).
- **Fix (solo visual)**: en `CostoDirectoDetalle.tsx`, la mano de obra (`type === "mano_obra"`) ahora agrupa **solo por descripción**, ignorando la unidad → cada oficio queda en una sola línea con su total. Cuando las unidades difieren, "Cant. total" y "Costo unit." quedan en "—" (el post-procesado ya nulea agregados de distinta unidad); el total en $ siempre se suma. El detalle por partida, con la unidad real de cada una, se conserva al expandir.
- **Alcance**: no toca `metrics.ts` ni ningún cálculo — el total general no cambia. Materiales y el resto de los tipos siguen agrupando por descripción + unidad (los materiales se unen por `materialId`, no por unidad). PR #151.

## 2026-06-16 — Facturas: estado y marca de NC separados (reemplaza "PAGADA CON NC")

- **Cambio de criterio (reemplaza el #38 de la entrada anterior).** El badge "PAGADA CON NC" secuestraba el estado: una factura anulada de verdad (proveedor facturó por error y emitió NC por el total, sin que se moviera plata) se mostraba como "pagada con NC", lo que contradice que es una anulación real. Se sacó ese relabel: ahora **anulada vuelve a leerse ANULADA**.
- **Dos ejes independientes.** Estado responde solo a *¿se movió plata mía?* → pagada / parcial / anulada. La "marca de NC" es un dato aparte: **"↳ NC F-xxx ($monto)"** clickeable que aparece siempre que una NC aplicó crédito a la factura, **tanto en pagadas como en anuladas** — en la lista `/facturas`, en la pestaña de facturas del proyecto, y en la ficha (bloque "Notas de crédito aplicadas").
- **Solo presentación.** El estado crudo en BD no cambia; `metrics.ts` ya descuenta la NC por su lado. Se eliminó el flag `paidWithNc` del helper `statusBadge.ts`. Verificado en datos reales (MK): la marca sale en las facturas con NC; types limpios.
- **Pendiente (Fase 2, no en este cambio).** Modelar saldo a favor reutilizable: una NC que sobra y se gasta de a pedazos en compras nuevas distintas (hoy una NC se consume entera contra una sola factura).

## 2026-06-16 — Facturas/banco: etiquetas de NC + devolución neto cero

- **"Pagada con NC" (#38)**: una factura cubierta entera por el crédito de una NC mostraba "ANULADA" (confuso). Ahora, si tiene una NC aplicada, el badge dice "PAGADA CON NC" (verde); si se anuló sin crédito detrás, sigue diciendo "ANULADA". Solo presentación — el valor en BD sigue siendo `anulada`, la plata no cambia. Helper compartido `src/lib/facturas/statusBadge.ts` (lista global + lista por proyecto).
- **NC compensada ya no vuelve a "pendiente" (#39)**: el form de edición de una NC tenía un dropdown de Estado que, al guardar, pisaba la compensación (la NC volvía a "pendiente"). Para NC se sacó ese dropdown y el guardado ya no manda `status`; además, el PUT `/api/facturas/[id]` solo toca el estado si viene en el payload (red de seguridad). Una NC compensada muestra el badge "COMPENSADA".
- **Compensar NC ofrece solo facturas con saldo (#37)**: el panel "elegí la factura a la que se aplicó el crédito" listaba todas las del proveedor (pagadas incluidas); ahora filtra a pendientes/parciales. El dropdown "factura referenciada" del form sigue con la lista completa (la referencia SII puede apuntar a una pagada).
- **Devolución neto cero (#27)**: plata que entró y volvió (ej. cliente transfirió por error y se le devolvió) — acción masiva en `/banco/movimientos` que agrupa las entradas+salidas que se cancelan (valida neto ≈ 0), las saca de pendiente con estado `neto_cero` y las excluye de los totales de ingreso/egreso. No cuenta como ingreso ni gasto. Reversible ("deshacer" suelta el grupo). Schema: campo nuevo `BankMovement.netZeroGroupId` (aditivo).
- **Pestañas del banco simplificadas**: se sacó la pestaña combinada "Pendientes" (juntaba sin_asignar + parcial). Quedan las pestañas de estado separadas (Pendiente, Parcial, Conciliado, Sin factura, Transfer interna, Neto cero) y la vista por defecto al entrar a `/banco/movimientos` pasa a ser **"Todos"** (antes era "solo pendientes"). `status=all` se mantiene como alias de "sin filtro" para los links de drill-down.
- **Alerta de sobreimputación**: badge rojo "⚠ imputado de más" en la lista de movimientos cuando la suma de los pagos de un movimiento supera su monto (±$10). Red de seguridad para dato viejo / edición manual de la BD — la app ya impide crearlo en los 5 caminos de imputación (validación de monto, reemplazo en masivo, candado `already_has_payments` en auto-conciliación). Auditoría puntual en prod 2026-06-16: 0 movimientos sobreimputados, 0 facturas sobrepagadas.

## 2026-06-15 — Seguridad: toda la API exige sesión por defecto (H1) + secret de Telegram obligatorio (H17)

- **Causa (auditoría 2026-06-15, hallazgo H1 CRÍTICO)**: la API estaba sin autenticación — 84 de 85 endpoints `/api` respondían sin login. El login protegía las páginas, no las rutas API → se podía borrar facturas, mover plata, disparar sync o cerrar EPs salteándose el login.
- **Fix (negar por defecto)**: helper `requireSession()` (`src/lib/apiAuth.ts`) llamado como primera línea de cada uno de los 88 endpoints protegidos (126 handlers). El control vive **dentro del handler**, no en middleware/proxy — a prueba del bypass del **CVE-2025-29927**. Allowlist de 2 exentos: `auth/[...nextauth]` (login) y `telegram/webhook` (secret propio). `img-proxy` quedó gateado (solo lo usa el catálogo logueado; los PDF no lo usan).
- **Guardián en el build**: `scripts/check-api-auth.mjs` corre antes de `next build` (`"build": "node scripts/check-api-auth.mjs && next build"`) → un endpoint nuevo sin `requireSession` **hace fallar el deploy de Vercel**.
- **H17**: el secret del webhook de Telegram pasó de condicional (`if (secret)`) a **obligatorio** (sin variable → 503). Ya está seteado en Vercel Production.
- Sin `proxy.ts` (no es la cerradura). `tsc` limpio; verificado en dev (sin login → 401 en endpoints/PDF/destructivos; logueada → todo normal, fotos del catálogo cargan). ADR: `docs/decisions/2026-06-15-api-requiere-sesion-por-defecto.md`.

## 2026-06-12 — Rendimiento: excluir el PDF crudo (`pdfContent`) de las queries de métricas

- **Causa (auditoría 2026-06-12)**: el Dashboard, `/proyectos`, `/cotizaciones` y `/proyectos/[id]/resumen` traían el campo `Invoice.pdfContent` (Bytes — el PDF oficial del SII cacheado en BD, ~100-200 KB c/u) de **todas** las facturas, aunque `computeProjectMetrics` no lo usa ni se muestra. Cada carga del Dashboard descargaba decenas/cientos de MB desde Neon y los descartaba.
- **Fix**: `omit: { pdfContent: true }` en el include de `invoices` de `PROJECT_METRICS_INCLUDE` (`src/lib/projects/metrics.ts`) y en la query del Resumen (`proyectos/[id]/resumen/page.tsx`). Mismo patrón que `/facturas` ya usaba. Solo display/carga — **no cambia ningún cálculo** (verificado: métricas idénticas con y sin el campo).
- **Alcance acotado**: no se agregaron índices ni caché (otros hallazgos de la auditoría, en sesiones aparte). La ficha de factura individual sigue cargando `pdfContent` a propósito (lo sirve al PDF, server-only). ADR: `docs/decisions/2026-06-12-no-cargar-bytes-pesados-en-ui.md`.

## 2026-06-11 — Artefactos: línea/color como columnas (catálogo y cotización) + lista compacta

- **Catálogo (PR #123/#124)**: Línea y Color dejan de ser chips arriba y pasan a **columnas** editables; el filtro es un **desplegable en el encabezado** de cada una. Nombre y detalle envuelven a 2 líneas (no se cortan). Orden de columnas: foto · nombre · LÍNEA · COLOR · detalle/link · subcat/tipo · resto. La línea se muestra en MAYÚSCULA.
- **Cotización — editor de artefactos (PR #125/#127/#128)**: lista más **compacta** (foto 80→44px, fila más baja → ~el doble de filas por pantalla). Item y detalle a 2 líneas (no se cortan). Se agregan columnas **Línea** (mayúscula) y **Color**, derivadas del nombre con el mismo parser del catálogo (solo lectura, no se guardan en `ArtefactoItem`; si hay que corregir línea/color de un producto se hace en el catálogo). Ajuste de anchos: item más ancho, cantidad más apretada.
- Verificado en vivo en prod (Chrome de MJ): filtros del catálogo, agregar del catálogo, ↗ver, borrar, arrastrar, y las columnas/compactado de la cotización.

## 2026-06-11 — Artefactos: agregar del catálogo, editar (link/borrar/arrastrar), línea+color

- **Agregar del catálogo desde el presupuesto (PR #118)**: botón "+ Agregar del catálogo" de nivel superior en el editor de artefactos del presupuesto (servía solo desde el "+ agregar" de cada room, que no existe con la cotización vacía → no se podía cargar el primero). Modal con selector de ambiente + tipo + buscador del catálogo; queda abierto para sumar varios. Reusa `AddArtefactoFromCatalog`.
- **Links/precios LED Studio**: los 3 de iluminación tenían foto pero no link ni precio web. Se completó `referenceLink` y `listPrice` desde ledstudio.cl (VTEX, por RefId).
- **Editor de artefactos (PR #119 + #120)**: en el buscador del catálogo, link "↗ ver" al producto + la fila deja de ser un botón completo (solo "+ agregar" suma). En las filas del presupuesto: **borrar (×) visible** y **arrastrar (⋮⋮) para reordenar** dentro del room (dnd-kit, persiste por el PUT por ítem). Se **sacó la estrella** ★ (link/unlink al catálogo) que confundía: lo que se agrega del catálogo queda ligado solo; lo suelto se sube desde la pantalla del catálogo.
- **Línea + Color en el catálogo (PR #121)**: campos `line` (Asis/Urban/Stellar…) y `finish` (Cromo/Brushed/Gun Grey…) en `ArtefactoCatalog` (nullable, aditivo). **Chips de filtro** por línea y color en el catálogo, se ven en cada fila y se editan en "Editar". `scripts/parse-linea-color.cjs` los rellena parseando el nombre (línea solo del nombre para no agarrar el lavamanos del detalle; color de nombre+detalle). Aplicado en prod (schema + parse): 91 artefactos, 58 con línea/color. Pendiente sugerido: sumar los mismos filtros al buscador del presupuesto (`AddArtefactoFromCatalog`).

## 2026-06-11 — Artefactos: "Extraer" sugiere nombre, foto KH, "+ Nueva" vacía, links LED

- **PR #115 — "Extraer" sugiere el nombre corto**: al autocompletar pegando un link, propone el `Nombre (corto)` desde el título (saca la marca + mayúsculas), solo si está vacío (no pisa lo escrito). **+ foto Kitchen House por "Extraer"**: se agregó `kitchenhouse.cl` a la whitelist del img-proxy (el "Extraer" trae la foto por el dominio de la tienda, no por cdn.shopify.com → antes la bloqueaba y se veía el "+").
- **PR #116 — "+ Nueva" versión viene vacía**: bug — al crear una "+ Nueva" cotización (obra/muebles/artefactos) venía prellenada con la versión anterior. Causa: `/api/presupuestos` POST hacía `baseId = baseVersionId || existing[0].id`, y "+ Nueva" no manda `baseVersionId` → copiaba la última. Fix: `baseId = baseVersionId || null` → "+ Nueva" vacía, "Duplicar" copia, importar-desde-otro-proyecto (resetQuantities) sigue igual. Alcance: los 3 tipos.
- **Links LED Studio**: los 3 artefactos de iluminación tenían foto pero no link; se completó el `referenceLink` desde ledstudio.cl (VTEX, por RefId). Ahora todos los proveedores publicados (MK, Kitchen House, LED Studio) están linkeados; sin link quedan solo los 9 de MK que no están online.

## 2026-06-11 — Catálogo de artefactos: links de Kitchen House + limpieza de nombres genéricos

- **Links Kitchen House (20)**: los artefactos Teka se cargaron con foto y precio pero sin link. Se completó el `referenceLink` con la página de kitchenhouse.cl de cada uno, matcheando contra la **foto guardada** (SKU verificado) para que el link apunte al mismo producto que la foto (`scripts/arreglar-catalogo.cjs`, `kh-links-*`). El 403 al abrir las páginas por script es anti-bot del sitio, no link inválido.
- **Sin duplicados reales**: revisión por código MK, link KH y similitud de nombre. NINGÚN producto estaba cargado dos veces. Lo que parecía repetido eran **nombres genéricos** del catálogo viejo (distintos productos con el mismo nombre vago). Se **renombraron 8** usando el detalle: DESAGUE→Infloor Line 600, MAMPARA→Fija Brooklin 100, PLATO DUCHA→Luxor Redondo 25, WC→Atenas Two Piece Muro, UNION MURO ×2 (Trento Cromo / New Home Brushed), SET BARRA DUCHA ×2 (Luxor Cromada / New Home Brushed). Las 2 encimeras HLX 540 (IX BUT vs Inox Natural) resultaron correctas (SKUs 112620022/112620023 distintos) — falsa alarma. Prod sigue en 86, 0 nombres idénticos.

## 2026-06-11 — Catálogo de artefactos: tipos por pestaña (cocina con sus propios tipos)

- **PR #112**: el desplegable de "tipo" y el orden de los grupos pasan a depender de la **subcategoría/pestaña** (antes era global, solo con los tipos de baño → cocina no se podía organizar). `TIPO_OPTIONS_BY_SUB`: **cocina** = Lavaplatos·Griferías·Hornos·Encimeras·Campanas·Refrigeración·Lavavajillas·Microondas; **baños** = los de antes; **iluminación** = sin tipos por ahora. El agrupado se calcula sobre la pestaña activa, así que "Griferías" en cocina y en baños no se mezclan.
- **Datos (prod + dev)**: `scripts/taggear-cocina.cjs` asignó el tipo a los 24 artefactos de cocina por nombre, con prioridad (GRIFO LAVAPLATOS → Griferías; LAVAPLATOS BAJO ENCIMERA → Lavaplatos). 24/24 agrupados, 0 sin match. Rama `feat/cocina-tipos`.
- Pendiente relacionado (chip): subdividir "Duchas" (baños) en ducha/receptáculo vs tina.

## 2026-06-11 — Catálogo de artefactos: agrupar por tipo (PR #107) + carga de 50 artefactos de cotizaciones a prod

- **PR #107 mergeado a prod** (`feat(artefactos): tipo desplegable + foto y proveedor editables`): tipo como desplegable (Accesorios·Griferías·Duchas·Muebles·Mamparas·WC), **agrupar de verdad por tipo** (un encabezado por tipo, ordenado por el desplegable — resuelve los encabezados repetidos cuando los items del mismo tipo no eran contiguos), proveedor editable, subir foto desde el computador, formulario completo de edición, Enter guarda, descripción en 2 líneas, e `img-proxy` para que las fotos del CDN no las bloquee el ad-blocker.
- **Proxy de imágenes**: whitelist de hosts de tiendas conocidas (anti-SSRF). Se agregó `cdn.shopify.com` para Kitchen House (Teka corre en Shopify).
- **Carga de 50 artefactos** de cotizaciones MK + Kitchen House + LED Studio (obras Pauline, Depto JNC, Paseo del Sena): muebles/WC cargados como **un solo artefacto con costo = suma del desglose** del PDF; provisiones (porcelanatos/cerámicas) y fittings sueltos omitidos; deduplicado por **código MK** contra lo ya cargado. Costos del PDF (netos) → con IVA. MK/LED por API VTEX, Kitchen House por buscador Shopify (match por SKU en el nombre del archivo). 41/50 con foto (9 sin foto = MK no los publica online).
- **Migración a prod** (`scripts/migrar-a-prod.cjs`, atómica + respaldo): prod tenía una carga parcial previa (7 items con link/foto/precio pero **costo en 0** y nombres a medias) → se reemplazaron por la versión completa; +43 nuevos. Prod: 29 → **72 artefactos** (54 sanitario, 15 cocina, 3 iluminación), 0 códigos MK duplicados. Rama `feat/cargar-artefactos-cotizaciones` (worktree, scripts).
- **2º lote — cotizaciones A CLIENTE** (Matías Herrera + Pauline Dumay, precios viejos): se identificó cada producto en la web y se cargó el **precio web de hoy como precio a cliente, SIN "mi costo"** (no lo tenemos para estas). Deduplicado contra los 72 de prod (por nombre y código MK): 14 nuevos a prod (`scripts/migrar-cliente-a-prod.cjs`, +respaldo) → **prod 86** (59 sanitario, 24 cocina, 3 iluminación). La Percha Asis Doble se saltó: ya estaba (la "PERCHA ASIS CROMO" de prod tiene el código de la doble, acc080030). Fotos: Teka por buscador Kitchen House (precio en pesos directos, no centavos), MK por VTEX. Omitidos: Tina Single Plus 140 y Mueble Nepal 1200 (la web no tiene ese tamaño exacto). **Pedido de MJ para después** (tarea aparte): subdividir el tipo "Duchas" en ducha/receptáculo vs tina.

## 2026-06-10 — Catálogo de artefactos: proxy de imágenes (fotos que no cargaban)

- **Fotos que no cargaban**: las imágenes viven en el CDN de mk.cl (`mkchile.vtexassets.com` / `vteximg.com.br`). Cargan bien por HTTP (verificado: 23/24 daban 200), pero a MJ se le veían "todas rotas" — casi seguro un bloqueador del navegador que filtra ese CDN. Fix robusto del lado app: nuevo endpoint `GET /api/catalogo/img-proxy?u=<url>` que trae la imagen del CDN desde el servidor y la sirve por NUESTRO dominio, con whitelist de hosts (mk.cl/vtexassets/sodimac/easy…) para evitar SSRF y cache agresivo. El componente manda las imágenes externas por el proxy (`imgSrc()`); las subidas (data:) van directo. Así el navegador nunca le pide nada al CDN → no hay nada que bloquear.
- **Foto muerta de MEZCLADOR** (era la única con URL 404, `GKL-03-0061` vieja): re-buscada la imagen actual en la API de VTEX y actualizada en prod.

- **Foto rota → "+"**: si una imageUrl no carga (ej. links viejos de mk.cl / mkchile.vtexassets.com que ya no existen o están bloqueados), la fila muestra el "+" para subir otra, en vez del ícono de imagen rota. `onError` en el `<img>`.
- **Enter guarda el formulario**: el cuadro de alta/edición pasa a ser un `<form>` con `e.preventDefault()` + botón submit; "Extraer" y "Cancelar" quedan `type="button"`. Antes Enter no hacía nada.
- **Descripción (detalle) en 2 líneas y tipografía chica** (`textarea rows=2`, `text-[11px]`): los modelos largos no entraban en una sola línea.

- **Anchos de columna**: los nombres largos (ej. "PORTARROLLO ATLAS BRUSHED") se truncaban porque las columnas numéricas de la derecha se llevaban mucho ancho. Se apretaron las columnas de la derecha (lista/dcto/total/costo/gan/std/editar), se redujo el `gap` y el padding, y se le dio prioridad al nombre. Además la tabla tiene **scroll horizontal** de red de seguridad con un mínimo en nombre/detalle: en pantalla ancha entra todo sin scroll; en pantallas angostas/zoom, el nombre se ve completo y se scrollea el resto. Imagen de fila a 48px.

- **Cuadro de edición completo** (MJ se arrepintió de la edición solo-inline): cada fila tiene un botón "Editar" que abre el mismo formulario del alta, pre-llenado con TODOS los campos — incluido el **link** y el **tipo**, que no se podían editar en la tabla. Reusa `newItem` + `editingId`; guarda con PUT. La edición inline en la tabla se mantiene como atajo.
- **Agrupado real por tipo** (antes el encabezado salía "cada vez que cambiaba el tipo en el orden" → si había items del mismo tipo separados, aparecían encabezados duplicados, ej. "DUCHA" dos veces; y los "sin tipo" colgaban del grupo anterior). Ahora se juntan TODOS los del mismo tipo bajo un solo encabezado; los sin tipo van a su propia sección "Sin tipo" al final. Orden de grupos por `TIPO_OPTIONS`. El arrastre pasa a ser **dentro de cada grupo** (para cambiar de tipo se usa el desplegable). Etiquetas finales: Accesorios · Griferías · Duchas · Muebles · Mamparas · WC (+ normalización de los tags viejos de prod).

- **"Tipo" pasa a desplegable cerrado** (accesorio, grifería, ducha, mueble, mampara, wc + "sin tipo"), en la fila y en el alta. Sigue agrupando: los del mismo tipo se juntan bajo un encabezado (MJ confirmó querer el agrupado, no el orden libre). Aplica a las 3 pestañas (Baños/Cocina/Iluminación) por ser la misma pantalla.
- **Editar directo en la tabla** (no formulario aparte): se suman dos campos editables inline que faltaban — **proveedor/tienda** (debajo de la marca; resuelve el caso "marca CHC vs tienda MK") y **foto**. El resto (nombre, marca, detalle, precios, dcto, std, subcategoría) ya era editable inline.
- **Subir foto desde la compu**: click en la celda de imagen abre el selector de archivo; la foto se **achica a miniatura comprimida** (máx 600px, JPEG ~0.8 → de 3-5 MB a ~40-100 KB) y se guarda como data URL en `imageUrl`, sin almacenamiento externo (no requiere infra). También en el alta ("Subir foto" + queda el campo de URL). Helper `fileToThumbnailDataUrl` (canvas). Si el catálogo crece mucho, migrar a almacenamiento en la nube (Vercel Blob).
- Limpieza: se eliminó un byte nulo viejo en el sentinel `prevTag` (hacía que git/grep trataran el archivo como binario). Solo UI; sin cambios de schema ni de datos. Verificado: typecheck limpio + visual con mock (agrupado, desplegable, proveedor, foto).
## 2026-06-09 — Catálogo de artefactos: columnas Lista / Dcto / Total + costo oculto + "Revisar precios"

- **Layout como el Excel de MJ**: la tabla muestra, por fila, **Precio lista (sin dcto) · Dcto % · Total** (lo que paga el cliente = lista × (1 − dcto)), y aparte **Mi costo · Ganancia** en columnas con fondo gris (NO las ve el cliente; ganancia = Total − Mi costo). El dcto es editable (auto del web cuando la tienda lo exponga; si no, en blanco). El costo se carga a mano (a futuro: subir el PDF de la vendedora y autocompletar). Total y ganancia se calculan solos.
- **Modelo**: `listPrice` (lista sin dcto) + `discountPercent` (dcto al cliente, ahora el driver) + `realCostBlarq` (mi costo, manual). Se agregaron columnas `clientPrice` (queda sin uso por ahora) + `realCostBlarq` a `ArtefactoCatalog` (aditivo). El par `listPrice`+`discountPercent` es el mismo que ya consumen los presupuestos (`ArtefactoItem`).
- **Botón "Revisar precios"** (`POST /api/catalogo/artefactos/revisar-precios`): trae el precio del web de hoy y muestra guardado vs web (lista, dcto y total); MJ aplica los que quiere. Al aplicar actualiza **lista Y dcto** con lo del web (el Total se recalcula); el costo no se toca.
  - **mk.cl es VTEX y renderiza el precio por JavaScript** → NO está en el HTML, así que el scraper simple (`fetchArtefactoData`) devolvía "sin-precio". Se agregó `src/lib/catalog/fetchMkPrice.ts` que pega a la **API pública de catálogo de VTEX** (`/api/catalog_system/pub/products/search/<slug>/p`) y trae `ListPrice` (lista) + `Price` (con dcto) → de ahí sale el **descuento del web automático** (ej. griferia Urban: lista 105.190, precio 69.990 → 33%). Verificado contra URLs reales de mk.cl.
  - Otras tiendas (sodimac/easy): siguen por `fetchArtefactoData` (solo precio, dcto 0) hasta tener su API.
  - La route declara `runtime="nodejs"` + `maxDuration=60` para que en Vercel no se corte (el fetch desde la nube tardaba > 10s → 504 → era el alert "no se pudieron revisar los precios").
- **Migración** `scripts/migrar-precios-artefactos.ts` (idempotente): "empezar de cero" — descarta el descuento viejo (−20/−33%, no confiable) dejando `discountPercent = null` (dcto en blanco, Total = lista). Verificado en dev (modelo + endpoints + typecheck + visual con datos mock). Columnas ya aplicadas en prod; falta correr la migración en prod.

- **Bug (MJ)**: al asignar centro de costo a una factura/movimiento, el selector de proyecto listaba TODOS los proyectos, incluidas las cotizaciones (`status="cotizacion"`) que todavía no son obras.
- **Fix**: las 4 superficies de asignación (`facturas/page.tsx`, `facturas/[id]/page.tsx`, `banco/movimientos/page.tsx`, `proyectos/[id]/facturas/page.tsx`) filtran con `where: { NOT: { status: "cotizacion", isInternal: false } }` — esconde solo las cotizaciones, mantiene obras en ejecución + terminadas + centros internos (BLARQ). Decisión de MJ: dejar también las terminadas (facturas tardías). Solo cambia las OPCIONES del desplegable; no toca asignaciones guardadas. Prod: esconde 5 cotizaciones, deja 26.

## 2026-06-08 — NC: estado "aplicada" coherente + auto-compensación de NC emitidas en el sync

- **Bug (MJ)**: al anular una factura con su NC, la factura quedaba "anulada" pero la NC seguía "pendiente". Caso real: NC 5 emitida (Industrial y Comercial Pite, obra Rosas) ↔ factura 165 anulada. Causa: ningún camino daba vuelta el estado de la NC misma salvo el sync, que **solo miraba recibidas**; las emitidas no tienen auto-link y se compensaban a mano (botón "Anula factura emitida"), dejando el estado atrás.
- **Datos prod** (`scripts/fix-nc-compensada-pendiente.ts`, dry-run + backup, Δ$0): 4 NC con `compensationType` lleno pero `status="pendiente"` (2× f5 aplicadas a factura, 2 Icónica reembolso al banco) → "pagada" (aplicada). El estado no afecta `metrics.ts` (la NC ya resta por tipoDoc=61).
- **Código** (`linkNcReferences.ts` + `siiRcv.ts` + `runSiiSync.ts`): el auto-link del sync ahora procesa **recibidas Y emitidas** — recibida por registro de COMPRA (contraparte = proveedor/rutIssuer), emitida por registro de VENTA (contraparte = cliente/rutReceiver). `getDteReferencias` acepta `operacion` (default COMPRA → callers intactos). `autoApplyNcCompensation` ya resolvía emitidas; solo faltaba alimentarlo. Aditivo y con candados (solo coincidencia exacta folio+RUT, solo estado, nunca montos); no-op si el SII no devuelve la referencia. Verificable solo en el sync real con cert (local).

## 2026-06-06 — Presupuesto: desglose = única verdad (catálogo opt-in, encabezado espejo, provisión y pérdida)

- **Regla**: el total al cliente sale SIEMPRE del desglose; el encabezado es solo su espejo; el catálogo es biblioteca de moldes y NO propaga solo a otras cotizaciones (solo a cotizaciones futuras al agregar la partida).
- **R3 — catálogo opt-in**: sacada la propagación automática del PUT `catalogo/partidas/[id]` que arrastraba todos los borradores al "Mandar al catálogo" (causa del enredo de Constanza). Ahora ese botón toca solo el molde.
- **Paso 6 — panel "Actualizar" cambio por cambio**: el banner ámbar pasa de aplicar-todo-a-ciegas a un panel que lista cada diferencia (precio / material nuevo / eliminado) con un check por cambio. `GET auditoria-precios` devuelve `changes[]`; nuevo endpoint `auditoria-precios/aplicar` re-valida en server y aplica SOLO lo marcado. Tipo `src/lib/catalog/auditChanges.ts`.
- **R2 — encabezado espejo**: en la fila de la partida, Mano de obra y P. Unitario quedan de solo lectura cuando hay desglose.
- **Paso 2+3 — provisión editable**: las líneas de provisión (material `isProvision`) se ven/editan en el desglose con su precio **c/IVA** (se guarda el neto ÷1,19); chip "provisión". Resuelve editar la provisión de una partida ya agregada y elimina su descuadre.
- **Paso 4 — pérdida sobre "todos los materiales"**: la pérdida % puede aplicarse sobre la suma de todas las líneas material (`appliedToType="material"`), no solo sobre una. Cambiado en los 2 motores (recalcObraItem, recalcPartida) y los 2 editores. Tests: `test-perdida.ts`, `test-perdida-todos-materiales.ts`. Verificado visual en dev (panel, encabezado, provisión).
- **Datos prod** (con backup, plata real Δ$0): cuadre de 3 borradores (Paseo del Sena, Cocina Candelaria/2; **Portofino excluida**) + 14 moldes del catálogo sin desglose sembrados (Σcost==P.U.) → catálogo con 0 partidas sin desglose. Foto pre/post `snapshot-metrics`: cobrado/gastado/utilidad real intactos.

## 2026-06-05 — Catálogo: "Precios a catálogo" ahora sube el desglose completo (incluida la pérdida)

- **Bug**: el botón "↑ Precios a catálogo + borradores" solo mandaba los 6 montos globales (`cost*`), NO el desglose por componente. Como el catálogo deriva sus totales DEL desglose (`recalcPartidaTotals`), una pérdida agregada en la cotización nunca quedaba como línea en el catálogo, y el monto que sí recibía arriba se borraba solo en el siguiente recálculo. La flechita ↑ por línea subía la línea pero perdía `appliedToComponentId` → la pérdida % se calculaba en $0.
- **Fix** (`src/lib/catalog/pushObraItemToCatalog.ts` + endpoint nuevo `presupuestos/[id]/partidas/[itemId]/al-catalogo` + `ObraEditor.handleUpdateCatalog`): el botón masivo sube el desglose completo al catálogo (upsert por vínculo/equivalencia, anti-duplicado) traduciendo el puntero de la pérdida al material del catálogo (procesa materiales antes que pérdidas) y recalcula; recién después propaga precios a borradores con el PUT de siempre. El ↑ por línea ahora delega en el mismo helper y arrastra el material destino de una pérdida. Único tipo afectado: la pérdida (leyes/margen no usan puntero por-id). Verificado dev (`test-al-catalogo-perdida.ts`) + smoke HTTP; sin regresión en los tests de cálculo.
- **Datos prod** (`fix-perdida-guardapolvo-catalogo.ts` / `fix-perdida-candelaria.ts`, dry-run + backup, % derivado del monto para Δ$0): la pérdida fantasma de "INSTALACION GUARDAPOLVO PORCELANATO" (número $1.260,5 sin línea, dejada por el botón viejo) se materializó como línea "15% del porcelanato" en el **catálogo** y en **Cocina Candelaria/V1** (borrador); total sin cambio ($20.572). Casa Arrau/V5 (aprobada) se deja congelada.

## 2026-06-05 — Conciliación: NC sobre factura pagada ya no la anula + señales de saldo a favor

- **NC parcial sobre factura ya pagada ya no la anula** (`linkNcReferences.ts` automático + `facturas/[id]/compensar` manual): antes, cualquier NC cuyo monto + lo pagado llegaba al total tiraba la factura a "anulada" aunque ya estuviera pagada entera (una devolución de $66k sobre una factura pagada de $341k la borraba). Ahora distingue 4 casos: pagada entera + NC → queda "pagada" y la NC queda sin clasificar (devolución a resolver); pagó una parte + NC cubre el resto → "pagada" (saldada); no pagó nada + NC cubre todo → "anulada" (único caso que anula); NC chica con saldo → "parcial". El gasto por obra NO cambia (`metrics.ts` ya resta la NC por tipoDoc=61, sin mirar el estado).
- **Datos prod** (`scripts/fix-nc-anuladas-pagadas.ts`, dry-run + backup + verificación Δ$0): 13 facturas mal-anuladas (pagadas reales $6,6M, casi todas Sodimac/Comercial K) → "pagada"; sus 14 NC → sin clasificar. Re-conteo: 0 mal-anuladas (quedan 28 anuladas legítimas = "no se pagó nada").
- **Barra de saldo a favor** en `/facturas`: cuenta las NC recibidas sin clasificar y su total ("N notas de crédito sin clasificar — $X a favor"), gris/mono como la del SII, atajo `?sinClasificar=1`. Surge plata a favor antes invisible (prod: 24 NC / $6,8M).
- **Columna "Saldo"** en la lista global: muestra lo que falta (azul si parcial, gris si pendiente, "—" si saldada). La query global ahora trae `amountApplied` + créditos de NC, igual que la lista por proyecto. Solo display. (rama `feat/conciliacion-unificada`, NO desplegada)

## 2026-06-05 — Presupuesto: densidad del detalle, negrita en descripciones y fix de duplicación

- **Buscador de material + "Detalle por costo directo"** (PR #94): en el buscador de material de una partida, el nombre ahora se ve completo y la categoría pasó a subtítulo gris (antes cortaba el nombre). En "Detalle por costo directo", cada sección (Materiales, Mano de obra, …) tiene una flechita para colapsarla + botón global "Ocultar todo / Mostrar todo"; tipografía ~2pt más chica e interlineado más apretado.
- **Negrita tapada por el sidebar** (PR #93): la barra de formato flotante (`BubbleMenu`) de las descripciones aparecía centrada y, al seleccionar cerca del borde izquierdo, su lado izquierdo —el botón B— quedaba debajo del sidebar y no se veía. Fix: `placement: "top-start"` + `shift` con padding izquierdo. La B existía y funcionaba; solo estaba tapada.
- **Duplicación de obra perdía el desglose** (PR #95): al duplicar un presupuesto de obra se copiaban los montos globales de cada partida pero NO sus `ObraItemComponent` (el detalle quedaba vacío). Ahora se copian, remapeando `appliedToComponentId` (pérdida→material) en dos pasadas. Backfill puntual en prod del duplicado de Colon ya afectado ("V1-editada sin ampliacion": 23 partidas / 126 componentes copiados desde "V1_Sin ampliación", con backup; sin pisar las partidas ya editadas a mano).
- Antecedente del mismo hilo (06-04): densificación de la vista expandida de partida (~918→~490px) y línea entre filas del detalle más visible (PRs #84/#85/#86).

## 2026-06-05 — Catálogo: panel de precios multi-tienda con búsqueda en vivo (VTEX/mK)

- El panel de precios de un material (`MaterialOffersDrawer`) se rediseñó para **mostrar todas las ofertas guardadas** (tienda, neto/IVA, stock, link) y permitir **fijar la oficial con un click** ("Usar esta") sin perder las demás. Esos datos (`MaterialPriceOffer`) ya existían en la BD pero la UI no los exponía: solo dejaba editar un precio/link a la vez.
- **Búsqueda en vivo**: nuevo motor VTEX en `src/lib/catalog/fetchPrice.ts` (`searchStoreProducts` + `VTEX_STORES`) que consulta la API pública de catálogo y devuelve candidatos con **precio y stock de hoy**. Nuevo endpoint `POST /api/catalogo/buscar-precio`. Sirve para relinkear cuando el producto viejo se movió (caso real: el guardapolvo foliado apuntaba a un link mK ya inexistente; catálogo $4.990 vs ~$6.990–9.990 hoy). Solo **mK** verificada hoy — Construmart/Imperial/Easy/Chilemat no exponen esa API (devuelven HTML). `fetchPriceFromUrl` también detecta dominios VTEX.
- **Fix**: al fijar una oferta (POST y PATCH de ofertas) ahora se llama `syncMaterialToComponents` — antes cambiaba el `netPrice` del catálogo pero dejaba las partidas con el precio viejo. El POST además despinea las otras ofertas (faltaba).
- Detalles: query del buscador prellenada suavizada (minúsculas + medida triple `15x90x2400mm` colapsada a `15x90`, porque el nombre exacto del catálogo no calza en la búsqueda); botón "Precios" sin emoji (regla BLARQ). UI pura sobre datos, no toca `metrics.ts`. (rama `feat/catalogo-precios-multitienda`)

## 2026-06-04 — Presupuesto: vista expandida de partida densa (~918→~490px)

- El panel que se abre al expandir una partida (pestaña Presupuesto) ocupaba ~918px (más de una pantalla). Se compacta a ~490px **manteniendo toda la info**, a densidad tipo planilla maestra: descripciones cliente/maestro **lado a lado** (antes apiladas) con letra de 9px e interlineado apretado; 6 rubros de costo + suma en una fila; tabla "Detalle de materiales y costos" en modo denso (10px, filas pegadas, chips de tipo sin alto extra, totales 9px, botones "+Material…" más chicos).
- El layout expandido se extrajo a un componente nuevo `PartidaExpandedPanel.tsx` (acota el cambio en `ObraEditor.tsx`). La densidad de la tabla se activa con un prop `dense` en `ObraItemComponentsEditor` (default off → la vista normal de esa tabla queda igual). UI pura, no toca cálculos ni `metrics.ts`. (PR #84)
- **Arreglo lateral** (aplica también a la vista normal): el link ↗ de los materiales con referencia caía en una 2ª línea e inflaba esas filas; ahora va en la misma línea (flex).
- Nota: el panel se diseñó sobre un `main` previo al PR #80 (toolbar flotante). En prod la barra de formato es el `BubbleMenu` flotante; las descripciones quedan sin barra fija (aún más compactas). Verificado: build de prod OK y endpoint de componentes 200 en producción (el 404 visto en dev era artefacto de turbopack con esa ruta anidada).

## 2026-06-03 — Catálogo de artefactos: pestañas por subcategoría + orden manual (drag) agrupado por tipo

- **Pestañas** Sanitario / Cocina / Iluminación (con contador) reemplazan el desplegable de subcategoría en `/catalogo/artefactos` — botones arriba, un click. La búsqueda y el filtro "Solo paleta estándar" siguen operando dentro de la pestaña activa.
- **Orden manual**: nueva columna `ArtefactoCatalog.sortOrder` (Int, default 0) + índice `[subcategory, sortOrder]`. Arrastre de filas con dnd-kit (`PATCH /api/catalogo/artefactos/reorder`, espejo del de partidas); los encabezados de "tipo" (campo `tag`) se arman solos según el orden en que quedan las filas. Selector de subcategoría por fila para mover un artefacto entre pestañas. El artefacto nuevo nace al final de su pestaña (`sortOrder = max+1`).
- `DndContext` con `id` estable para no romper hidratación SSR (el counter de dnd-kit difería server/cliente). Verificado en dev (preview, base `ep-solitary-mud`): pestañas, agrupado y reorder OK; typecheck del proyecto limpio.
- **Columna `sortOrder` ya aplicada en prod** vía `prisma db push` (aditiva, default 0, no mueve datos) antes del merge para que el deploy quede consistente.

## 2026-06-03 (ronda 49) — Botón "Sin factura" en movimientos + conciliación cobros Maxxa

- **Botón "Sin factura" inline** en `/banco/movimientos` (`MarkSinFacturaButton.tsx`, cableado en `MovementsTable`): marca un movimiento pendiente/parcial como `sin_factura` con categoría (Sueldo, Previred, Comisión banco, Retiro personal, Depósito efectivo, Otro) **sin crear factura ficticia ni exigir proyecto** — antes el único camino era "Pago sin factura", que obliga a un proyecto y crea una recibida `sin_respaldo`. Motivo: sueldos/comisiones no son costo de obra. Hasta ahora esas categorías solo se ponían por reglas al importar; los movimientos sin regla (ej. transferencia a Juan Pablo Costa) quedaban sin forma de marcarse a mano.
- **PATCH `/api/banco/movimientos/[id]`**: la creación de regla de auto-categorización pasa a ser **opt-in** (`saveRule:true`). Antes cualquier `{category}` creaba regla; el patrón se deriva de la glosa y puede quedar amplio ("Transf a Juan"). El botón nuevo trae el check "Guardar regla" apagado por default. Ningún caller previo mandaba `category`, así que no cambia comportamiento existente.

## 2026-06-03 (ronda 49) — Conciliación cobros 2025+2026 "pagada sin enlace" desde Maxxa

- **`scripts/conciliar-maxxa-2025.ts`** (ahora 2025 **y** 2026): (1) deja de saltar facturas `status==="pagada"` — vincula por saldo real `invRem = total − pagos` y no degrada el estado (a una pagada solo le agrega el enlace al banco); (2) transferencias gemelas: dedup de filas de cartola por la identidad estable de Maxxa (set de `id_pago`), no por fecha|monto|desc, y consume un movimiento de app distinto por fila; (3) lee las 4 cartolas 2026 + filtros de fecha a 2026. Mantiene el guard de signo y el match de emitidas por `tipoDoc{33,34,61,39}|folio` (NO por folio solo: los docs Maxxa 1043/1054 colisionan con el correlativo de emitidas y crearían enlaces falsos).
- **Datos de prod** (dry-run + OK MJ + backup): 63 imputaciones creadas. 18 cobros (emitidas) cerrados a saldo $0 (≈ $199,4M) + recibidas chicas. Integridad: 0 facturas/movimientos sobre-imputados. No mueve totales de obra (cobrado/gastado salen de facturas). F-5705931 (Servipag) excluido por decisión MJ.
- **Pendiente de dato**: 92 movimientos Maxxa sin contraparte en la app = compras Sodimac 2024 (la app solo tiene cartola desde 2025-01-02). Importar cartola 2024 para cerrarlas.

## 2026-06-03 — Import banco: "compra con tarjeta" ya no se marca "sin factura" + auto-match comercios

- **Import deja de esconder compras en "sin factura"**: `inferCategory` (`santanderParser.ts`) ya NO infiere `compra_tarjeta` por el prefijo "Compra ". `import/route.ts` solo nace `status=sin_factura` para categorías sin documento real (`previred`, `sueldo`); el resto nace `sin_asignar` y entra a la cola de conciliación. Motivo: el atajo mandaba toda compra con tarjeta (la mayoría CON factura) a "sin factura", donde el filtro de pendientes no la muestra. "Sin factura" pasa a enseñarse caso por caso (reglas `bankCategorizationRule`).
- **Auto-match por comercio (`invoicePayments.ts`)**: arreglado Construmart (la glosa trae guion "CONSTRU-MART", la regex `/construmart/` no matcheaba → ahora `/constru-?mart/`); agregado ERPYME→MAXXA (suscripción mensual, monto exacto). Sin cambios en el criterio conservador (RUT o comercio reconocido; la fecha no interviene).
- **`conciliar-maxxa-2025.ts`**: lee los 4 exports de Maxxa (antes 2; faltaba ene–mar 2025) + guard de coherencia de signo (emitida↔abono, recibida↔cargo) para no pegar pagos por colisión de folio. Limitación conocida: la dedup de cartola colapsa transferencias gemelas legítimas (pendiente arreglar para 2026).
- **Datos de prod** (reseteos de estado, conciliaciones Maxxa 2025, Santander, internacionales): detalle en WIP.md ronda 48. No mueven totales de obra (cobrado/gastado salen de facturas, no de pagos).
- **Archivos**: `src/lib/banco/santanderParser.ts`, `src/app/api/banco/import/route.ts`, `src/lib/banco/invoicePayments.ts`, `scripts/conciliar-maxxa-2025.ts` + scripts nuevos de reseteo/conciliación.

---

## 2026-06-03 — Cotizaciones: borrar con crucecita · editor: toolbar flotante + fix dropdowns

- **Borrar cotización (feature)**: crucecita discreta a la derecha de cada fila en la lista de Cotizaciones (tabs Activas y Archivadas) con confirmación inline ("¿Eliminar? Sí/No"). Borrado definitivo (cascade: presupuestos, estados de pago, lista de compra). NO se ofrece en Convertidas (obra viva). El endpoint `DELETE /api/proyectos/[id]` suma guard server-side: solo borra status `cotizacion`/`archivado`. Componente nuevo `BorrarCotizacionButton`. (PR #79)
- **Descripciones — toolbar flotante (UX)**: la barra de formato del `RichTextEditor` deja de ser fija y pasa a `BubbleMenu` (Tiptap) que aparece solo al seleccionar texto, chico y proporcional — ya no ocupa espacio al desplegar la partida. (PR #80)
- **Agregar partida — dropdowns pegados (fix)**: dos desplegables del `ObraEditor` que no cerraban al click afuera: el buscador de catálogo (el cartel "No se encontraron partidas" persistía porque el handler solo limpiaba resultados, no la query → se separó la visibilidad en `showCatalogDropdown`) y el picker "+ Capítulo" (sin handler → se le agregó). (PR #80)
- **Pendiente**: verificación visual del toolbar flotante en prod (no se pudo en sesión por inestabilidad del preview); si se ve mal, revertir PR #80.
- **Archivos**: `src/components/proyecto/BorrarCotizacionButton.tsx`, `src/components/proyecto/ProjectsTable.tsx`, `src/app/api/proyectos/[id]/route.ts`, `src/components/presupuesto/RichTextEditor.tsx`, `src/components/presupuesto/ObraEditor.tsx`.

---

## 2026-06-02 — Cotizador: orden por tipo + descripciones con formato (texto rico)

- **Orden del detalle de costos (fix)**: la tabla editable "Detalle de materiales y costos" (`ObraItemComponentsEditor`) ahora ordena SIEMPRE por tipo (material → mano de obra → herramientas → subcontrato → pérdida → margen) y dentro de cada tipo por orden de creación. Antes una línea nueva se agregaba al final de todo; ahora cae al final de su grupo. Es orden de presentación: no toca cálculos ni `sortOrder` guardado.
- **Descripciones con formato (feature)**: las descripciones al cliente (`descriptionCliente`) y al maestro (`descriptionMaestro`) pasan de texto plano a texto con formato — negrita, cursiva, subrayado, viñetas/listas y color (paleta sobria pero algo prendida, a pedido de MJ). Editor nuevo `RichTextEditor` (Tiptap v3) en el panel expandido de cada partida; en la celda compacta de la tabla se muestra el formato como vista previa (clic abre el panel para editar). Se guarda HTML en los mismos campos (sin cambio de schema).
- **PDFs**: `ObraPDF` (cliente), `EstadoPagoPDF` y `ObraMaestroPDF` (maestro) inyectan el HTML con formato (antes escapaban el texto). Se agregó CSS de listas/marcas al `.col-desc` de cada uno.
- **Seguridad**: `src/lib/richText.ts` con `sanitizeRichTextHtml` (allowlist: solo p/br/strong/em/u/s/ul/ol/li/span-color; saca scripts/onclick/img/estilos no-color), `isRichTextEmpty`, `plainTextToHtml` (migra texto plano viejo). Test de regresión `scripts/test-richtext.ts` (17 casos).
- **Dependencias nuevas**: `@tiptap/react`, `@tiptap/pm`, `@tiptap/starter-kit`, `@tiptap/extension-text-style`, `@tiptap/extension-color`, `@tiptap/extension-placeholder`.
- **Pendiente**: verificación visual del editor en el navegador (no se pudo en esta sesión por el login). Nota estética: el color va contra §3 (blanco/negro/gris); se acotó a paleta apagada por decisión de la dueña.
- **Archivos**: `src/lib/richText.ts`, `src/components/presupuesto/RichTextEditor.tsx`, `src/components/presupuesto/ObraItemComponentsEditor.tsx`, `src/components/presupuesto/ObraEditor.tsx`, `src/lib/pdf/{ObraPDF,EstadoPagoPDF,ObraMaestroPDF}.html.ts`, `scripts/test-richtext.ts`.

---

## 2026-06-02 — Boletas de Honorarios recibidas (BHE) del SII importadas

- **Qué cambió (datos en prod)**: se importaron las 9 BHE recibidas por BLARQ (2025: 7 · 2026: 2) bajadas del portal de honorarios del SII (`loa.sii.cl`). 7 creadas + 2 corregidas (venían de la ronda 39 al líquido → ahora al bruto). Gasto recibidas: $453.457.326 → $459.730.632 (+$6.273.306, de los cuales $4.678.362 son 2 honorarios de la propia MJ que se decidió incluir).
- **Modelo nuevo**: BHE = `Invoice` type=recibida, **tipoDoc=1039** (convención honorarios, paralela a 1043=mano de obra), sin IVA, totalAmount=netAmount=**bruto** (retención NO modelada, sin cambio de schema). Etiqueta agregada a `InvoicePDF.html.ts`.
- **Auto-sync desatendido NO viable**: el WAF F5 de `loa.sii.cl` rechaza la navegación de Playwright (ERR_CONNECTION_CLOSED, headless y headed); el APIRequestContext conecta pero el informe da `I082 host no definido` (sesión server-side irreproducible). Vercel descartado por WAF. Único camino que funciona: manejar el Chrome real de MJ (extensión). Recorrido y endpoints documentados en WIP ronda 45.
- **Tooling**: `scripts/importar-bhe.ts` (dry-run default, `--apply` solo prod, idempotente, verifica delta de gasto). Backup `audit-...2026-06-02T16-50.json`.
- **Pendiente MJ**: asignar obra a las 7 nuevas (projectId=null); conciliación (pago = líquido, saldo = retención); reconfirmar no-doble-conteo de los honorarios de MJ.
- **Archivos**: `scripts/importar-bhe.ts`, `src/lib/pdf/InvoicePDF.html.ts`, `docs/WIP.md`, `docs/CHANGELOG.md`.

---

## 2026-05-30 — Análisis conciliación Sodimac (Maxxa vs app) — solo lectura

- **Qué pasó (no es cambio de código ni datos)**: se comparó el export de Maxxa `MovimientosCartola_20260530_1834.xlsx` (1 cuenta, 500 compras Sodimac) contra la conciliación de la app. Donde ambos tienen datos: 156 facturas conciliadas igual. El resto son diferencias de alcance (otras cuentas / historia Sodimac fuera del rango de la app / cartola de la app ~2 semanas atrasada), no errores de plata.
- **Hallazgo de fondo sobre `metrics.ts`**: el gasto se calcula SOLO de facturas recibidas (no mira movimientos bancarios) → las 38 facturas legacy "pagada sin enlace" NO duplican gasto. Y `metrics.ts` no filtra `status=anulada`, pero las 17 anuladas (con proyecto) tienen su NC que las compensa → total correcto por disciplina de la NC.
- **Decisión / deuda**: ADR `2026-05-30-metrics-no-filtra-anuladas.md` registra el riesgo latente; defensa futura simple = filtrar anuladas explícitamente en el gastado. Re-enlazar las 38 pagadas-sin-enlace queda para sesión aparte.
- **Sin script commiteable** (análisis con scripts ad-hoc, borrados al cierre). **Sin cambios de schema, sin tocar `metrics.ts`.**
- **Entregable**: `~/Downloads/Analisis_Sodimac_2026-05-30.xlsx` (38 pagadas-sin-enlace + 7 anuladas conciliadas).
- **Archivos**: `docs/decisions/2026-05-30-metrics-no-filtra-anuladas.md`, `docs/WIP.md`.

---

## 2026-05-30 — Limpieza de conciliaciones erróneas + criterio conservador

- **Qué cambió (datos en prod, no código de la app)**: se corrigieron conciliaciones banco↔factura mal asignadas — 5 pares de proveedor cruzado (swap), 11 compras con tarjeta soltadas de facturas que no correspondían (vuelven a pendiente), 1 conciliación correcta agregada (MercadoPago $39.990 → MercadoLibre F-12254760). El grupo "comercio cruzado" quedó en 0.
- **Reembolsadores**: +2 (Alejandro Henríquez → Comercializadora Angélica; Carlos Patricio → Climair). Total 12.
- **Tooling nuevo (read-only salvo los fix con `--apply`)**: `audit-conciliaciones-erroneas.ts` (detector), `descubrir-mercadopago.ts` (ayudante), `list-conciliaciones-dudosas.ts`, y scripts de fix puntuales con dry-run + guards.
- **Decisión**: ADR `2026-05-30-conciliacion-conservadora-fecha-flexible.md` — la fecha no descarta (solo desempata), match por RUT+monto/comercio, ante la duda dejar pendiente. Implementación en `invoicePayments.ts` pendiente (es el #1/#2 de la auditoría ronda 32).
- **Sin cambios de schema, sin tocar `metrics.ts`.** Los totales de plata no se movieron (solo cambia a qué factura apunta cada pago).
- **Archivos**: `scripts/audit-conciliaciones-erroneas.ts`, `scripts/fix-conciliaciones-cruzadas.ts`, `scripts/fix-conciliaciones-ronda2.ts`, `scripts/fix-sherwin-18683.ts`, `scripts/fix-mercadopago-peaje.ts`, `scripts/conciliar-mercadolibre-39990.ts`, `scripts/crear-reembolsadores-alejandro-carlos.ts`, `scripts/descubrir-mercadopago.ts`, `scripts/list-conciliaciones-dudosas.ts`, `docs/decisions/2026-05-30-conciliacion-conservadora-fecha-flexible.md`, `docs/glossary.md`, `docs/WIP.md`.

---

## 2026-05-29 — Tooling de auditoría read-only + rotación de credencial de prod

- **Qué cambió**: dos scripts nuevos para auditar facturas/conciliación sin tocar datos: `scripts/audit-dump.ts` (dump read-only de prod a JSON — `findMany` con `select`, excluye `Invoice.pdfContent`) y `scripts/audit-analyze.ts` (análisis 100% offline sobre el JSON, cero acceso a BD). Producen `docs/REVIEW_facturas-conciliacion_2026-05-29.md`.
- **Parche de seguridad**: el print de debug de `audit-dump.ts` imprimía un fragmento del `DATABASE_URL` (con contraseña). Se cambió para imprimir solo el host. Lección registrada en ADR `2026-05-29-credenciales-en-console-logs.md`.
- **Operación (no es cambio de código)**: por esa filtración se rotó la contraseña de la BD de prod en Neon y se propagó a Vercel (Production + Preview) + redeploy + LaunchAgent del SII + `.env.prod`. La contraseña vieja quedó inválida.
- **Sin cambios de schema, sin tocar `metrics.ts`.** Los scripts y el reporte son artefactos de auditoría; `.env.prod` y `backups/` siguen gitignored.
- **Archivos**: `scripts/audit-dump.ts`, `scripts/audit-analyze.ts`, `docs/REVIEW_facturas-conciliacion_2026-05-29.md`, `docs/decisions/2026-05-29-credenciales-en-console-logs.md`.

---

## 2026-05-22 — Artefactos se multiplican por cantidad · Cuadro Resumen dinámico

- **Qué cambió**: `metrics.ts` ahora calcula el total de artefactos como `clientPrice × quantity` (antes sumaba `clientPrice` sin multiplicar). El Cuadro Resumen del proyecto pasó a tener columnas dinámicas: muestra solo los conceptos cargados con monto > 0 (obra / cocina / sanitarios / iluminación / muebles), no 4 columnas fijas.
- **Por qué**: el cuadro de Aguirre no mostraba la iluminación. La causa raíz era que el cálculo no multiplicaba por cantidad — y "funcionaba" solo porque varios proyectos venían mal cargados con el total de línea en `clientPrice`. Convención correcta confirmada con MJ: `clientPrice` es precio unitario.
- **Datos**: `scripts/fix-artefactos-precio-unitario.ts` corrigió 17 ítems mal cargados en prod (Aguirre V7, Cocina Farellones V4, JNC-Vitacura V5, Portofino V1) a precio unitario. Paseo del Sena V1 y Portofino V6 quedaron fuera por estar bien cargados.
- **Verificación (§4.1)**: snapshot prod pre/post — 16 de 18 proyectos sin cambios; Portofino y Paseo del Sena subieron al corregirse su subestimación previa. Sin cambios de schema.
- **Archivos**: `src/lib/projects/metrics.ts`, `src/components/proyecto/CuadroResumen.tsx`, `scripts/fix-artefactos-precio-unitario.ts`.

---

## 2026-05-22 — Botón "Nueva partida" en el catálogo

- **Qué cambió**: la sección Catálogo de Partidas (`/catalogo/partidas`) ahora tiene un botón "+ Nueva partida" junto a la barra de búsqueda. Abre un formulario corto (nombre, categoría con datalist de las existentes o una nueva, unidad) y al confirmar crea la partida y la abre directo en modo edición para cargar descripciones y componentes.
- **Por qué**: hasta ahora una partida solo nacía indirectamente desde un presupuesto o duplicando otra. No había forma de crear una desde cero en el catálogo.
- **Sin cambios de schema ni de API** — el endpoint `POST /api/catalogo/partidas` ya existía. Cambio solo de UI. La lista de categorías pasó a estado local del componente para que una categoría nueva aparezca sin recargar.
- **Archivos**: `src/components/catalogo/PartidaSearch.tsx`.

---

## 2026-05-17 — Fix importador de cartolas bancarias: deduplicación por saldo posterior

- **Qué cambió**: el importador de cartolas Santander ya no deduplica por el N° de documento del banco (`externalRef`). Ahora cada movimiento se identifica por `balanceAfter` — el saldo corrido tras aplicarlo, calculado sobre un orden canónico (fecha, monto, descripción). Campo nuevo `BankMovement.balanceAfter` y `@@unique` reemplazado por `(bankAccountId, date, amount, balanceAfter)`.
- **Por qué**: `externalRef` solo lo trae la cartola Histórica; la Provisoria lo trae en cero. Reimportar la misma cartola en el otro formato duplicaba todos los movimientos. Además el banco lista los movimientos de un mismo día en distinto orden según el formato — por eso el saldo corrido se calcula sobre un orden fijo, no en el orden de fila, para que la llave sea idéntica entre formatos.
- **Schema**: `balanceAfter Float?` (nullable por los movimientos previos al backfill). Aplicado en dev y prod.
- **Datos prod**: backfill de `balanceAfter` sobre 878 movimientos (período dic 2025–may 2026, cruzado contra 12 cartolas). 737 de historia previa (mar–oct 2025) quedan en null — sin cartola para cruzar. Backup completo previo: `backups/blarq-prod-2026-05-17T18-13.json.gz`.
- **Archivos**: `santanderParser.ts`, `/api/banco/import/route.ts`, `schema.prisma`; scripts nuevos `reconcile-cartolas.ts` (compara BD vs cartolas, read-only) y `backfill-balance-after.ts`.
- **Verificado**: reimport en dev (Histórica, reimport mismo formato, Provisoria del mismo período) → 0 duplicados. Simulación read-only contra prod → 0 se crearían.
- **Limitación conocida**: si se exporta una Provisoria con su último día incompleto y luego se importa la Histórica de ese mes, los pocos movimientos de ese día parcial podrían duplicarse (su `balanceAfter` cambia al completarse el día).

---

## 2026-05-16 — Catálogo de artefactos auto-construido

- **Qué cambió**: el catálogo BLARQ de artefactos se construye solo. Cada producto que se agrega a una cotización (alta individual o importación de Excel) entra al catálogo; si ya hay una entrada con el mismo nombre se reutiliza, si no se crea. Cada `ArtefactoItem` queda vinculado por `catalogId`. Helper compartido `src/lib/catalog/ensureArtefactoCatalog.ts`.
- **Por qué**: pedido de MJ — quiere el catálogo como el listado de materiales: una lista grande con toda la variedad cotizada, no solo "los más usados".
- **Backfill**: `scripts/backfill-artefacto-catalog.ts` (dry-run por defecto, `--apply`) vincula los items históricos. Dedup por nombre case-insensitive. Pendiente correrlo en prod.
- **Sin cambios de schema** (la tabla `ArtefactoCatalog` ya existía). Archivos: `ensureArtefactoCatalog.ts`, `api/presupuestos/[id]/artefactos/route.ts`, `api/proyectos/[id]/importar-artefactos/route.ts`.

---

## 2026-05-16 — Cálculo de costos: los Estados de Pago salen del costo contable

- **Qué cambió**: `metrics.ts` ya no cuenta los Estados de Pago cerrados como costo del proyecto. `totalGastado` y `totalGastadoConIva` ahora salen 100% de facturas recibidas (incluidos los "pagos sin respaldo", que son `Invoice` recibida). Se eliminó el campo `totalPagadoMaestros` de `ProjectMetrics` y su uso en `conceptDeviations` y en `/proyectos/[id]/resumen`.
- **Por qué**: decisión de MJ — *"la contabilidad no debe salir de los EP, sino de las facturas o mov sin respaldo"*. El EP es una herramienta de cálculo (cuánto pagar al maestro según avance), no la huella contable del gasto. Sumar EP + el pago registrado contaría doble.
- **`project.estadosPago` se sigue usando** para el avance de obra (% ponderado por MO) — eso no es costo, no cambió.
- **Verificación (§4.1)**: snapshot pre/post de los 17 proyectos en dev → diff vacío, ningún total se movió (ningún proyecto tiene EP cerrados en la app todavía). `test-metrics.ts` corre con 2 fallas pre-existentes ajenas al cambio.
- **Archivos**: `src/lib/projects/metrics.ts`, `proyectos/[id]/resumen/page.tsx`, `scripts/test-metrics.ts`.

---

## 2026-05-16 — "Pago sin factura": registrar pagos a maestros sin documento desde el banco

- **Qué cambió**: nueva acción masiva "Pago sin factura" en la barra de selección de `/banco/movimientos`. Para egresos a maestros/proveedores que no emiten documento, MJ selecciona uno o varios movimientos, elige proyecto + categoría, y la app crea por cada uno un registro de costo `Invoice` con `origin="sin_respaldo"` (recibida, tipoDoc=1043, sin IVA, monto y contraparte tomados del movimiento), lo deja conciliado contra el movimiento. El gasto entra automáticamente en los costos del proyecto.
- **Por qué**: las transferencias a maestros que no facturan (caso Daniel Ignacio Santibáñez) quedaban como movimientos "pendientes" sin entrar como costo de ningún proyecto, y no había forma de imputarlas desde la UI.
- **Limpieza de huérfanos**: la acción "Desasignar" ahora borra la factura `origin="sin_respaldo"` que quede sin imputaciones — sin el movimiento, ese registro auto-creado no significa nada.
- **Sin cambios de schema. Sin tocar `metrics.ts`** (que ya cuenta cualquier `Invoice` recibida por proyecto, sin filtrar por origin).
- **Archivos**: `src/app/api/banco/movimientos/bulk/route.ts`, `banco/movimientos/page.tsx`, `MovementsTable.tsx`, `MovementsBulkBar.tsx`.
- **Decisión contable pendiente (MJ)**: "la contabilidad no debe salir de los EP, sino de las facturas o mov sin respaldo". Hoy `metrics.ts` suma EP cerrados como costo (`totalPagadoMaestros`); cuando se empiece a usar EP en la app habrá que sacarlos del cálculo para no contar doble. Ver `docs/WIP.md` ronda 26.

---

## 2026-05-16 — Cotización de artefactos: revisar precios online, duplicar de otra cotización, desvincular del catálogo

- **Qué cambió**: tres funciones nuevas en el editor de artefactos (`ArtefactosEditor`). (1) "Revisar precios online" — botón que recorre los items con link cargado, baja la página de cada producto y muestra un modal con el diff precio/imagen actual vs. del momento; MJ marca qué aplicar. (2) "Traer de otra cotización" — duplica los artefactos de otra cotización dentro de la actual, refrescando los precios online automáticamente (el descuento se mantiene, el precio cliente se recalcula). (3) La estrella ★ ahora también desvincula: click en un item ya catalogado lo suelta del catálogo BLARQ (`catalogId → null`) sin tocar otras copias.
- **Por qué**: pendientes de la ronda 18 (sistema de artefactos). MJ cotiza con precios que envejecen — los productos cambian de precio seguido online. Y suele partir de una cotización vieja como base. Duplicar + refrescar resuelve ese flujo. Desvincular faltaba: hasta hoy un item con `catalogId` propagaba toda edición y no había forma de cortarlo.
- **Schema**: sin cambios. (La idea original de "templates de espacio" se descartó: MJ pidió duplicar cotizaciones, no armar recetas.)
- **Archivos nuevos**: `src/lib/catalog/revisarArtefactos.ts` (scraping masivo con concurrencia 5), endpoints `revisar-precios`, `fuentes`, `importar-de` bajo `/api/presupuestos/[id]/artefactos/`, componentes `RevisarPreciosArtefactos.tsx` y `DuplicarArtefactos.tsx`.
- **Limitación conocida**: el scraping masivo puede tardar; en cotizaciones grandes (~37 items) puede acercarse al límite de tiempo de función de Vercel. Si pasa, la UI muestra error y MJ reintenta. `maxDuration` está en 120s (Vercel lo capa según plan).
- **Nota**: el PDF de artefactos ya tenía la línea editorial nueva (se aplicó en ronda 18) — ese pendiente de la ronda 15 estaba desactualizado en el WIP.

---

## 2026-05-16 — Multi-select + acciones masivas en `/banco/movimientos` (Fase 1)

- **Qué cambió**: la lista de movimientos bancarios tiene checkbox por fila + "seleccionar todo", y una barra flotante de acciones masivas con dos operaciones: **Desasignar** (quita las imputaciones de los movs elegidos, vuelven a `sin_asignar`) y **Asignar a factura** (imputa cada mov a una factura emitida elegida, por su monto completo).
- **Por qué**: MJ necesitaba poder desasignar facturas en masa y rehacer la conciliación; ir mov por mov era inviable tras detectar la pérdida de transferencias en Carolina Ovalle (ronda 23).
- **Implementación**: endpoint nuevo `POST /api/banco/movimientos/bulk`. La tabla de `/banco/movimientos` pasó a componente client (`MovementsTable.tsx`) para compartir estado de selección; barra y buscador de factura en `MovementsBulkBar.tsx`. En ambas acciones las facturas afectadas recalculan status vía `recomputeInvoiceStatus`.
- **No toca**: schema (sin migración). `metrics.ts` ni cálculos contables.
- **Pendiente — Fase 2**: "cliente del proyecto" (transferencias asignadas directo a proyecto+concepto, con o sin factura) — sigue siendo decisión abierta, requiere `projectId`/`conceptoCobro` en `BankMovement`.

---

## 2026-05-15 — Zonas (subChapter) en partidas de obra — UI completa + subtotal por zona

- **Qué cambió**: el campo `ObraItem.subChapter` (que ya existía en el modelo) ahora es editable desde el editor de presupuesto. Permite agrupar partidas por zona (ej. COCINA / BAÑOS) dentro de un mismo presupuesto, con subtotal por zona visible en el editor y en el PDF cliente.
- **Por qué**: V2 Paseo del Sena — clienta pidió separar cocina y baños dentro del mismo presupuesto (un solo contrato). Hasta hoy `subChapter` solo entraba vía Importar Cubicación; no había manera de escribirlo desde la app.
- **UI**: link "+ zona" / "↻ zona" inline al hover de cada fila con autocompletado, bandita gris clickeable para renombrar grupo entero, botón ⎘ duplicar partida (con snapshot de componentes) para partir mixtas. Selección múltiple con checkbox + barra flotante para asignar zona a varias a la vez.
- **Subtotal por zona**: en la misma fila de la bandita, alineado bajo Total — lee como titular `BAÑO ........ $ 662.866`. Solo se muestra si el capítulo tiene 2+ zonas distintas.
- **API**: PUT y POST de `/api/presupuestos/[id]/partidas` aceptan `subChapter`. Nuevo `POST .../partidas/[itemId]/duplicate`.
- **No toca**: `metrics.ts` ni cálculos contables. La zona es separador visual, no afecta totales ni GG/utilidad. Schema sin cambios.
- **Referencias**: PRs [#35](https://github.com/blarq-app/blarq-app/pull/35) (API + edición inline), [#36](https://github.com/blarq-app/blarq-app/pull/36) (bulk select), [#37](https://github.com/blarq-app/blarq-app/pull/37) (suavizar subtotal), [#38](https://github.com/blarq-app/blarq-app/pull/38) (subtotal en bandita).

---

## 2026-05-15 — Sync diferencial cotización ↔ catálogo + regla contractual

- **Qué cambió**: el sync entre catálogo de partidas y cotizaciones en borrador ahora detecta y aplica componentes agregados o eliminados desde el catálogo, no solo cambios de precio. El flag `ObraItem.isCustomized` pasa a ser granular: editar/agregar un componente blinda solo ese componente (no la partida entera). Borrar un componente registra el descarte para que el sync no lo recree. Schema aditivo: `ObraItemComponent.originComponentId` + tabla `ObraItemDiscardedCatalogComponent`. Aplicado en dev y prod.
- **Regla contractual nueva (MJ 2026-05-15)**: partidas con `lineageId` presente en una versión enviada/aprobada del mismo proyecto+tipo quedan blindadas — el sync no las toca aunque la versión actual sea borrador. Las partidas con `lineageId` propio de la nueva versión sí se sincronizan. Helper compartido en `src/lib/catalog/frozenLineage.ts`.
- **Backfill**: `scripts/backfill-origin-component-id.ts` mapeó 1562/1625 componentes en prod (96%); 63 sin match están protegidos contra duplicación por guarda defensiva.
- **Por qué**: caso real disparador — MJ agrega "FLEXIBLE GAS 1MT" al catálogo de "INSTALACION ENCIMERA GAS", refresca la cotización Paseo del Sena, no pasa nada. Además: la granularidad gruesa del flag `isCustomized` bloqueaba demasiado, y faltaba blindar contractualmente partidas ya enviadas al cliente.
- **Impacto**: cierra el flujo "modifico catálogo → recargo presupuesto en borrador → Actualizar → cambios bajan". Deuda menor: 63 componentes sin `originComponentId` en prod no participan del sync diferencial (funcionan como antes).
- **Referencias**: commit `d28fe6d`, PR [#31](https://github.com/blarq-app/blarq-app/pull/31), ADR [docs/decisions/2026-05-15-sync-diferencial-cotizacion-catalogo.md](decisions/2026-05-15-sync-diferencial-cotizacion-catalogo.md).

---

## 2026-05-14 — Reglas de proveedor: separar toggle categoría/proyecto

- **Bug**: el bulk-assign de `/facturas` mostraba un solo toggle "Guardar regla" que aparecía únicamente cuando había categoría asignada, pero el backend aprendía categoría **y** proyecto siempre (default ON). Cambios solo de proyecto → toggle invisible → MJ no sabía que estaba creando regla. La edición inline (PATCH) tampoco tenía toggle. Como `upsertInvoiceRule` dispara `updateMany` retroactivo sobre todas las facturas del mismo RUT sin proyecto, proveedores transversales (Easy/Sodimac/MK) terminaban con facturas históricas mal asignadas.
- **Fix**: dos toggles independientes. **Categoría default ON** (visible cuando hay categoría), **proyecto default OFF** (visible cuando hay proyecto, para casos "siempre BLARQ" como Autopistas/Bencina). PUT y PATCH de `/api/facturas/[id]` solo aprenden categoría — nunca proyecto.
- Archivos: `src/app/api/facturas/bulk-assign/route.ts`, `src/app/api/facturas/[id]/route.ts`, `src/components/facturas/BulkAssignBar.tsx`, `CLAUDE.md` §4.5.
- Sin migración de schema. No toca facturas ni reglas existentes — solo cambia el comportamiento futuro.

---

## 2026-05-14 — Sistema completo de artefactos (importador + editor + catálogo + sincronización)

- **Importador de Excel de proveedores** (`src/lib/import/parseArtefactos.ts` + endpoint + botón en la página de presupuesto). Soporta hojas tipo "ARTEFACTOS SANITARIOS" (agrupado por habitación), "ARTEFACTOS COCINA / TEKA", "ARTEFACTOS ILUMINACION". Ignora MAESTRA y *_HG (V1 vieja).
- **Editor y PDF rediseñados** matcheando el Excel de referencia: jerarquía subcategoría → habitación → items, columnas IMG | ITEM | DETALLE | MARCA | CANT | LISTA | DCTO | TOTAL, subtotales por nivel, total general. Toggle "Mostrar columnas internas" agrega NETO BLARQ + UTILIDAD (no van al PDF cliente).
- **Imágenes con auto-extracción** desde el link del producto. Scraper universal (JSON-LD + OpenGraph + regex) — funciona con mk.cl, chc.cl, byp.cl, ledstudio.cl, ledconcept.cl, sodimac.cl, easy.cl y cualquier sitio que exponga metadata estándar. Campo manual fallback para sitios sin scrape. Imagen a ~32mm en PDF (medido contra Excel original).
- **Catálogo BLARQ global** (`ArtefactoCatalog`, página `/catalogo/artefactos`, entry en Sidebar). Items reutilizables entre proyectos: name, detail, brand, subcategory, tag, supplier, link, imagen, listPrice, discountPercent, isStandard, lastPriceCheck. Buscador full-text + filtros. Atajo "pegar link + extraer" en creación.
- **Sincronización entre copias del mismo catalogId**: campos del producto se propagan a otras copias del budget + al catálogo global. `realCostBlarq` se sincroniza solo dentro del budget (cotización privada varía proyecto a proyecto).
- **Fix de convenciones en BD** (decimal 0..1 para discountPercent, clientPrice unitario) — el editor anterior pisaba mal el precio al guardar.
- **Bug bonus**: sync SII ahora aplica regla de categorización también a facturas existentes (no solo nuevas). Síntoma original: Maxi Mobility aparecía sin catalogar aunque tenía regla. 1 factura recuperada en prod (folio 281571).
- PRs #14–#27 mergeados a main, deployados. Migraciones aplicadas en dev y prod antes del deploy del PR final del catálogo (para evitar 500 durante la propagación).

---

## 2026-05-13 — Sync MaterialCatalog ↔ PartidaCatalog + auditoría + edición componentes

- **Bug detectado en catálogo**: las partidas guardaban un snapshot del material asociado. Cambiar precio/marca en `/catalogo/materiales` NO propagaba al catálogo de partidas — y los presupuestos creados después arrastraban precios viejos (caso real: llave de paso gas Constanza Bravo $12.269 vs material $19.319).
- **Schema** (aditivo, aplicado en dev y prod): `ObraItemComponent.isCustomized` para marcar componentes editados manualmente. El sync masivo los respeta.
- **Fase 0 — limpieza inicial**: `scripts/sync-partidas-with-materials.ts` aplicado en dev (305 components, 299 partidas) y prod (324 components, 317 partidas).
- **Fase 1 — sync automático + auditoría**: `PUT /api/catalogo/materiales/[id]` ahora propaga al catálogo de partidas. Nueva página `/configuracion/auditoria-precios` lista presupuestos en borrador desactualizados + botón "Actualizar". `BudgetAuditBanner` arriba del editor del presupuesto cuando aplica.
- **Fase 2 — edición de componentes a nivel proyecto**: `ObraItemComponentsEditor` (UI editable en el desglose expandido de cada ítem) + endpoints `/api/presupuestos/[id]/partidas/[itemId]/componentes[/compId]`. Edición marca `isCustomized=true`. Bloqueado para presupuestos no-borrador.
- **Helpers backend reutilizables** en `src/lib/catalog/` (recalcPartida, recalcObraItem, syncMaterial).
- PR [#4](https://github.com/blarq-app/blarq-app/pull/4) mergeado, deployado.

---

## 2026-05-13 — Rediseño PDF cotización + Rosas V4 a prod

- **PDF obra y muebles unificados con nueva línea editorial** (PR #1, commit `fd7705b`, mergeado a main): tipografía `#1A1A1A`, header con grilla 2 cols, tabla sin verticales y con líneas casi invisibles `0.15pt #E5E5E5`, bloque de totales sutil sin marco rectangular, sin footer, márgenes 10/12 mm. Eliminadas `buildObraFooter` y `buildMueblesFooter`. `renderPDF` ahora soporta `scale` opcional.
- **Artefactos PDF sigue con formato anterior** — pendiente decidir si replicar.
- **Rosas V4 obra cargado** en dev y prod (Cristian Zulueta, Costo Total $30.989.264, GG 20% / Util 10%, 5 ítems aprobados). Snapshot pre/post en prod confirma que solo Rosas se movió.
- Script nuevo `scripts/replicate-rosas-dev-to-prod.ts` (patrón liviano de `replicate-arrau`).
- Fix cosmético en `scripts/import-budget.ts`: el print de la proyección muestra los % GG/Util reales del Excel en vez de hardcoded 23%/5%.

---

## 2026-05-04 — Documentación viva inicial

- Reestructura completa de `/docs/`: `architecture.md`, `business-model.md`, `glossary.md`, `principles.md` consolidan info que vivía dispersa en memoria de Claude y en reviews históricos. ADRs en `docs/decisions/` para 3 decisiones estructurales (numeración paralela, cantidad ejecutada base EP, descripción dual). Plantillas en `docs/_templates/`. `WIP.md` para estado entre sesiones.
- `CLAUDE.md` reemplazado de 1 línea (redirect) a doc completo con instrucciones permanentes para asistentes IA. `AGENTS.md` eliminado, su contenido (nota Next.js 16) absorbido en CLAUDE.md.
- `README.md` reescrito desde boilerplate a doc útil (qué es BLARQ + cómo levantar dev + punteros a /docs/).
- **Por qué**: cada sesión nueva con Claude o LLM agente partía sin contexto. Memoria estable ahora vive en repo (commiteada, accesible para JT y otras instancias), no en disco local de MJ.
- **Impacto**: alinear futuras sesiones, reducir re-explicación. Cadencia de actualización: ver §8 de `CLAUDE.md`.

## 2026-05-04 — Comparador BLARQ vs Maxxa generalizado

- `scripts/compare-portofino-maxxa.ts` (hardcoded a Portofino) → `scripts/compare-vs-maxxa.ts` con args `<projectName> <maxxaExportPath> [--cc <patrón>]` y npm script `compare:maxxa`.
- Fix incidental: Maxxa exporta NCs con signo negativo en `MontoTotal`; el cálculo del neto sumaba en vez de restar. `Math.abs()` en parseo.
- Verificado contra Portofino: BLARQ = Maxxa, 0 unilaterales, 0 con monto diferente.

## 2026-05-04 — Búsquedas case-insensitive (deuda post-cutover)

- 16 usos de `contains: q` en queries Prisma actualizados a `contains: q, mode: "insensitive"`. Archivos: `api/catalogo/partidas`, `api/catalogo/materiales`, `api/facturas`, `api/facturas/search`, `(dashboard)/banco/movimientos`, `(dashboard)/proyectos/[id]/facturas`.
- Origen: cutover SQLite→Postgres dejó `contains` case-sensitive (en SQLite era insensitive por default). MJ lo notó en `/facturas` (commit anterior `34773da`); este pase audita el resto.
- Verificado en preview: `hormigon` matchea "AVANCE POR HORMIGON", `mobeli` matchea "MOBELI DISENOS LIMITADA".

## 2026-05-04 — Fase 2: PDFs oficiales SII via Playwright + cert (LOCAL ONLY)

- Nuevo módulo `src/lib/sii/siiBrowser.ts` (login mTLS + warmup + `mipeSelEmpresa.cgi` + listado paginado + descarga PDF). Cert `.pfx` legacy se carga vía `node-forge` y se exporta a PEM para Playwright.
- `Invoice` gana 3 campos: `siiCodigo` (id listado SII), `pdfContent` (Bytes), `pdfFetchedAt`. Endpoint `/api/facturas/[id]/pdf` con toggle oficial vs interno (header `X-PDF-Source`). Badge `↓✓` verde en lista y botón "↓ PDF oficial" en detalle.
- CLI `npm run sii:sync-pdfs` con flags `--limit`, `--dry-run`, `--headed`, `--refetch-failed`. LaunchAgent `com.blarq.sii-sync-pdfs` corre 9:00 AM diario en mac de MJ.
- Sync masivo en dev y prod: 473/507 OK, 34 edge case (NCs por intercambio directo, fallback PDF interno).
- **Por qué local-only**: WAF F5 BIG-IP del SII bloquea no-Chromium. Vercel agrega IP cloud que dispara más bloqueos. Probado: Node + headers fake = 503; Chromium real = pasa.
- Detalle: [docs/SETUP_SII_pdf-oficial.md](SETUP_SII_pdf-oficial.md). Commits `1d67269`, `2937224`. Backup pre-cambios: `backups/blarq-prod-2026-05-04T21-17.json.gz`.

## 2026-05-03 — Migración a producción (Vercel + Neon Postgres)

- Cutover SQLite → Postgres (Neon). Schema único (provider postgresql). Dev branch aislado de prod.
- Deploy a Vercel Hobby (https://blarq-app.vercel.app), GitHub repo privado, deploy automático on-push a `main`.
- NextAuth en prod, MJ + JT con emails reales (`mjblanco@blarq.cl`, `jtlarrain@blarq.cl`). Pass inicial común, `/cuenta` para cambio propio.
- Mobile responsive: sidebar drawer + tablas con scroll horizontal + grids responsive.
- Detalle del proceso: [docs/MIGRATION_POSTGRES.md](MIGRATION_POSTGRES.md). Commits `7a1a9d9`, `9be630c`, `da51ea2`, `9c2184c`, `2a4f355`, `0e0c103` y otros.

## 2026-05-03 — SII directo: auto-link NCs ↔ facturas (sin SimpleFactura)

- Cliente propio del SII con cert digital: SOAP auth (`getSeed` + `getTokenFromSeed` con XMLDSig) + REST `consdcvinternetui` (`getResumen`, `getDetalleCompra`, `getDetalleDTE`).
- `getDetalleDTE` devuelve `dataReferencias[]` inline → no hay que parsear XMLs. NC se linkea con su factura original (`referenceFolioNumber`, `referenceTipoDoc`).
- Backfill 18/20 NCs históricas en prod. Las 2 SODIMAC enero sin referencia en SII son edge case manual.
- Cert subido a Vercel (`SII_CERT_BASE64`). Vence 2026-08-01.
- Commits `fc3c01f` (Fase A: cert + auth), `eefabdf` (Fase B: RCV listing), `e095d99` (Fase D: link NCs).

## 2026-05-03 — Drop placeholder "Pendiente de asignar" en CostCategory

- Categoría placeholder eliminada. `Invoice.categoryId = null` es ahora la única representación de "no clasificado".
- Razón: el motor de reglas RUT→categoría retroactivo busca `categoryId IS NULL`. Las 48 facturas con la categoría placeholder eran invisibles para el motor.
- Detalle: ver feedback en [CLAUDE.md §4.6](../CLAUDE.md#46-placeholders--null). Commit `167bb38`.

## 2026-05-01 — Sprint 4 banco: modal Maxxa-style + reglas que aprenden

- Rediseño visual `/banco/conciliacion`: agrupado por fecha, barra vertical roja/verde, monto grande primer foco visual.
- Modal "Asignar pagos" (`MovementReconcileModal`): search dinámico, filtros "Mismo cliente"/"Solo con saldo", saldo restante visible, match exacto resaltado, working copy de imputaciones.
- `/banco/movimientos` ahora vista principal: stats + búsqueda libre + botón "Asignar" inline.
- Auto-conciliar al emitir factura: helper `tryAutoMatchInvoiceWithExistingMovs()` se llama desde POST `/api/facturas` y desde sync SII. Si hay UN mov sin asignar del mismo RUT con monto exacto, se vincula solo.
- Reglas que aprenden: tabla `BankCategorizationRule`, se crea/actualiza al categorizar manual con primeras 3 palabras de la descripción.
- Commit `cc0d9ad`.

## 2026-04-30 — Sprint 3 banco: cobros parciales + splits

- Tabla `InvoicePayment(bankMovementId, invoiceId, amountApplied)` many-to-many. Status factura derivado: `pendiente | parcial | pagada`. Status movimiento: `sin_asignar | parcial | conciliado`.
- Helper `recomputeInvoiceStatus(invoiceId)` en `lib/banco/invoicePayments.ts`. Listado de facturas con badge "PARCIAL".
- `BankMovement.invoiceId` queda en schema pero deprecated.
- Commit `3a77ef0`.

## 2026-04-30 — Fix NCs en metrics.ts

- `metrics.ts` ahora resta `tipoDoc=61` del cobrado y gastado. Antes las sumaba como facturas normales.
- Inflaba ~$13M en algunos proyectos (ej: Francisco de Aguirre). Bug detectado en auditoría.
- Commit `3a9b695`.

## 2026-04-29 — Sprint 1+2 banco: parser Santander + fondo sueldos

- Schema `BankAccount` + `BankMovement`, cuentas Santander seedeadas (Operativa 8913459-5, Sueldos 9987891-6).
- Parser cartolas Santander (formato provisoria + histórica) + UI import + auto-matching contra facturas pendientes por (RUT, monto).
- `lib/banco/fondoSueldos.ts` con `computeFondoSueldos`, `PLANILLA_MENSUAL_CLP=11M`. Card en resumen del proyecto. `/banco` con panel global.
- Resultado importación marzo+abril: 348 movs, 206 facturas auto-conciliadas, 9 transfers internas matcheadas, ~91 sin asignar.
- Commits `b97b74e`, `fd519b5`, `4ac65de`, `38f5c54`.

## 2026-04-28-29 — Refactor jerárquico + EERR + integración SII inicial

14 commits. Resumen de los más estructurales:
- **Correlativos cotización/proyecto** (commit `9265bac`) — numeración paralela. Ver ADR [`2026-04-28-numeracion-paralela.md`](decisions/2026-04-28-numeracion-paralela.md).
- **Tabla "Presupuesto vs Real"** jerárquica con 3 secciones + total (commit `c5c6000`).
- **EERR estructurado** con período + variación vs período anterior (commit `7458824`).
- **Vista BLARQ dedicada** + reagrupar Auto como top con subs (commit `eca4206`).
- **Edición inline** EditableCell + PATCH `/api/proyectos/[id]` (commit `540d582`).
- **Fix IVA**: gastado se calcula NETO contra presupuesto neto (commit `c75d334`). Etiquetas "c/IVA" / "neto" en cada monto (commit `04cb028`).
- Imports históricos Maxxa (recibidas + emitidas, ene-abr 2026): commits `43feb51`, `7d18977`, `e1146f2`. Imports de Portofino (Obra V1, Muebles V1, Artefactos V1): commits `b10c946`, `55aa45f`.
- Filtros tipo Excel en facturas del proyecto + totales reactivos (commit `862220a`).
- Inventario completo: [REVIEW_autorevision_2026-04-29.md](REVIEW_autorevision_2026-04-29.md).

## 2026-04-26 — Módulo EP Phase 1: cantidad ejecutada + dual desc + sync

- `EstadoPago` + `EstadoPagoItem` con `quantityExecuted` (cantidad acumulada) como base, `amountPaid` snapshot inmutable al cerrar, `lineageId` para identidad estable a través de versiones de presupuesto, `descriptionMaestro` separada de `descriptionCliente`.
- 26 tests pasando en `scripts/test-ep-calculations.ts`. Editor `EditorEP.tsx` con Sync Diff Modal. PDF maestro `EstadoPagoPDF.html.ts` (Puppeteer + HTML/CSS, formato Portofino).
- ADR: [`2026-04-26-cantidad-ejecutada-base-eps.md`](decisions/2026-04-26-cantidad-ejecutada-base-eps.md), [`2026-04-26-descripcion-dual-cliente-maestro.md`](decisions/2026-04-26-descripcion-dual-cliente-maestro.md).

## 2026-04-27 — Setup integración SII inicial via SimpleFactura

- Endpoint `POST /api/sii/sync` autentica contra SimpleFactura, baja DTEs recibidos y emitidos desde 1-abril-2026, hace upsert con unique key `(type, tipoDoc, folioNumber, rutIssuer)`.
- Facturas SII llegan con `origin='sii_automatica'` y `projectId=null`. Se asignan a proyecto manualmente.
- Detalle: [SETUP_SII_simplefactura.md](SETUP_SII_simplefactura.md).
