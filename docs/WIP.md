# WIP — Work In Progress

Estado actual del trabajo. **Leer al inicio de cada sesión.** Actualizar al cierre de cada sesión productiva.

---

- **Última actualización**: 2026-05-13 (cierre · ronda 16 — sync MaterialCatalog ↔ PartidaCatalog + auditoría + edición componentes por proyecto)

- **Ronda 16 — Sincronización de materiales + auditoría + edición componentes a nivel proyecto (PR #4, commit `e2f4cbb`)**:
  - **Bug detectado**: las partidas del catálogo guardaban un snapshot del material asociado. Cuando se editaba un material en `/catalogo/materiales`, ese cambio NO se propagaba a las partidas — y todo presupuesto creado después arrastraba precios viejos. Caso concreto: Constanza Bravo V1 tenía llave de paso gas Stretto $12.269 mientras el material en /materiales era Nipsa $19.319.
  - **Schema** (aplicado en dev y prod): `ObraItemComponent.isCustomized` (bool, default false). Marca componentes que MJ editó manualmente — el sync masivo los respeta.
  - **Helpers backend** (`src/lib/catalog/`):
    - `recalcPartida.ts` — recalcula `PartidaCatalog.unitPrice + cost*` desde sus componentes (espejo del `effectiveTotal()` del front).
    - `recalcObraItem.ts` — idem para `ObraItem` desde sus `ObraItemComponent`.
    - `syncMaterial.ts` — propaga MaterialCatalog → PartidaComponent (siempre) y opcionalmente → ObraItemComponent (solo en presupuestos `status="borrador"`, respetando `isCustomized`).
  - **Fase 0 — limpieza inicial**: `scripts/sync-partidas-with-materials.ts`. Aplicado en dev (305 PartidaComponent actualizados, 299 partidas recalculadas) y prod (324 actualizados, 317 partidas recalculadas). El catálogo de partidas ahora coincide con el de materiales en ambos ambientes.
  - **Fase 1 — sync automático + auditoría**:
    - `PUT /api/catalogo/materiales/[id]` ahora invoca `syncMaterialToComponents` con `propagateToBudgets=false`. Editar un material actualiza el catálogo de partidas pero NO toca presupuestos en borrador automáticamente.
    - `GET /api/catalogo/auditoria-precios[?budgetId=xxx]` — lista componentes desactualizados.
    - `POST /api/catalogo/auditoria-precios/sync` — sincroniza un borrador específico o todos.
    - Página `/configuracion/auditoria-precios` con tabla y botón "Actualizar todos". Link en Sidebar.
    - `BudgetAuditBanner` (cartel ámbar arriba del editor de presupuesto) cuando hay componentes desactualizados.
  - **Fase 2 — edición de componentes por proyecto**:
    - `ObraItemComponentsEditor`: en el desglose expandido de cada ítem, tabla editable con cada componente (descripción, qty, costo, link) + botones para agregar componentes nuevos por tipo. Edición marca `isCustomized=true` en el componente y en el `ObraItem`.
    - `GET/POST /api/presupuestos/[id]/partidas/[itemId]/componentes`
    - `PUT/DELETE /api/presupuestos/[id]/partidas/[itemId]/componentes/[compId]`
    - Bloqueado para presupuestos en `status != "borrador"` (congelados).
  - **Cómo funciona ahora**: MJ edita un material en `/catalogo/materiales` → automático se actualiza el catálogo de partidas. Para propagar a presupuestos en borrador, MJ va a `/configuracion/auditoria-precios` o usa el cartelito en cada editor. Si MJ edita un componente individual desde el editor del presupuesto, queda marcado "personalizado" y los sync masivos futuros no lo pisan.



- **Ronda 15 — Rediseño completo del PDF de cotización + Rosas V4 cargado en dev y prod (PR #1)**:
  - **Nueva línea editorial unificada para obra y muebles** (`src/lib/pdf/ObraPDF.html.ts` + `MueblesPDF.html.ts` + `route.tsx` + `renderPDF.ts`). Cambios visuales mergeados a main 2026-05-13 (PR #1, commit `fd7705b`):
    - Tipografía suave `#1A1A1A` (no negro absoluto). Pesos más livianos (500 en valores de header).
    - Header: logo BLARQ a 45px arriba izquierda, "V1 COTIZACION" 18pt + subtítulo (OBRA o MUEBLES Y ARTEFACTOS) + "Profesional a cargo" alineados a la derecha. Debajo: grilla 2 columnas con Mandante/Proyecto/Direccion (izq) + Celular/Fecha/Valor UF (der).
    - Tabla: sin bordes verticales internos, líneas horizontales `0.15pt #E5E5E5` (casi imperceptibles), header sin fondo gris (solo líneas top/bottom `0.5pt #1A1A1A`), filas de capítulo en `#E5E5E5` + bold 600, padding 2pt/5pt, line-height 1.2.
    - Bloque de totales: sutil, sin marco rectangular. Solo líneas top/bottom `0.5pt #1A1A1A`. Internas `0.3pt #BFBFBF`. 55% ancho derecha. Labels pegados al borde izquierdo del bloque.
    - Sin footer (matchea Excel reference).
    - Márgenes 10mm vertical / 12mm horizontal.
    - Eliminados `buildObraFooter` y `buildMueblesFooter` (sin uso).
    - `renderPDF` agregó parámetro `scale` opcional (no usado actualmente, queda disponible si vuelve a hacer falta meter algo en 1 página).
  - **Lefevre V5 (51 ítems) sale en 2 páginas** con las proporciones nuevas — priorizada legibilidad por encima de 1 página, como pidió MJ en la spec definitiva.
  - **Artefactos sigue con su formato anterior** — se replicará si MJ lo pide. Pendiente.
  - **Rosas V4 obra cargado en dev y prod** (Cristian Zulueta · Costo Total $30.989.264 · GG 20%/Util 10% · 5 ítems aprobados):
    - `import-budget` corrido sobre `V4_ OBRA_16.02.26.xlsx`. 5 partidas matched al catálogo (193 partidas Excel ya estaban + 3 de BASE DATOS no usadas).
    - Script nuevo `scripts/replicate-rosas-dev-to-prod.ts` (mismo patrón que `replicate-arrau-dev-to-prod.ts` pero más liviano — solo 3 fases: PartidaCatalog → BudgetVersion → ObraItems).
    - Snapshot pre/post en prod: solo Rosas se movió. utilidadProyectada pasó de -$10.934.194 (sin presupuesto) a +$15.107.204 (con presupuesto + facturas SII existentes).
    - **No tiene muebles ni artefactos** (MJ confirmó).
  - **Fix cosmético en `import-budget.ts`**: el print de la proyección a Costo Total mostraba "GG (23%)" y "Util (5%)" hardcoded (defaults Pauline V4) aunque internamente aplicaba los % correctos del Excel. Ahora muestra los % reales (`parsed.percentages.gg/utility`). Confundía revisar antes de `--commit`.

Pendientes para próxima sesión:
- **Aplicar línea editorial nueva a Artefactos PDF** (`src/lib/pdf/ArtefactosPDF.html.ts`) cuando MJ confirme. Mismo patrón que obra/muebles.
- **F-163 (Arrau) — transferencia real de Pía**: cuando llegue al banco, asignarla en `/banco/movimientos` (en prod va directo, no hay ficticio que borrar). En dev sí hay un BankMovement ficticio de $14M que conviene borrar cuando se reemplace por el real.
- **"Mes actual" con benchmarks** en BLARQ EERR: vs mes anterior + año pasado + promedio últimos 6 meses, con coloreo automático cuando varía >20%. Confirmado por MJ pero no implementado.
- **Vista tipo "matriz Proyecto × Mes"** en algún lugar (¿dashboard? ¿BLARQ?). Inspirado en Maxxa: filas = proyectos, columnas = meses, celdas con monto + color rojo cuando es más gasto que ganancia, verde cuando es ganancia, gris cuando $0. Decisión pendiente: ¿dónde lo metemos?
- **Aprendizaje de matches en reembolsadores**: cada vez que MJ asigna manualmente un mov "Cristobal" a una factura, guardar el patrón (glosa key → rutProveedor) para sugerir auto en próximos.
- **Auto-conciliación al sync SII**: hoy el sync trae facturas nuevas pero no dispara auto-match retroactivo. Mejora chica.

- **Ronda 14 — Arrau replicado a prod**:
  - Schema de la ronda 13 aplicado a prod (`prisma db push`): 3 columnas nullable nuevas en `Invoice` (`compensationType`, `appliedToInvoiceId`, `refundBankMovementId`) + tabla `Reembolsador` vacía. Aditivo, backward-compatible — el código viejo de Vercel sigue andando sin tocar esas columnas.
  - Script `scripts/replicate-arrau-dev-to-prod.ts` (dry-run por defecto + `--apply`). Replica desde dev: 15 partidas catálogo nuevas, 2 BudgetVersions V5 (obra GG10/Util20 + artefactos GG20/Util5), 32 obraItems, 3 artefactos (con ×1.19 ya aplicado), 40 facturas (29 maxxa_legacy + 10 sin_respaldo + F-97 Pía manual), reasignó 6 facturas SII a Arrau (5 cambio de categoría — las recategorizaciones manuales — + 1 nueva asignación), F-151 → pagada. NO replicó el BankMovement ficticio de F-163 en prod (espera transferencia real de Pía).
  - Validación: snapshot pre/post de los 22 proyectos en prod — solo Arrau se movió. Dev vs prod calzan en Total Acordado / Cobrado / Cobrado Neto / Acordado Neto al peso. Diff de -$16.230 en Gastado por 2 facturas SII recibidas que dev tiene y prod aún no — llegan en próximo sync diario.
  - **Fix puntual artefactos Arrau** (`scripts/fix-artefactos-arrau.ts`): los `realCostBlarq` de los 3 artefactos venían mal cargados del Excel V5 (costo mayorista sin despacho). MJ confirmó que en este caso no hubo margen entre costo y venta. Igualados a `clientPrice / 1.19` (neto) en dev y prod. Card "Baño" en Centro de Costo pasa de Presupuestado $72.503 a $103.576 (vs Real $134.266 = diff -$30.690 por despachos extras).
  - Nuevo helper `scripts/snapshot-metrics.ts` para correr pre/post de cualquier cambio masivo y diffear.

- **Ronda 13 — sesión muy larga: carga Arrau + features de conciliación NC + reembolsadores + rediseño EERR de BLARQ**:
  - **Arrau V5 cargado en dev y prod**:
    - `import-budget` con presupuesto V5 ($41.419.000 c/IVA — calza al peso con cuadro resumen). 32 ítems obra, 39 partidas nuevas al catálogo, 3 artefactos sanitarios en BANO_PRINCIPAL.
    - `import-maxxa-invoices` con 38 facturas legacy (incluyendo 9 movimientos sin respaldo MO + 1 manual JEFRY GOMEZ $1.450.000 que no estaba en el export).
    - 4 facturas Arrau recategorizadas manualmente: 3 muebles → Subcontrato (CHRISTIAN GEOFFROY + 2 MÁRMOLES URBAN), 1 iluminación → Materiales (STUDIO GROUP), 1 sin sub → Artefactos > Baño (Comercial K).
    - Artefactos Arrau V5: borrado ítem "IVA $19.679" (cargado mal por el parser, no era un producto), multiplicado clientPrice de los 3 ítems × 1.19 para alinear con convención bruto del resto de proyectos. Snapshot pre/post: 22 proyectos sin cambios de valor.
    - Parser `import-budget.ts` arreglado para ignorar fila "IVA" en artefactos en futuros imports (igual que ya hacía en muebles).
    - Factura emitida F-97 ($13.250.000) del 2025-06-25 a Pía Garcés agregada manualmente (no estaba en sync SimpleFactura ni en Maxxa).
    - F-151 ($8.887.622) marcada como "pagada" (estaba como "pendiente" pero saldo era $0).
    - F-163 ($15.279.426) marcada como "parcial" con BankMovement ficticio de $14M + InvoicePayment (registro manual dev — en prod se reemplaza al importar movs reales).

  - **Movimiento sin respaldo (caso Arrau)**: nuevo `origin='maxxa_sin_respaldo'` para pagos a maestros sin DTE. Convención: `tipoDoc=1043` (código interno Maxxa), `iva=0`, `netAmount=totalAmount`. En la lista del proyecto: badge "Mov sin respaldo · sin IVA" en lugar del folio numérico.

  - **Edición inline de categoría + proyecto** en `/proyectos/[id]/facturas` (la lista del proyecto) y `/facturas` (lista global). Click en celda → dropdown → guarda automático. Endpoint nuevo `PATCH /api/facturas/[id]` para edición parcial (no toca el PUT existente del formulario completo). Componentes en `src/components/facturas/EditableInvoiceFields.tsx`.

  - **Filtro de categorías incluye padres**: en `/proyectos/[id]/facturas`, si hay subcategorías presentes (ej. "Baño", "Iluminación"), también se ofrece la padre ("Artefactos") como opción de filtro que matchea todas sus subs.

  - **Resumen del proyecto — cards en NETO**: `Total Acordado`, `Cobrado`, `Por cobrar` (card nueva), `Gastado` y `Utilidad` ahora muestran neto en grande y c/IVA en línea pequeña abajo. Lógica única para Utilidad: **Total Acordado neto − Gastado** (proyectada, no cobrado − gastado). Snapshot pre/post: diff $0 en 22 proyectos.
  - **Margen y Pérdidas con $0 explícito** en columna Real (ya no "—"), para que la diferencia se calcule visible.
  - **Bug latente arreglado** en card Gastado: `totalGastado + totalPagadoMaestros` duplicaba EPs (totalGastado ya los incluía). Sin efecto observable porque ningún proyecto hoy tiene `totalPagadoMaestros > 0`, pero queda corregido. Nuevo campo `totalGastadoConIva` agregado a `metrics.ts`.

  - **Compensación de NC** (caso DP, Sodimac, etc): nuevo bloque en el detalle de la NC con 3 botones según el modo:
    - **"Aplicar a otra factura"** (azul): NC compensa otra factura del mismo proveedor (caso DP). También funciona para NCs emitidas que anulan una factura emitida sin transferencia de plata.
    - **"Reembolso a la cuenta"** (índigo): el proveedor devolvió la plata al banco. Picker de BankMovements sin asignar con monto similar. Linkea NC ↔ mov y marca el mov como conciliado con categoría `reembolso_proveedor`.
    - **"Reembolso en efectivo"** (verde): caso Sodimac.
    - Schema: campos nuevos en Invoice — `compensationType` (`other_invoice` | `cash_refund` | `bank_refund` | null), `appliedToInvoiceId`, `refundBankMovementId`. Endpoint `POST /api/facturas/[id]/compensar`.
    - Al compensar, la NC pasa a `status="pagada"` (sale del pendiente). Script `fix-nc-status.ts` usado para limpiar 2 NCs ya conciliadas que habían quedado en pendiente.
    - **Trazabilidad**: en lista de facturas del proyecto, badges `compensada` / `$$ efectivo` al lado del badge "NC".

  - **Reembolsadores**: nueva tabla `Reembolsador` (nombre + glosa). Pantalla `/configuracion/reembolsadores` para gestionar. Cuando un BankMovement tiene una glosa que matchea con un reembolsador (Cristobal, Elias, MJ misma, JP, Jefry, Ivan, etc.), el modal "Asignar pagos" muestra banner explicativo, apaga "Mismo proveedor" automático y ordena facturas con monto match arriba. **Filtro nuevo "Monto exacto ±$10"** en el modal con atajo "usar monto del mov".

  - **Auto-conciliar pendientes**: botón en `/banco/movimientos` que corre la lógica de auto-match retroactivamente sobre BankMovements con status `sin_asignar` o `sin_factura` sin payments. Endpoint optimizado a 2 queries iniciales + loop en memoria (la versión naive con N×M tardaba >60s con 200 movs). Aplicado: 3 movs Cabify se conciliaron solos contra facturas Maxi Mobility (los otros 2 sin candidato porque la factura SII de feb no está en BD).

  - **Estado de Resultados BLARQ (proyecto interno) — rediseño**: tabs reemplazadas. Antes: Mes/Trimestre/YTD/Año/Personalizado. Ahora: **Mes actual / Semestre / Año / Personalizado**.
    - **Semestre rolling 6 meses**, **Año** y **Personalizado** muestran tabla con columnas mensuales (1 columna por mes en el rango). Año tiene scroll horizontal con columna Concepto pegada (sticky).
    - "Mes actual" mantiene la vista actual vs anterior con variación %.
    - Cards arriba: 4 (Total / Anterior / Variación / Por pagar) en "Mes actual"; 2 (Total / Por pagar) en multi-mes.
    - `lib/periods.ts`: case "semester" agregado, "quarter" y "ytd" eliminados.

Pendientes para próxima sesión:
- **Cargar Rosas** (próxima en la fila): pasar Excel V correspondiente + export Maxxa si hay, cargar primero en dev validando contra cuadro resumen, recién después replicar a prod con el mismo patrón que Arrau.
- **F-163 (Arrau) — transferencia real de Pía**: cuando llegue al banco, asignarla en `/banco/movimientos` (en prod va directo, no hay ficticio que borrar). En dev sí hay un BankMovement ficticio de $14M que conviene borrar cuando se reemplace por el real.
- **"Mes actual" con benchmarks** en BLARQ: vs mes anterior + vs mismo mes año pasado + vs promedio últimos 6 meses, con coloreo automático cuando varía >20%. Confirmado por MJ pero no implementado en esta sesión.
- **Vista tipo "matriz Proyecto × Mes"** en algún lugar (¿dashboard? ¿BLARQ?). Inspirado en Maxxa: filas = proyectos, columnas = meses, celdas con monto + color **rojo cuando es más gasto que ganancia, verde cuando es ganancia, gris cuando $0**. Sirve para ver "dónde se fue la plata" cada mes. Decisión pendiente: ¿dónde lo metemos? ¿una pantalla nueva `/dashboard/utilidades` o lo agregamos al dashboard top-level?
- **Aprendizaje de matches en reembolsadores** (Opción A que MJ no eligió en esta ronda): cada vez que MJ asigna manualmente un mov "Cristobal" a una factura, guardar el patrón (glosa key → rutProveedor) para sugerir auto en próximos. Mejora si los manual matches recurrentes molestan.
- **Auto-conciliación al sync SII**: hoy el sync trae facturas nuevas pero no dispara auto-match retroactivo. Las facturas que llegan después de un mov huérfano quedan sin asociar hasta que MJ aprete el botón. Mejora chica.
- **Cosa rara observada**: en `/proyectos/[id]/resumen`, al limpiar el ítem IVA de Arrau y tocar metrics agregando `totalGastadoConIva`, el snapshot dio diff $0 — bien. Pero el doble conteo de `totalPagadoMaestros` que arreglé era un bug latente que conviene revisar si más adelante algún proyecto activa EPs cerrados con maestros no facturadores.

- **Ronda 12 — pulido post-cutover**:
  - **Limpieza leak catálogo→proyecto en editor de presupuesto**. Investigué el ítem de "editor de partidas dentro del proyecto debería editar ObraItemComponent". Realidad: el editor del proyecto (`ObraEditor.tsx`) **no edita** PartidaComponent — sólo edita ObraItem y los 6 campos de desglose grueso. El único leak real era dead code en `presupuesto/[budgetId]/page.tsx` (líneas 42-75) que leía provisiones de `partidaComponent` y las pasaba como prop `provisionsByObraItem` a ObraEditor — prop que nunca se consumía. Eliminados ambos. `tsc --noEmit` limpio.
  - **Caveat anotado**: si MJ alguna vez quiere editar componentes de una partida sólo para un proyecto (sin tocar el catálogo), eso es funcionalidad nueva (UI + endpoints `/api/proyectos/[id]/obra-items/[itemId]/componentes` que escriban en ObraItemComponent). Hoy no existe.
  - **Re-conciliación InvoicePayment dev→prod resuelta**. Script `scripts/replicate-invoice-payments-dev-to-prod.ts` que matchea movs por `(accountNumber + fecha + monto + externalRef)` y facturas por `(folioNumber + tipoDoc + rutIssuer)`, dry-run por defecto, `--apply` para escribir. Corrido por MJ con éxito. Caveat de la ronda 11 cerrado.

- **Ronda 11 — sesión larga, mucho que reportar**:
  - **Filtro de monto** agregado en /facturas (input acepta formato chileno con puntos, tolerancia ±$10 para redondeos IVA).
  - **Búsqueda libre /banco/movimientos** arreglada (q sin dígitos rompía el filtro RUT y devolvía todo).
  - **Columna "Diferencia $"** en Presupuesto vs Real (presupuestado − real con colores verde/rojo).
  - **2 fixes resumen muebles/artefactos**:
    - Iluminación ya no usa `realCostBlarq` solamente — fallback a precio cliente neto cuando falta el costo cargado.
    - Muebles "(Sin subcategoría)" → mapea a fila "Mueble" (convención MJ confirmada).
    - Después MJ pidió revertir a costo proveedor real (`costDistributor`/`realCostBlarq`) con fallback al precio cliente neto si está vacío. Resultado correcto: Aguirre Mueble pasa de $11.538k → $8.290k.
  - **Bug BANQUETA / MUEBLES**: Aguirre tenía costDistributor=$0 porque el parser de import no matcheó "MUEBLES" (PRESUPUESTO) con "BANQUETA" (hoja cálculo). Fix manual: $680.000, util 30%, supplier CARLOS.
  - **Editor partidas — 3 fixes**:
    - Flechas (↗) ocultas en pérdida/margen/leyes (no son linkeables).
    - Inputs en modo edición muestran enteros (Math.round) en vez de decimales largos.
    - Cleanup BD: 40 referenceLink borrados de pérdida/margen/leyes, 92 no-URL ("PACTADO JESUS" etc), 322 unitCost redondeados.
  - **🚨 BUG CRÍTICO — presupuesto inmutable a cambios al catálogo (regla MJ)**: JT detectó que sus ediciones al catálogo aparecían en proyectos cerrados (Lefevre V5). Causa: lista de compras leía PartidaComponent del catálogo en runtime. Fix grande:
    - Schema nueva: tabla `ObraItemComponent` (snapshot por proyecto).
    - Aplicada en BD dev y prod.
    - Migración 284 ObraItems con catalogPartidaId → snapshot poblado.
    - API POST partidas snapshotea automáticamente al crear desde catálogo.
    - Lista compras (page + sync + PDF) lee del snapshot, no del catálogo.
    - Documentado en docs/principles.md.
  - **Subido todo a prod**: presupuestos Pauline V4 + Aguirre V7 + anexo Baño Visitas, 84 facturas legacy 2025 Aguirre, cleanup catálogo, AJUSTE iluminación + BANQUETA fix, 290 movimientos bancarios enero/feb, snapshot ObraItemComponent. Validado: Aguirre Total Acordado $84.577.305, Pauline $78.692.133.

Pendiente para iteraciones futuras:
- Selector "Comparando contra: Obra ... aprobado" en /resumen muestra solo UNA versión cuando hay anexos (cosmético).
- Re-asignar URLs correctas en componentes (los del catálogo BD están desfasados respecto al Excel original).
- Arrau y Rosas: cargar V correspondiente cuando MJ pase los Excel.

- **Ronda 10**:
- **Esta ronda**: Fix del **Margen** en el desglose de obra. MJ detectó que el `costMargin` de los items no aparecía en "Presupuesto vs Real — Por Categoría". 2 fixes:
  1. **`metrics.ts > budgetByType`** ahora incluye `costMargin` en el desglose y suma items de TODAS las obras aprobadas (no solo la primera). Antes solo tomaba `obra?.obraItems` y la `obra` venía de `bestVersion()` que devuelve UNA, ignorando anexos como BAÑO VISITAS.
  2. **`page resumen`** ahora muestra fila "Margen" en la sección Obra. Columna "Presupuesto" = `costMargin` total. Columna "Real" queda en "—" porque las facturas reales no se categorizan como margen — el margen real del proyecto se ve a nivel agregado en la card "Utilidad Real".
  - Verificado: Pauline V4 muestra $3.254.115 de margen (12.1%), Aguirre V7+Anexo muestra $3.471.914 (8.0%), Portofino y Lefevre OK.
  - Como side-effect del fix #1, los desgloses de Materiales/MO/Subcontrato/etc para Aguirre ahora suman también los items del BAÑO VISITAS (anexo). Total Acordado siguen iguales.
  - **Detalle a iterar**: el selector "Comparando contra: Obra V4-BANO-VISITAS · aprobado" arriba de la página solo muestra UNA versión, debería listar las 2 obras aprobadas. Anotado como pendiente cosmético.
- **Ronda 9**:
- **Esta ronda**: 2 bugs detectados al validar Aguirre contra cuadro resumen.
  1. **NC con totalAmount negativo en BD** (bug del import-maxxa-invoices.ts inicial). Maxxa exporta NC con MontoTotal negativo, mi script las guardaba tal cual. metrics.ts aplica sign(-1) para tipoDoc=61 → doble negación → las NC SUMABAN en vez de RESTAR. Para Aguirre infló el gastado en $9.5M. Fix: `Math.abs()` en script + UPDATE de las 7 NC ya cargadas. Verificado: gastado pasa de $56.920.876 a $48.936.960 (calza con Maxxa $48.929.838 + factura MAXI MOBILITY $7k que está en BD pero no en Maxxa).
  2. **metrics.ts solo tomaba 1 obra por proyecto**. Cuando hay múltiples obras aprobadas (caso Aguirre con BAÑO VISITAS V4 anexa al ppto V7 principal), `bestVersion()` descartaba todo menos la última creada. Fix: nueva función `allApproved()` para obra que suma TODAS las versiones aprobadas con sus respectivos GG/Util. BAÑO VISITAS pasado de borrador a aprobado. Verificado: Total Acordado pasa de $83.012.317 a $84.467.242 (vs esperado $84.577.309, diff -$110k = drift de iluminación entre cuadro resumen y hoja LEDSTUDI, no del script).
  - Margen real Aguirre: pasó de 10.9% (con bug NCs) a **23.4%** (correcto).
- **Ronda 8**:
- **Esta ronda**: Cargado **Francisco de Aguirre #54** V7. Total Acordado $83.012.317 vs Cuadro Resumen esperado $83.122.383 (diff -$110k = 0.13% por desfase entre hoja LEDSTUDI y cuadro resumen).
  - Mejoras al script de import:
    - **GG y Utility se leen del Excel** (no hardcoded). Aguirre usa GG 5% / Util 18%, distinto a Pauline (23%/5%).
    - **Muebles parser chapter-aware**: detecta múltiples bloques en hoja MUEBLES y los matchea por chapter (Aguirre tenía COCINA / BAÑO PRINCIPAL / BANQUETA, mi parser anterior duplicaba precios).
    - **Artefactos sin filtro de versión** (las hojas son V5/V4/V1 pero todas vigentes en V7). Nuevo flag `--ignore-sheets` para excluir alternativas no elegidas.
    - **Detección item vs cabecera de room**: si la fila tiene cantidad+precio, NO es header (caso "COCINA" como nombre de lámpara).
    - **Flag `--status`** para cargar BudgetVersions como borrador (caso BAÑO VISITAS V4 como anexo).
  - 2 temas abiertos nuevos en `business-model.md`:
    - **Múltiples obras / anexos** por proyecto (BAÑO VISITAS quedó como borrador).
    - **Alternativas no elegidas** en artefactos (manualmente filtradas con `--ignore-sheets`).
- **Ronda 7**:
- **Última sesión**:
  1. Script de import legacy (`scripts/import-budget.ts`) refinado: ahora ignora extras post-cierre del Excel, guarda `cost*` POR UNIDAD (consistente con la convención de la app), y aplica fix de qty=0.
  2. Bugs de `metrics.ts` arreglados (los 3 que generaban diff de $1.464k en Pauline Dumay):
     - **Utilidad encadenada → aditiva sobre costo directo**. Fórmula correcta confirmada con MJ 2026-05-05 contra Excel V4.
     - **Descuento global de muebles** ahora se respeta. Campo nuevo `BudgetVersion.discountPercentage` (decimal). Schema aplicado en dev y **prod** (Neon SQL Editor, 234ms).
     - **Priorización facturas vs EPs**: si `Maestro.emitsInvoice=true`, los EPs cerrados se descartan del `totalGastado` (la factura ya cubre el pago — sumar EP daría doble conteo).
  3. Re-importado Pauline Dumay V4 con script corregido. **Total Acordado calza exacto: $78.692.133 (calculado) vs $78.692.132 (Excel) — diff $1 redondeo**.
  4. **Tema abierto anotado en business-model.md**: maestros que no facturan. Hoy 2 de las 3 cuadrillas son informales — no hay backup tributario. Decisión de negocio sin resolver, no urgente pero conviene definir.

Próximas acciones:
- Cargar V4 de los otros 3 proyectos (Arrau, Aguirre, Rosas) cuando MJ pase los Excel.
- Importar Pauline Dumay también en BD prod (hoy solo en dev).
- Conversación de negocio: maestros informales (cuándo formalizar, cómo evidenciar gasto).

### Sesión 2026-05-05 — backlog módulo financiero

Commits (orden cronológico): `efdc686`, `58a40f8`, `429ed31`, `904424b`, `c1c8190`, `129f33b`, `3df8092`, `c524c29`.

- **Turbopack activado** en `npm run dev` (~300ms vs varios segundos antes).
- **Fix NCs en /proyectos/[id]/facturas** — los stats Emitido/Recibido/Por cobrar/Por pagar y el total al pie ahora restan las DTE 61, igual que en metrics.ts. Portofino: Recibido baja de $51.596.210 a $48.336.500.
- **Modal Asignar pagos** — nueva columna "Fecha", candidatos ordenados por proximidad a la fecha del movimiento, punto gris si está dentro de ±15 días.
- **Botón "Re-linkear NCs" eliminado** de /facturas (sync automático ya lo hace, las 2 pendientes son irresolubles vía API). También se borró el endpoint POST /api/sii/relink-ncs.
- **Utilidad Real arreglada** — agrega `totalCobradoNeto` y `totalAcordadoNeto` a metrics.ts; utilidadReal ahora calcula NETO − NETO. Antes mezclaba c/IVA con neto e inflaba ~19%. Portofino: utilidad pasa de $9.986.713 (margen 19.7%) a $1.906.824 (margen 4.5%). `totalCobrado`/`totalAcordado` se mantienen c/IVA para forma de pago / firma del contrato. Tests: 19/19 pasan.
- **Panel de filtros avanzados** estilo Maxxa en /banco/movimientos — RUT / nombre / monto exacto / descripción / fechas / estado / tipo / cantidad. Se aplica al apretar "Buscar" (no live). Auto-abre si hay filtros activos en URL.
- **Editor de partidas** — margen siempre al final del desglose; autocomplete de materiales contra MaterialCatalog (con opción "+ crear nuevo"); drag & drop para reordenar componentes regulares.
- **/banco/conciliacion eliminada** — la lógica vivía duplicada con el modal moderno de /banco/movimientos. Default de /movimientos ahora es "Pendientes" (sin_asignar + parcial); tab "Todos" es elección explícita. Banner ámbar prominente en /banco si hay pendientes.
- **Editor de partidas 5c/5e** (commit `cd632f7`, segunda ronda): pérdida ligada a un material concreto (selector aparece al elegir tipo Pérdida + unit "%"); leyes sociales auto-calculadas (al elegir Mano de Obra + unit "%" → total = % × suma de MO de la partida). Schema change `PartidaComponent.appliedToComponentId` y `.appliedToType` aplicado en **ambas branches Neon** (dev y prod) — confirmado consultando registros existentes que devuelven `null` en los nuevos campos.

## Estado del proyecto

### En producción y funcionando
- App en https://blarq-app.vercel.app, MJ + JT entrando con sus emails reales (`mjblanco@blarq.cl`, `jtlarrain@blarq.cl`).
- Postgres prod (Neon `ep-shy-morning`) con schema actualizado. Dev branch (`ep-solitary-mud`) aislado.
- Sync de DTEs vía SimpleFactura → Invoices con `origin='sii_automatica'` y `projectId=null` esperando catalogación.
- Auto-link de NCs ↔ facturas via SII directo (cert mTLS): 18/20 NCs históricas linkeadas en prod.
- **PDFs oficiales SII** (Fase 2 entregada 2026-05-04): 473/507 facturas con `pdfContent` en BD. Endpoint `/api/facturas/[id]/pdf` sirve oficial cuando existe, fallback a interno.
- LaunchAgent `com.blarq.sii-sync-pdfs` corre todos los días 9 AM en mac de MJ.
- Backup CLI (`npm run db:backup`) probado en dev y prod.
- Comparador `npm run compare:maxxa` generalizado y bug de signo NC arreglado.

### Sprint 1 — pendiente, listo para arrancar

Doc viva ya en repo y en prod. Sprint 1 puede arrancar la próxima sesión. Tareas en "Próximos pasos" §3.

## Próximos pasos concretos (orden recomendado)

1. **MJ verifica visualmente** las 9 features en https://blarq-app.vercel.app — sobre todo el editor de partidas (5a/5b/5c/5d/5e), `/proyectos/{Portofino}/resumen` (utilidad real $1.906.824, margen 4.5%), `/banco/movimientos` (default "Pendientes"), modal Asignar pagos (columna Fecha + orden por proximidad).
2. **Decisión pendiente — repo público vs privado** (planteado en sesión 2026-05-05). El repo `blarq-app/blarq-app` está como público en GitHub, expone toda la lógica de negocio. Costo de pasarlo a privado: ~$4/mes adicional para incluir a JT como colaborador. No urgente.
3. **Retomar Sprint 1** con MJ — ítems pendientes:
   - Criterios de alerta crítica (qué dispara el banner en `/proyectos/[id]`).
   - Snapshot plan B1 — protocolo formal de snapshot pre/post para cambios en `metrics.ts`.

## Decisiones pendientes que requieren input de MJ

- **Salida de Maxxa hacia emisión propia**: plan operativo completo en [docs/plan-emision-propia.md](plan-emision-propia.md). Decisión sobre proveedor único lectura+emisión registrada en ADR [decisions/2026-05-05-proveedor-unico-lectura-emision.md](decisions/2026-05-05-proveedor-unico-lectura-emision.md). Próxima acción de MJ: pedir cotización a SimpleFactura (plan emisión) y OpenFactura (plan completo). Ahorro acumulado al cerrar Maxxa + SimpleFactura: ~$57.850/mes (~$694k/año).
- **Renovación cert digital antes de 2026-08-01** (~89 días): trámite manual, no lo puede hacer Claude.
- **Repo GitHub público vs privado**: hoy `blarq-app/blarq-app` es público — toda la lógica de negocio queda visible. Pasarlo a privado cuesta ~$4/mes adicional (para incluir a JT). Datos sensibles siguen fuera del repo (gitignored).
- **Backfill de `descriptionMaestro` en PartidaCatalog**: 206 partidas con 0 pobladas en este campo. Se va completando caso a caso al editar EP, pero hay decisión de "¿hacer batch dedicado?".
- **Sub-capítulos en EP** (ej: "4.2 COCINA" dentro de "4 INSTALACIONES SANITARIAS"). Schema actual no soporta. Lefevre no los necesita; Portofino sí los usa en su Excel original. Decisión postergada.

## Bloqueantes

Ninguno. La quota Neon de 5 GB/mes (free) se topó el 2026-05-05 — MJ hizo upgrade a **Launch** (compute desde $0.106/CU-hr · 100 GB transfer/mes). Limit removed, app destrabada en dev y prod.

## Working notes

- **Cosa rara observada (no investigada)**: en `/proyectos/[id]/resumen`, el "Cobrado" del header muestra valores que no coinciden con `Invoice.status='pagada'` count. Hay dos lógicas distintas de "cobrado" conviviendo en código (probablemente una sale de `bankMovements.amount` sumado, otra de `invoice.status`). Reconciliar cuando moleste.
- **Branch `modo-b-emision`** sin mergear desde 28-abr-2026 (commit `808327e`, 7 archivos de emisión). Esperando certificación SimpleFactura. Cuanto más tarde, más conflictos al merge en `resumen/page.tsx`, `facturas/page.tsx`, `proyectos/[id]/facturas/page.tsx`. Decisión: rebase preventivo o esperar.
- **Las 2 NCs SODIMAC enero** (folios 62624352, 62613036) no aparecen en SII con referencia. MJ las puede linkear manualmente cuando tenga ganas.
