# WIP — Work In Progress

Estado actual del trabajo. **Leer al inicio de cada sesión.** Actualizar al cierre de cada sesión productiva.

---

- **Última actualización**: 2026-05-05 (cierre · ronda 9)
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
