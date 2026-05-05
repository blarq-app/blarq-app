# WIP — Work In Progress

Estado actual del trabajo. **Leer al inicio de cada sesión.** Actualizar al cierre de cada sesión productiva.

---

- **Última actualización**: 2026-05-04 (cierre)
- **Última sesión**: documentación viva consolidada y empujada a prod (commits `b6e3834`, `c02e0f9`, `eb7fbbf`). Antes de la doc, se generalizó el comparador BLARQ vs Maxxa con fix de signo en NCs, y se auditaron 6 endpoints con `contains:` case-sensitive post-cutover Postgres. Vercel deploy disparado al push.

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

1. **Verificar que Vercel terminó el deploy** de los 3 commits empujados al cerrar (~2 min post-push). https://vercel.com/blarq-apps-projects/blarq-app/deployments. Validar visualmente en `/facturas` que la búsqueda case-insensitive funciona en prod.
2. **Verificar mañana 2026-05-05** que el LaunchAgent de PDFs SII corrió a las 9 AM (`tail ~/Library/Logs/blarq-sii-sync-pdfs.log`).
3. **Retomar Sprint 1** con MJ — ítems pendientes:
   - Criterios de alerta crítica (qué dispara el banner en `/proyectos/[id]`).
   - Snapshot plan B1 — protocolo formal de snapshot pre/post para cambios en `metrics.ts`.
   - (Resto del Sprint 1 a definir cuando se reactive.)

## Decisiones pendientes que requieren input de MJ

- **Salida de Maxxa hacia emisión propia**: qué proveedor usar (OpenFactura, LibreDTE, SimpleAPI, Haulmer, integración directa). Tolerancia a fallos baja — correr en paralelo con Maxxa durante transición. Sin urgencia hoy.
- **Renovación cert digital antes de 2026-08-01** (~89 días): trámite manual, no lo puede hacer Claude.
- **Plan Neon free** vs paid: BLARQ usa 92 MB de los 500 MB. A ~17 MB/mes (~100 facturas × ~170KB PDF oficial) llegamos al límite en ~24 meses. Pasar a paid ($19/mes, 10 GB) o archivar PDFs viejos. No urgente.
- **Backfill de `descriptionMaestro` en PartidaCatalog**: 206 partidas con 0 pobladas en este campo. Se va completando caso a caso al editar EP, pero hay decisión de "¿hacer batch dedicado?".
- **Sub-capítulos en EP** (ej: "4.2 COCINA" dentro de "4 INSTALACIONES SANITARIAS"). Schema actual no soporta. Lefevre no los necesita; Portofino sí los usa en su Excel original. Decisión postergada.

## Bloqueantes

Ninguno hoy. Vercel CLI autenticado en mac de MJ, BD prod accesible, cert digital local válido hasta agosto.

## Working notes

- **Cosa rara observada (no investigada)**: en `/proyectos/[id]/resumen`, el "Cobrado" del header muestra valores que no coinciden con `Invoice.status='pagada'` count. Hay dos lógicas distintas de "cobrado" conviviendo en código (probablemente una sale de `bankMovements.amount` sumado, otra de `invoice.status`). Reconciliar cuando moleste.
- **Branch `modo-b-emision`** sin mergear desde 28-abr-2026 (commit `808327e`, 7 archivos de emisión). Esperando certificación SimpleFactura. Cuanto más tarde, más conflictos al merge en `resumen/page.tsx`, `facturas/page.tsx`, `proyectos/[id]/facturas/page.tsx`. Decisión: rebase preventivo o esperar.
- **Las 2 NCs SODIMAC enero** (folios 62624352, 62613036) no aparecen en SII con referencia. MJ las puede linkear manualmente cuando tenga ganas.
