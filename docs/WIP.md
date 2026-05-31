# WIP — Work In Progress

Estado actual del trabajo. **Leer al inicio de cada sesión.** Actualizar al cierre de cada sesión productiva.

---

- **Última actualización**: 2026-05-30 (ronda 35 — análisis conciliación Sodimac Maxxa vs app, solo lectura)

- **Ronda 35 — Análisis conciliación Sodimac: export Maxxa vs app (sesión solo-lectura con MJ)**:
  - **Disparador**: MJ bajó de Maxxa `MovimientosCartola_20260530_1834.xlsx` (su conciliación bancaria, algunos auto, algunos a mano) y pidió comparar contra la app: ¿mismos movimientos conciliados con las mismas facturas?
  - **Alcance real del export**: NO es la conciliación completa — es **una sola cuenta** (89134595, compras con tarjeta) y **500 movimientos, todos Sodimac**. Las transferencias a proveedores (Brune, JPB, Termoplus, etc.) viven en otra cartola y no están acá. Comparar contra TODA la app daba ruido (310 "en app no en Maxxa" = otras cuentas; 303 "en Maxxa no en app" = Sodimac viejo fuera del rango de la app). La comparación válida es solo Sodimac.
  - **Resultado Sodimac (donde ambos tienen datos)**: 156 facturas conciliadas igual. Diferencias explicadas, NO errores de plata: (a) la app arranca su historia Sodimac en jun-2025, Maxxa llega a 2024; (b) la cartola de la app está ~2 semanas atrasada (movs Sodimac hasta 15-may; Maxxa hasta 29-may) → las compras de fin de mayo figuran pendientes en la app porque falta importar esa cartola.
  - **Hallazgo 2 — 38 facturas Sodimac "pagada" sin enlace de pago**: `import-maxxa-invoices.ts` crea las facturas legacy como `status=pagada` (cuando el Saldo de Maxxa = 0) y setea `paidAt`, pero **no crea el `InvoicePayment`**. La cartola se importó aparte; el auto-match solo mira facturas `pendiente`/`parcial` (`invoicePayments.ts:189` y `:432`), así que nunca las enlazó → el cargo del banco quedó `sin_factura`. **NO duplica gasto**: `metrics.ts` calcula el gasto SOLO de facturas recibidas, no mira movimientos bancarios (0 referencias). Es brecha de trazabilidad, no de plata. Re-enlazar las 38 queda para sesión planificada aparte (cambio en prod, hay cola más prioritaria).
  - **Hallazgo 3 — facturas anuladas conciliadas**: 7 Sodimac (17 en total con proyecto) están `status=anulada` pero igual suman al gasto, porque `metrics.ts` filtra solo por `type`, no por estado. **NO inflan el total**: las 17 tienen su nota de crédito (tipoDoc 61) que las referencia, y las NC restan (sign −1) → +factura −NC = 0 neto. El equilibrio depende de que la NC siempre exista (hoy 17/17).
  - **Riesgo latente registrado**: `metrics.ts` no excluye anuladas explícitamente; el total queda bien por disciplina de la NC. Defensa futura simple = filtrar `status=anulada` en el cómputo de gastado. ADR `2026-05-30-metrics-no-filtra-anuladas.md`. NO se tocó `metrics.ts` esta ronda.
  - **Entregable**: `~/Downloads/Analisis_Sodimac_2026-05-30.xlsx` (hoja 1: 38 pagadas-sin-enlace; hoja 2: 7 anuladas conciliadas; con razón social, fechas y montos).
  - **Sin cambios de código ni datos. Sesión 100% solo-lectura sobre prod** (consultas SELECT, confirmadas con MJ). Scripts ad-hoc temporales, borrados al cierre.

- **Ronda 34 — Limpieza de conciliaciones mal asignadas + criterio conservador (sesión con MJ)**:
  - **Disparador**: MJ encontró facturas conciliadas con el movimiento equivocado (ej. factura de Comercial Habitat pegada a una compra Sodimac; Sherwin del 6-mar pegada al pago del 23-mar). Pidió revisar TODA la conciliación.
  - **Detección**: `scripts/audit-conciliaciones-erroneas.ts` (offline sobre dump read-only) marca 3 tipos de error: pago anterior a la emisión de la factura (solo compras con tarjeta — en transferencias a maestros pagar antes es normal), comercio de glosa ≠ comercio de factura, y RUT no calza ni por reembolsador.
  - **Arreglos aplicados en prod** (scripts con dry-run + guards de verificación; backups en `backups/audit-facturas-conciliacion-2026-05-30T*.json`):
    - 1ª tanda (`fix-conciliaciones-cruzadas.ts`): 3 pares cruzados (Easy↔Cavem, Easy↔Sodimac, Cavem↔Sodimac) + Comercial K $4.990 desasignado (factura MercadoLibre 8 meses posterior) + Sherwin $18.683 movido de F-2963377 (6-mar) a F-2974064 (23-mar) vía `fix-sherwin-18683.ts`.
    - 2ª tanda (`fix-conciliaciones-ronda2.ts`): 2 pares cruzados más (Easy↔Sodimac $31.980, Tottus↔Sodimac $17.810) + 10 compras con tarjeta viejas (2025) soltadas de facturas 2026 que no correspondían (no existía factura correcta → vuelven a pendiente).
    - Peaje MercadoPago $10.959 soltado (`fix-mercadopago-peaje.ts`).
    - Conciliado MercadoPago $39.990 → F-12254760 MercadoLibre (`conciliar-mercadolibre-39990.ts`), match exacto.
    - **Grupo 2 (proveedor cruzado) quedó en 0**. Quedan solo Cabify/MercadoPago/Copec (mismo proveedor, boleta mensual — no son errores).
  - **2 reembolsadores nuevos** (`crear-reembolsadores-alejandro-carlos.ts`): Alejandro Henríquez → Comercializadora Angélica Sepúlveda; Carlos Patricio → Climair. Total ahora: **12**.
  - **MercadoLibre**: `scripts/descubrir-mercadopago.ts` lista, por cada mov MercadoPago sin conciliar, las facturas del mismo monto. Hallazgo: de 51 movs sin conciliar, solo 1 tenía factura en el sistema (el $39.990). Los otros 50 no tienen factura electrónica — confirma que el auto-match hizo bien en no inventarlas. Si son gastos a contabilizar: conseguir factura o usar "pago sin factura".
  - **Decisión de criterio (ADR `2026-05-30-conciliacion-conservadora-fecha-flexible.md`)**: la fecha NO es filtro que descarte, solo desempate; match por RUT+monto (+reembolsador); compras con tarjeta por nombre de comercio; ante la duda, dejar pendiente. MJ: "prefiero trabajo manual a trabajo mal hecho".
  - **Implementado en código (cierra #2 de ronda 32 "import toma el primero")**: el importador de cartolas (`/api/banco/import`) tenía una copia inline del auto-match con el bug "toma la primera del mismo monto" — se eliminó y ahora delega en la función compartida `tryAutoMatchMovementWithInvoices`. La decisión se extrajo a la función pura `decideMovementInvoiceMatch` con test de regresión `scripts/test-conciliacion.ts` (13 casos, pasan). Dos caminos: (a) con RUT → debe calzar (directo o vía alias), la fecha no interviene; (b) sin RUT (las 775 compras con tarjeta NO traen RUT) → match por **nombre de comercio** (whitelist `TARJETA_MERCHANTS`: Sodimac/Homecenter, Easy, Cavem, Sherwin/Vespucio, etc.), solo si hay exactamente una factura de ese comercio + monto **dentro de ±31 días** (la boleta de tarjeta es del mismo día; si está a meses, no concilia). Ante duda, pendiente. MercadoLibre excluido (factura de la tienda).
  - **Sigue pendiente**: el sync SII (factura→mov, `tryAutoMatchInvoiceWithExistingMovs`) ya era conservador (RUT + 1 candidato), no se tocó — pero NO hace match por comercio, así que una factura sincronizada del SII no encuentra sola su compra con tarjeta (se concilia al importar la cartola, camino mov→factura). El desempate por fecha entre ambiguas (#1 de ronda 32) se decidió NO implementar.
  - **Marca de conciliación automática (pedido de MJ)**: nuevo campo `InvoicePayment.autoMatched Boolean @default(false)`, lo setean en `true` los 3 caminos de auto-match (los dos `tryAutoMatch*` + `auto-conciliar-pendientes`); las imputaciones manuales quedan `false`. El listado `/facturas` muestra un "auto" gris discreto junto al estado (tooltip "revisá si tenés dudas"). **Solo registra de acá en adelante** — los 497 pagos viejos quedan en `false`. Schema **aplicado en prod** (`db push`, 2026-05-30); **dev sigue caída** → aplicar la columna ahí cuando vuelva (o reset-to-parent). Commit `aea7bd2`.
  - **Unificación total del auto-match (cierra el tema)**: `auto-conciliar-pendientes` tenía una 3ª copia inline con el mismo bug "1 candidato sin chequear RUT" — se eliminó y ahora también delega en `tryAutoMatchMovementWithInvoices`. Barrido confirmado: NO queda lógica de elección de candidato fuera de `invoicePayments.ts`; los 4 puntos de entrada (importador, auto-conciliar, alta de factura, sync SII) usan las funciones compartidas. Además se cerró la **asimetría**: el match por comercio (con ventana de fecha) ahora corre en las DOS direcciones — `tryAutoMatchInvoiceWithExistingMovs` (factura→mov, usado por el sync SII) suma candidatos por comercio, así una factura Sodimac sincronizada encuentra su compra Sodimac aunque el mov no traiga RUT. Las 3 creaciones manuales (modal, bulk, pago sin factura) quedan `autoMatched=false`. tsc/eslint/test (15 casos) OK. NO verificado en runtime (dev caída) — MJ verifica al desplegar.
  - **Pendiente menor**: 50 movs MercadoPago + Cabify/Copec sin factura esperan decisión de MJ (factura o "pago sin factura").

- **Ronda 33 — Limpieza profunda de conciliación bancaria + UX del modal (sesión paralela a ronda 32)**:
  - **Contexto**: sesión larga arrancada para sacar la cotización del maestro (Paseo del Sena), terminó tocando todo el flujo de conciliación bancaria. Corrió simultánea con la auditoría de ronda 32 (sesión paralela). Atacó varios ítems de la cola pendiente de esa ronda.
  - **Cotización Maestro (PRs #52, #53, #54)**: PDF + Excel editable con fórmulas para entregarle al maestro la lista de partidas sin precios. Excel formateado con look BLARQ (logo, headers, zonas COCINA/BAÑO). Incluye fix del bug que duplicaba `subChapter` al duplicar versión de presupuesto.
  - **Modal de conciliación — features y fixes**:
    - **Multi-alias por reembolsador** (PR #56): un reembolsador (Cristóbal, Elias, etc.) puede tener varios RUTs alias (Paula Johanna + Sodimac). Schema nuevo `ReembolsadorAlias`. Schema pusheado a prod, migración corrida.
    - **Match por RUT de la persona** (PR #67): nuevo campo `Reembolsador.personRut` para detectar reembolsador por RUT del banco (más robusto que glosa). Backfilleado 10 reembolsadores existentes.
    - **Recordar pagador + sugerencia por monto** (PR #57): banners ámbar (¿guardar regla?) y verde (match exacto sugerido) en el modal.
    - **Modal bulk asignar** (PRs #60, #61): ordena facturas con monto match arriba + filtra por contraparte cuando todos los movs seleccionados son del mismo cliente.
    - **Listado conciliación más visible** (PRs #58, #59): filas con match en verde + arriba siempre.
    - **Fix RUT con guion** (PR #68): el filtro de búsqueda comparaba mal "77137860-9" vs "0771378609" → normaliza al cuerpo del RUT. Afectaba a Comercial K y a cualquier proveedor con guion.
    - **Auto-match alias-aware** (PR #66): el auto-match usa los aliases de reembolsador para casos como Jose Pérez → JPB.
    - **`tryAutoMatchMovementWithInvoices` valida RUT siempre** (PR #72, **resuelve ítem #3 de ronda 32**): antes con 1 solo candidato no chequeaba RUT (caso Pedro Barrera ↔ Vidrios Rotos). Ahora exige RUT match directo o vía alias; si no calza, queda pendiente.
  - **Historial de pagos + alerta sobre-imputación + botón "quitar"** (PRs #62, #63) en el detalle de factura.
  - **Fix-invoice-status-drift** (PR #64): 174 facturas con `status` atrasado respecto a sus InvoicePayment reales (legacy de la migración Maxxa). Subió pendiente/parcial → pagada. **NO mueve totales de plata** (metrics.ts usa montos/pagos, no status). Verificado: 0 facturas restantes con drift.
  - **Limpiezas manuales de conciliaciones cruzadas (datos en prod)**:
    - SANITOP 27-mar mal linkeada a Paula F-1833 → moved a F-809 SANITOP real (parcial $142.800 de $285.600). Cadena Elias 10-abr/18-may reshuffleada para que F-1833 y F-1884 queden con su pagador correcto.
    - F-1837/F-1858 Paula sobre-imputadas (Cristóbal+Elias linkeados a las DOS) → cada uno a la suya.
    - SODIMAC $15.801 × 2 cruzadas (movs ene/feb intercambiados).
    - Entel × 4 PACs en desorden → cronológico (F-53531550 queda pendiente esperando PAC real).
    - TRANSPORTES YRG 178.500 × 2 cruzadas (F-1718/F-1744).
    - 5 conciliaciones con RUT no calzante deshechas: Muebles→F-1891 Paula, Alejandro→F-875, Christian-mar→F-536, Cristóbal→F-149 MANTENCION, Pedro Barrera→F-58 Vidrios Rotos.
  - **6 reembolsadores nuevos creados en prod**: Maria Jose Blanco (Sodimac+Sherwin+Cavem+Iconica), Sanhueza Torres (MST), Iván Henriquez (Sherwin), Rios Gonzalez (YRG), Christian Geoffroy (su empresa), Nery Tamayo (JPB). Total ahora: 10 reembolsadores activos.
  - **Estado de Pago — bugs + feature**:
    - Bug bloqueante (PR #69): al duplicar partidas para zonas COCINA/BAÑO, las copias compartían `lineageId` → EP no se podía crear (`@@unique[estadoPagoId, lineageId]`). Fix: duplicador genera lineageId nuevo. Datos reasignados (8 ítems Paseo del Sena).
    - EP muestra zonas (PR #70): nuevo `EstadoPagoItem.subChapter` + render de separadores COCINA/BAÑO en pantalla y PDF.
  - **Auditoría de conciliación commiteada** (PRs #71, #72): `audit-conciliacion.ts` (sobre-imputaciones, RUT no calza, status drift, duplicados) y `audit-ambiguas.ts` (grupos mismo proveedor+monto, candidatos a cruzamiento). Para correr cuando MJ quiera.
  - **Notas para MJ**: `docs/REVIEW_conciliacion_2026-05-29.md` — Carlos Patricio (dudoso, +50d) + los 5 movs que quedaron libres post-limpieza esperan su factura real.
  - **Pendiente de la cola de ronda 32 — sigue abierto**: ítems #1 (auto-match sin filtro de fecha), #2 (import:261 toma el primero), #4 (conciliación cobros cliente), #5 (fondoSueldos), #6 (cartola nov 2025), #7 (64 recibidas sin proyecto). Item #3 resuelto en esta ronda.



- **Ronda 32 — Auditoría de facturas y conciliación bancaria + rotación de credencial**:
  - **Auditoría (solo lectura, no se tocó código ni datos)**: dump read-only de prod a JSON (`scripts/audit-dump.ts`, `findMany` con `select`, excluye `pdfContent`) + análisis offline (`scripts/audit-analyze.ts`). Reporte completo en `docs/REVIEW_facturas-conciliacion_2026-05-29.md`. Universo: 749 facturas, 1.615 movimientos, 501 imputaciones, 19 proyectos, 4 reembolsadores.
  - **Rotación de credencial de prod — HECHA en todos lados**. Motivo: el print de debug de `audit-dump.ts` filtró la contraseña de la BD al log de la sesión. Cadena completa ejecutada: (1) Neon → reset password de `neondb_owner` branch production; (2) Vercel → `DATABASE_URL` nuevo en Production (CLI) + Preview (dashboard) + redeploy de prod (alias `blarq-app.vercel.app`, verificado: `/login` 200, `/api/auth/session` 200, sin 500); (3) LaunchAgent `com.blarq.sii-sync-pdfs.plist` → plist actualizado + recargado; (4) `.env.prod` local actualizado. La contraseña vieja quedó inválida. Backups `.plist.bak-*` con la contraseña vieja borrados. El print del script ya está parcheado (no vuelve a imprimir credenciales). ADR `docs/decisions/2026-05-29-credenciales-en-console-logs.md`. El `.env` local (dev, `ep-solitary-mud`) no se tocó.
  - **COLA DE FIXES PENDIENTES (del audit — ninguno tocado, esperan lectura de MJ)**, por severidad:
    1. **Auto-match sin filtro de fecha** (CRÍTICA): el "±15 días" del comentario no existe en el código (`import/route.ts:222-245`, `invoicePayments.ts` `tryAutoMatch*`). Solo matchea por monto+RUT. 59 imputaciones con gap>15d; 5 con factura alternativa más cercana. Casos Entel/Sherwin recurrentes; caso F-1891 con fecha posterior al movimiento.
    2. **`import:261` "toma el primero"** (CRÍTICA): compras con tarjeta no traen RUT → el auto-match agarra cualquier factura del mismo monto, a veces de otro proveedor/proyecto. 43 casos reconstruidos. Ej: Compra Vespucio Oriente → factura de Jorgelina Gabriela existiendo una de Sherwin del mismo día/monto.
    3. **1-candidato-sin-RUT** (detectado por MJ en sesión paralela): cuando hay UN solo candidato por monto y el mov no tiene RUT, igual auto-concilia sin verificar proveedor. Relacionado con #2 pero es el caso de candidato único. Revisar `tryAutoMatchMovementWithInvoices` (no exige RUT cuando `candidates.length===1`).
    4. **Conciliación de cobros del cliente** (MEDIA-ALTA): 110 abonos ≥$1M ($414M) sin asignar; las emitidas se marcan pagada sin vínculo bancario. Es el lado donde un cobro perdido/duplicado no se detectaría (incidente PR#44). Pendiente "Fase 2 cliente del proyecto": `BankMovement.projectId` + mapear persona→proyecto.
    5. **fondoSueldos — código + datos** (MEDIA): las 34/34 emitidas tienen `conceptoCobro=null` → el fondo no puede separar obra/muebles/artefactos. Backfill de las 34 + hacerlo obligatorio al catalogar emitida. Revisar `fondoSueldos.ts`.
    6. **Cartola noviembre 2025** (MEDIA): 0 movimientos ese mes (hueco). Conseguir e importar; mientras tanto no reimportar cartolas 2025 (737 movs sin `balanceAfter` → riesgo de duplicado).
    7. **64 recibidas sin proyecto** (MEDIA): $6,1M neto no atribuido a ningún proyecto. Vista que junte las `projectId IS NULL` para catalogar a mano (no auto-asignar).
  - **Cosas SANAS verificadas** (no tocar): 0 campos nulos, 0 sobre-imputaciones, 0 splits cruzados entre proyectos, 0 doble conteo reembolsador↔sin_respaldo, NCs bien. El "112 facturas pagada sin imputar" resultó 0 problema real (legacy + redondeo).

- **Ronda 31 — Eliminar SimpleFactura: leer facturas directo del SII (RCV)**:
  - **Disparador**: a MJ le llegó el mail de que el plan SimpleFactura vence (27-05-2026). Pregunta si se puede prescindir. Objetivo de fondo: hacer **todo en la app** (leer y emitir), con Maxxa de respaldo hasta tener confianza en la estabilidad.
  - **Hallazgo**: SimpleFactura solo se usaba para **leer** (recibidas + emitidas). La app YA tenía acceso directo al SII con el cert digital vía el Registro de Compras y Ventas (`siiRcv.ts`), pero solo se usaba para linkear NCs. El RCV entrega exactamente la misma data que SimpleFactura, gratis.
  - **Qué se hizo (Fase 1, recibir sin SimpleFactura)**:
    - `siiRcv.ts`: `getRcvDetalle` ahora elige endpoint según operación — `getDetalleCompra` (recibidas) o `getDetalleVenta` (emitidas).
    - `siiDteReader.ts` (nuevo): `fetchDTEsFromSII(opts)` — drop-in replacement de `fetchDTEs` de SimpleFactura. Expande el rango de fechas a meses (el RCV es por período YYYYMM), consulta resumen + detalle, mapea a `RemoteDTE`. RUT en formato `12345678-9` (calza con lo de SimpleFactura → idempotencia intacta).
    - `runSiiSync.ts` (nuevo): lógica de sync extraída del route (upsert idempotente + reglas + auto-match + linkNc). La comparten el botón y el script local.
    - `route.ts` del sync: ahora delega en `runSiiSync`. Usa cert si está configurado, si no cae a mock.
    - `scripts/sync-sii-dtes.ts` (nuevo) + `npm run sii:sync-dtes`: sync local, gemelo del de PDFs. **Camino confiable** (la mac no tiene el bloqueo WAF de la nube).
    - SimpleFactura quedó solo como tipos `RemoteDTE` + datos mock (dev sin cert).
  - **Verificación**: contra el SII real (abril 2026) trae 141 recibidas (124 fact + 9 exentas + 8 NC, $74,6M) y 8 emitidas ($106M). Dry-run idempotencia contra dev: las 141+8 **matchean** registros existentes, 0 se duplicarían. Script local corrido contra dev: 0 creadas, 10 actualizadas (data del SII corrige leves diferencias que dejó SimpleFactura), 131 sin cambio, 1 NC linkeada. `tsc --noEmit` limpio.
  - **PENDIENTE para deploy (MJ)**:
    1. Confirmar que `SII_CERT_BASE64` + `SII_CERT_PASSWORD` están en Vercel (el cert ya vive ahí para otras cosas).
    2. Deploy y apretar "Sincronizar SII" en prod → **verificar si Vercel alcanza al SII** (`www4`/`palena`). Si da error de red/timeout, el WAF bloquea la nube → usar el script local (sumarlo al LaunchAgent horario de PDFs).
    3. Recién con el sync directo verificado en prod: **dejar de pagar SimpleFactura**. Como puente, no cancelar hasta confirmar.
  - **Doc**: `docs/SETUP_SII_lectura-directa.md` (nuevo), `SETUP_SII_simplefactura.md` marcado obsoleto.
  - **FASE 2 (emitir, reemplazar Maxxa)** — no empezada, planificada. Maxxa queda de respaldo. Ya existe `scripts/compare-vs-maxxa.ts` (compara facturas BLARQ vs export de Maxxa por centro de costo) — útil como validación cruzada durante la transición.

- **Ronda 30 — Artefactos se multiplican por cantidad · Cuadro Resumen dinámico**:
  - **Disparador**: MJ notó que el Cuadro Resumen de Francisco de Aguirre no mostraba la columna de artefactos de iluminación.
  - **Bug de fondo en `metrics.ts`**: el `artefactosTotal` sumaba `clientPrice` SIN multiplicar por `quantity`. Quedaba "ok" solo porque varios proyectos venían mal cargados con el TOTAL de línea metido en `clientPrice` (y `quantity` decorativa). Convención correcta confirmada con MJ 2026-05-22: `clientPrice` es precio UNITARIO y se multiplica por `quantity`, igual que muebles.
  - **Datos corregidos en prod** (`scripts/fix-artefactos-precio-unitario.ts`, lista blanca específica): 17 ítems de 4 versiones mal cargadas → precio unitario (`clientPrice / quantity`). Proyectos: Aguirre V7, Cocina Farellones V4, JNC-Vitacura V5, Portofino V1 (borrador). Quedaron FUERA por estar bien cargados: **Paseo del Sena V1** (cargado a mano en la app por MJ) y **Portofino V6** (vigente — calza con multiplicar contra su cuadro al cliente).
  - **Cómo se decidió cada proyecto**: comparando la suma de artefactos contra el cuadro resumen entregado al cliente. Aguirre suma $2.464.558 sin multiplicar = cuadro → mal cargado. Portofino V6 ~$2.912.200 multiplicando = cuadro → bien cargado. Farellones y JNC validados igual con sus cuadros.
  - **Cuadro Resumen → columnas dinámicas** (`CuadroResumen.tsx` reescrito): cada proyecto muestra solo los conceptos con acordado > 0 (obra / cocina / sanitarios / iluminación / muebles). Antes tenía 4 columnas fijas y no mostraba iluminación. Regla MJ: las columnas son las del presupuesto entregado al cliente. Pagos `conceptoCobro=artefactos` se reparten a 3 vías (cocina/sanitarios/iluminación) proporcional al acordado.
  - **Validación (§4.1)**: snapshot prod pre (código viejo) vs post (código nuevo + datos corregidos). 16 de 18 proyectos sin cambios; solo Portofino (+$21.906) y Paseo del Sena (+$172.595) se movieron al alza — corrección de una subestimación previa de los proyectos bien cargados. Portofino quedó en $76.182.019 (cuadro al cliente $76.182.011).
  - **Hallazgo lateral**: dev está desactualizado respecto a prod (le faltan proyectos: Portofino V6, JNC y Paseo del Sena con artefactos). La validación de esta ronda se hizo contra prod directamente. Conviene "reset to parent" de la branch dev en Neon.
  - **Archivos**: `src/lib/projects/metrics.ts`, `src/components/proyecto/CuadroResumen.tsx`, `scripts/fix-artefactos-precio-unitario.ts` (nuevo). Commit `773deb5` en `main`.
  - **Pendiente (Fase 2)**: **Cargar Pauline Dumay V4** (obra+artefactos+muebles) — el proyecto existe en prod (id `cmokbfuwi0002rtz55zvpvj6k`) pero está vacío; MJ pasó los 3 Excel. Lefevre = JNC-Vitacura (mismo proyecto): ya está cargado completo en prod y calza con su cuadro ($49.987.611 app vs $49.983.629 cuadro, drift 0,008%) — no requiere acción. Detalle en `HANDOFF.md`.
  - **Pendiente menor**: error de tipos pre-existente en `MovementReconcileModal.tsx:121` (falta `_rutIssuer`).

- **Ronda 29 — Botón "Nueva partida" en el catálogo**:
  - **Qué se hizo**: la sección `/catalogo/partidas` no tenía forma de crear una partida desde cero — solo nacían desde un presupuesto o duplicando otra. Se agregó un botón "+ Nueva partida" junto a la barra de búsqueda, con un formulario corto (nombre, categoría, unidad) que crea la partida y la abre directo en modo edición.
  - **Sin cambios de schema ni API**: el endpoint `POST /api/catalogo/partidas` ya existía. Cambio solo de UI en `src/components/catalogo/PartidaSearch.tsx`.
  - **Detalle**: se quiso usar un icono de `lucide-react` (lo menciona CLAUDE.md §3) pero esa librería no está instalada — la app usa caracteres de texto para todo. Se usó un "+" de texto.
  - **No verificado en navegador**: la página pide login y la BD daba timeouts de conexión a Neon durante la sesión. Compila limpio (`tsc --noEmit` sin errores en el archivo). MJ verifica al desplegar.
  - **Archivos**: `src/components/catalogo/PartidaSearch.tsx`.

- **Ronda 28 — Fix importador de cartolas bancarias**:
  - **Problema**: el importador deduplicaba por el N° de documento del banco (`externalRef`). Ese número solo lo trae la cartola Histórica; la Provisoria lo trae en cero. Reimportar una cartola en el otro formato duplicaba todos los movimientos.
  - **Arreglo**: campo nuevo `BankMovement.balanceAfter` (saldo corrido tras aplicar cada movimiento). El importador ahora deduplica por `(bankAccountId, date, amount, balanceAfter)`. El `@@unique` se reemplazó por esa tupla.
  - **Detalle no obvio**: el banco lista los movimientos de un mismo día en distinto orden según el formato. Si el saldo corrido se calcula en orden de fila, el mismo movimiento da `balanceAfter` distinto en cada formato. Por eso `santanderParser.ts` ordena por (fecha, monto, descripción) antes de acumular — el conjunto de un día es idéntico entre formatos, solo cambia el orden.
  - **Schema**: aplicado en dev y prod (`balanceAfter Float?`, nullable).
  - **Prod**: backup completo previo (`backups/blarq-prod-2026-05-17T18-13.json.gz`). Backfill de `balanceAfter` sobre 878 movimientos (dic 2025–may 2026, cruzado contra 12 cartolas). Reconcile antes/después: Operativa y Sueldos calzan exacto. **737 movimientos de Operativa (historia mar–oct 2025) quedan con `balanceAfter` en null** — no hay cartola de ese período. No molesta salvo que se reimporte una cartola de 2025: ahí sí duplicaría. Si aparece, conseguir las cartolas Operativa 30–35 y volver a correr el backfill.
  - **Verificado**: reimport en dev por el endpoint real (Histórica, reimport mismo formato, Provisoria del mismo período) → 0 duplicados. Simulación read-only contra prod → 0 se crearían.
  - **Limitación conocida**: si se exporta una Provisoria con su último día incompleto y después se importa la Histórica de ese mes, los pocos movimientos de ese día parcial podrían duplicarse.
  - **Archivos**: `prisma/schema.prisma`, `src/lib/banco/santanderParser.ts`, `src/app/api/banco/import/route.ts`; scripts nuevos `scripts/reconcile-cartolas.ts` (read-only, compara BD vs cartolas) y `scripts/backfill-balance-after.ts`.
  - **PR**: [#50](https://github.com/blarq-app/blarq-app/pull/50). Sin tocar `metrics.ts`.

- **Ronda 27 — Cálculo: EP fuera del costo · Catálogo de artefactos auto-construido**:
  - **EP fuera del cálculo de costo (`metrics.ts`)** — decisión de MJ formalizada: *"la contabilidad no debe salir de los EP, sino de las facturas o mov sin respaldo"*. El EP es una herramienta de cálculo (cuánto pagarle al maestro según avance), NO una fuente de costo. Cambio: `totalGastado` y `totalGastadoConIva` ya no suman `totalPagadoMaestros` (EPs cerrados). Se eliminó el campo `totalPagadoMaestros` del `ProjectMetrics` y del `conceptDeviations` (costLabor). El costo del proyecto ahora sale 100% de facturas recibidas (incluidos los pagos sin respaldo, que son `Invoice` recibida). `project.estadosPago` se sigue usando para el avance de obra (% ponderado) — eso no es costo.
    - **Verificación (§4.1)**: snapshot pre/post de los 17 proyectos en dev → **diff vacío, ningún total se movió** (ningún proyecto tiene EP cerrados cargados en la app, justo como se esperaba). `scripts/test-metrics.ts` corre con 2 fallas **pre-existentes** (sobre `totalAcordado`, fixture desactualizado — verificado que ya fallaban antes del cambio); se eliminó la única assertion sobre `totalPagadoMaestros`.
    - **`scripts/compare-metrics.ts`** quedó desactualizado (su cálculo "legacy" todavía resta EPs) — es un comparador ad-hoc obsoleto, no se tocó. Si se vuelve a usar, hay que actualizarlo.
  - **Catálogo de artefactos auto-construido** — pedido de MJ: el catálogo no es una lista curada de "los más usados"; se construye solo con cada producto que se agrega a cualquier cotización (como el listado de materiales). Helper nuevo `src/lib/catalog/ensureArtefactoCatalog.ts`: busca una entrada por nombre (case-insensitive) y la reutiliza, o la crea. Se llama desde el POST de artefactos y desde el importador de Excel. Cada `ArtefactoItem` queda con `catalogId`.
    - **Backfill**: `scripts/backfill-artefacto-catalog.ts` (dry-run por defecto, `--apply`) vincula los items históricos sin `catalogId`. En dev: 72 items → 43 entradas nuevas + 29 reusadas (dedup por nombre OK). **Falta correrlo en prod** (`--apply` con DATABASE_URL de prod) para poblar el catálogo con la variedad histórica.
  - **Archivos**: `src/lib/projects/metrics.ts`, `proyectos/[id]/resumen/page.tsx`, `scripts/test-metrics.ts`, `src/lib/catalog/ensureArtefactoCatalog.ts`, `src/app/api/presupuestos/[id]/artefactos/route.ts`, `src/app/api/proyectos/[id]/importar-artefactos/route.ts`, `scripts/backfill-artefacto-catalog.ts`.
  - **Pendiente**: (1) correr el backfill del catálogo en prod. (2) Las 2 fallas pre-existentes de `test-metrics.ts` (`totalAcordado` 1499400 vs 1487500) — fixture desactualizado, conviene revisarlo en una ronda futura.

- **Ronda 26 — "Pago sin factura" desde movimientos del banco**:
  - **Problema**: hay transferencias bancarias que son pagos a maestros que NO emiten factura (caso disparador: Daniel Ignacio Santibáñez, 11 transferencias). Quedaban como movimientos "pendientes" sin entrar como costo de ningún proyecto. No había forma desde la UI de decirle a la app "esta transferencia es un costo del proyecto X, categoría Y".
  - **Solución**: nueva acción masiva **"Pago sin factura"** en la barra de selección de `/banco/movimientos`. MJ selecciona uno o varios egresos, elige proyecto + categoría, y la app crea por cada movimiento un registro de costo `Invoice` con `origin="sin_respaldo"` (type=recibida, tipoDoc=1043, iva=0, monto = el de la transferencia, nombre/RUT de la contraparte del movimiento), lo deja `pagada` y conciliado contra el movimiento vía `InvoicePayment`. Eso entra solo en `totalGastado` / `realByCategory` del proyecto (metrics.ts no filtra por origin).
  - **Limpieza de huérfanos**: la acción "Desasignar" ahora, si la factura que pierde su imputación es un `origin="sin_respaldo"` y queda sin pagos, **borra esa factura** — era un registro auto-creado, sin el movimiento no significa nada. Evita registros de costo huérfanos.
  - **Sin cambios de schema. Sin tocar metrics.ts.** El `folioNumber` del registro sin respaldo se genera como `SR-<externalRef|id del movimiento>` para respetar el unique `dte_unique`.
  - **Archivos**: `src/app/api/banco/movimientos/bulk/route.ts` (acción `pago_sin_factura` + limpieza en `desasignar`), `banco/movimientos/page.tsx` (pasa proyectos + categorías), `MovementsTable.tsx`, `MovementsBulkBar.tsx` (botón + modal `PagoSinFacturaModal`).
  - **UI**: para un solo movimiento, MJ marca su checkbox y usa la barra (la barra ya funciona con 1+). No se tocó el modal de conciliación per-fila.
  - **DECISIÓN CONTABLE PENDIENTE (planteada por MJ esta ronda)**: MJ dijo *"la contabilidad no debe salir de los EP, sino de las facturas o mov sin respaldo"*. Los Estados de Pago son una herramienta de **cálculo** (cuánto pagar al maestro según avance), NO una fuente de costo. Hoy `metrics.ts` SÍ suma los EP cerrados como costo (`totalPagadoMaestros`). Hoy no causa problema porque ningún proyecto tiene EP cerrados en la app (los de Daniel se hicieron en Excel). Pero **cuando MJ empiece a usar EP en la app**, sumar EP + mov sin respaldo del mismo dinero contaría doble. Hay que sacar el EP del cálculo de `metrics.ts` ANTES de ese momento. Es un cambio al archivo contable → requiere snapshot pre/post (§4.1). No se hizo esta ronda.
  - **Pendiente para MJ**: probar "Pago sin factura" con las transferencias de Daniel (a los proyectos que le pase JT). Recordar: el masivo asigna todo al MISMO proyecto+categoría, así que agrupá por proyecto.

- **Ronda 25 — Pendientes de artefactos (ronda 18) retomados**:
  - **Contexto**: MJ pidió retomar los pendientes de la cotización de artefactos. Estado al cerrar:
  - **"Revisar precios online"** — botón nuevo en el editor de artefactos. Recorre los items que tienen link cargado, baja la página de cada producto y abre un modal con el diff: precio actual vs. precio del momento, imagen actual vs. imagen del sitio. MJ marca con checkbox qué cambios aplicar. Cubre también el pendiente "auto-extraer imagen en bulk" — el mismo modal trae imágenes faltantes.
  - **"Traer de otra cotización"** — botón nuevo. MJ elige una cotización de artefactos de otro proyecto (o de otra versión), se duplica entera dentro de la actual. Al duplicar, los precios se refrescan online automáticamente (el descuento pactado se mantiene; el precio cliente se recalcula). Los items sin link o con link caído quedan reportados como "revisá a mano". **Esto reemplazó la idea de "templates de espacio"** — MJ aclaró que no quiere armar recetas, quiere duplicar cotizaciones viejas y que los precios se actualicen solos.
  - **Desvincular del catálogo** — la estrella ★ de cada item ahora es toggle: si el item está catalogado (verde), click lo desvincula (`catalogId → null`). Desvincular toca solo ESE item; las otras copias del mismo `catalogId` en la cotización quedan como estaban. Resuelve el caso "quiero editar este item sin que el cambio se propague".
  - **Sincronización por nombre (ajuste pedido por MJ al probar)** — antes la propagación de datos entre artefactos solo funcionaba si compartían `catalogId`. Los WC importados de Excel no tienen `catalogId`, así que editar uno no tocaba a los otros "WC ATENAS". Ahora `updateItem` (cliente) y el `PUT` de `/artefactos/[itemId]` (servidor) también propagan a los items con el **mismo nombre** dentro de la cotización: detail, brand, listPrice, discountPercent, clientPrice, referenceLink, imageUrl. NO se propaga `name` (es la clave de agrupación) ni `realCostBlarq` (costo interno por item). Match case-insensitive.
  - **PDF de artefactos** — el pendiente de la ronda 15 ("aplicar línea editorial al PDF de artefactos") **ya estaba hecho** desde la ronda 18. El WIP estaba desactualizado. Sin acción.
  - **Sin cambios de schema.** Sin tocar `metrics.ts`.
  - **Archivos**: `src/lib/catalog/revisarArtefactos.ts` (scraping masivo, concurrencia 5), endpoints `revisar-precios` / `fuentes` / `importar-de` bajo `/api/presupuestos/[id]/artefactos/`, componentes `RevisarPreciosArtefactos.tsx` + `DuplicarArtefactos.tsx`, editor `ArtefactosEditor.tsx`.
  - **Verificado**: `tsc`, `eslint` y `npm run build` pasan limpio. **No probado en navegador con datos reales** — falta que MJ lo pruebe en una cotización de artefactos de verdad.
  - **Limitación conocida**: el scraping masivo puede tardar. En cotizaciones grandes (~37 items) puede acercarse al límite de tiempo de función de Vercel. Si pasa, la UI muestra error y se reintenta. `maxDuration` puesto en 120s (Vercel lo capa según el plan contratado — verificar si molesta).
  - **Pendiente para MJ después del deploy**:
    1. Probar "Revisar precios online" en una cotización con varios links cargados.
    2. Probar "Traer de otra cotización" duplicando una cotización vieja.
    3. Probar el toggle de desvincular (★ verde → click).
  - **Pendientes de artefactos que NO se tocaron** (siguen abiertos, ver ronda 18): el "agente conversacional" (ambicioso, lejos) y las tareas operacionales de MJ (cargar paleta estándar en el catálogo, etc.).

- **Ronda 24 — Multi-select + acciones masivas en `/banco/movimientos` (Fase 1)**:
  - Checkbox por fila + "seleccionar todo" en la cabecera. Las transferencias internas no son seleccionables (no se imputan).
  - Barra flotante abajo-centro cuando hay selección, con dos acciones:
    - **Desasignar** — borra los `InvoicePayment` de los movs elegidos, status → `sin_asignar`. Pide confirmación. El botón se deshabilita si ninguno tiene imputaciones.
    - **Asignar a factura** — abre un buscador de facturas **emitidas** (reusa `/api/facturas/search`); cada mov elegido se imputa por su monto completo (`|amount|`) como un pago. Reemplaza imputaciones previas del mov. status → `conciliado`.
  - En ambas acciones las facturas afectadas recalculan status vía `recomputeInvoiceStatus`.
  - **Implementación**: endpoint nuevo `POST /api/banco/movimientos/bulk`. La tabla de `/banco/movimientos/page.tsx` pasó a componente client (`MovementsTable.tsx`) para compartir estado de selección; barra en `MovementsBulkBar.tsx`. No toca schema.
  - **PENDIENTE — Fase 2 "cliente del proyecto"** (no se hizo, sigue siendo decisión abierta): `BankMovement` no tiene `projectId` ni `conceptoCobro`; enseñarle a la app quién transfiere de cada proyecto (Carolina Ovalle → Portofino) y que el Cuadro Resumen lea transferencias asignadas directo a proyecto+concepto, con o sin factura. Las 2 transferencias negativas de Carolina (−$2.912.199 total) son devolución al cliente y deben restar del cobrado.

- **Ronda 23 — Sesión larga con MJ (2026-05-15/16). Varios PRs mergeados a prod**:
  - **PR #34 — bloque "Detalle por costo directo"** en el editor del presupuesto de obra (`CostoDirectoDetalle.tsx`): agrupa `ObraItemComponent` por tipo, fila por componente con expand a las partidas donde aparece. + scripts `import-base-datos-excel.ts`, `snapshot-components-from-catalog.ts`, `investigate-cost-snapshot-drift.ts`, `quick-drift-check.ts`.
  - **Import de componentes desde Excel BASE DATOS**: los proyectos importados de Excel tenían componentes contaminados del catálogo (caso Aguirre 3.1: subcontrato Daniel Beltrán $15.5M cuando el Excel firmado decía $480k). Se aplicó `import-base-datos-excel.ts` en **prod** a Aguirre V7 y Lefevre V5 — los componentes ahora salen de la hoja BASE DATOS del Excel firmado, no del catálogo. Snapshot retroactivo desde catálogo aplicado a Depto Colon V1_Sin/V1_Con en prod.
  - **Lefevre renombrado a "JNC-Vitacura"** por MJ. Import V5 Muebles ($10.956.319) + Artefactos ($2.106.796 sin iluminación — MJ la cobra dentro de obra). Script `import-lefevre-muebles-artefactos-v5.ts`.
  - **Portofino V6 cargado en prod** (PR via `import-budget.ts`): Obra V6 CD $40.970.853 / total $61.919.250, Muebles $11.350.562, Artefactos $2.912.199. V1 quedó como histórico (MJ lo manejó). El bug de doble cuenta de perchas (qty 2) se corrigió con `fix-portofino-artefactos-v6.ts` (re-import con `parseArtefactos.ts`). **PENDIENTE (spawn task ya creado)**: `import-budget.ts` tiene el bug de doble cuenta para artefactos con qty>1 — debe usar `parseArtefactos.ts`.
  - **PR #40 — bloque "Cuadro Resumen"** en `/proyectos/[id]/resumen` (`CuadroResumen.tsx`): acordado por concepto (Obra/Art.Cocina/Art.Sanitarios/Muebles) + transferencias conciliadas con facturas, con fecha y N° folio. Para `conceptoCobro=artefactos` reparte cocina/sanitarios proporcional al presupuesto. **PR #42** lo movió arriba (debajo de los cards). **PR #43** corrigió GG/Utilidad de obra a fórmula aditiva (estaba encadenada).
  - **PR #41 — eliminado el bloque "Estado de Cobros al Cliente"** de /resumen (info duplicada con cards + Cuadro Resumen).
  - **PR #44 — BUG GRAVE del importador de cartolas bancarias**: el constraint único de `BankMovement` era `(bankAccountId, date, amount, description)` — sin `externalRef`. Cuando un cliente hacía 2 transferencias del mismo monto el mismo día, la 2ª se descartaba como duplicado y se perdía plata. Detectado en Carolina Ovalle (cliente Portofino): 22 transferencias en cartola, solo 19 en la app — faltaban 3× $5.000.000 = **$15.000.000**. Fix: constraint incluye `externalRef` + check de duplicado explícito en `/api/banco/import`. Schema aplicado en dev y prod. Las 3 faltantes cargadas con `fix-carolina-missing-transfers.ts`. **PENDIENTE para MJ**: re-importar TODAS las cartolas históricas con el importador corregido (es idempotente) — puede haber transferencias perdidas en otras cuentas/períodos.
  - **PR #44 también** — cards de `/banco/movimientos` muestran monto neto como protagonista (antes era la cantidad de movimientos).
  - **Dato útil descubierto**: el cliente Portofino es RUT **76337771-7 (AGRICOLA OVALLE TIL TIL LTDA)** — las transferencias bancarias salen a nombre de "Maria Carolina Ovalle" (persona), por eso no calzan con las facturas por RUT.

  - **PENDIENTE — Multi-select + acciones masivas en `/banco/movimientos`** (lo que MJ quería al cierre, no se alcanzó a hacer):
    - **Objetivo**: poner checkbox de selección en cada fila + un bar de acciones masivas. MJ quiere poder "desasignar facturas en masa y rehacer la conciliación".
    - **Acciones definidas con MJ**: (1) "Desasignar" — quita los `InvoicePayment` de los movimientos seleccionados, vuelve status a `sin_asignar`. (2) "Asignar a factura" — concilia los seleccionados con una factura emitida elegida (cada uno como pago parcial).
    - **Decisión arquitectónica abierta — Fase 2 "cliente del proyecto"**: MJ quiere "enseñarle a la app quién le transfiere de cada proyecto" (transferencias de Carolina Ovalle → Portofino), como los Reembolsadores. Y que el Cuadro Resumen pueda leer transferencias asignadas directo a un proyecto+concepto, con o sin factura (hoy `BankMovement` no tiene `projectId` ni `conceptoCobro` — habría que agregarlos). Las 2 transferencias negativas de Carolina (−$1.912.199 y −$1.000.000, total −$2.912.199) son una devolución al cliente y deben restar del cobrado.
    - **Implementación**: requiere convertir la tabla de `/banco/movimientos/page.tsx` (hoy server, filas 389-505) en un componente client para compartir estado de selección entre checkboxes y bar. Endpoint nuevo `POST /api/banco/movimientos/bulk`. Reutilizar el patrón de `BulkAssignBar.tsx` (existe en /facturas).

- **Ronda 22 — Zonas (subChapter) en partidas de obra**:
  - **Disparador**: V2 de Paseo del Sena, clienta pide separar cocina y baños dentro del mismo presupuesto (un solo contrato, una sola V2). El modelo ya tenía `ObraItem.subChapter` y el editor lo mostraba como bandita gris, pero no había forma de escribirlo desde la UI — solo entraba vía Importar Cubicación.
  - **PR [#35](https://github.com/blarq-app/blarq-app/pull/35)** — habilitar asignación de zona desde la UI:
    - PUT y POST de `/api/presupuestos/[id]/partidas` aceptan `subChapter` (antes lo ignoraban).
    - Nuevo `POST .../partidas/[itemId]/duplicate` — duplica partida con snapshot de componentes, para partir mixtas en dos.
    - Editor: link "+ zona" / "↻ zona" inline en cada fila con autocompletado, bandita gris clickeable para renombrar grupo entero (bulk update), botón ⎘ duplicar al hover.
  - **PR [#36](https://github.com/blarq-app/blarq-app/pull/36)** — selección múltiple:
    - Checkbox por fila + "select all" en header.
    - Barra flotante centrada abajo aparece con selección: contador, input zona, Aplicar, Quitar zona, Limpiar. Mucho más rápido que ir fila por fila.
  - **PR [#37](https://github.com/blarq-app/blarq-app/pull/37) + [#38](https://github.com/blarq-app/blarq-app/pull/38)** — subtotal por zona prolijo:
    - Subtotal por zona en la misma fila gris donde dice COCINA/BAÑO, alineado bajo Total. Lee como titular: `BAÑO ........ $ 662.866`. Aplica al editor y al PDF cliente.
    - Una fila menos por grupo, más editorial. Solo se muestra si el capítulo tiene 2+ zonas distintas (sino == subtotal del capítulo).
  - **No toca**: `metrics.ts` ni cálculos contables — la zona es separador visual, no afecta totales ni GG/utilidad.

- **PENDIENTES previos de ronda 21** (sin tocar en esta sesión, siguen vigentes):
  1. Pushear "Detalle por costo directo" en `CostoDirectoDetalle.tsx` (queda en otro worktree).
  2. Snapshot retroactivo Depto Colon V1_Sin / V1_Con en prod.
  3. Import BASE DATOS Excel para Aguirre V7 y Lefevre V5 en prod.

- **Ronda 21 — Bloque "Detalle por costo directo" en editor + scripts de import/diagnóstico**:
  - **Mergeado antes en esta misma sesión (PR #21, commit `e02dee3`)** — fix presentación `/resumen`:
    - `/proyectos/[id]/resumen` — "Desglose de Gastos Reales" pasa a neto (era c/IVA sin indicarlo), aplica signo de NC (tipoDoc=61) igual que metrics.ts. Antes el desglose no aplicaba signo a NCs y eso desalineaba con la tabla "Presupuesto vs Real".
    - Agrega fila "Gastos generales" a la tabla "Presupuesto vs Real" para que el subtotal cierre con el card "Gastado".
    - Script efímero `scripts/investigate-rosas-materiales.ts` para diagnosticar facturas sospechosas en Materiales (resultado: ninguna, era el bug del signo).
  - **EN LOCAL — sin pushear todavía (working tree del worktree `claude/wizardly-aryabhata-978e1b`)**:
    - `src/components/presupuesto/CostoDirectoDetalle.tsx` — bloque nuevo en el editor del presupuesto que muestra "Detalle por costo directo": agrupa los `ObraItemComponent` por tipo (Materiales / MO / Herramientas / Subcontrato / Pérdidas / Margen) y dentro de cada tipo muestra una fila por componente (agrupado por materialId si existe, sino por descripción normalizada). Cada fila se expande para mostrar en qué partidas aparece.
    - `src/app/(dashboard)/proyectos/[id]/presupuesto/[budgetId]/page.tsx` — agrega `include: { components: ... }` a obraItems del query.
    - `src/components/presupuesto/ObraEditor.tsx` — renderiza el bloque nuevo después del "Resumen Presupuesto".
  - **Investigación drift de snapshots `cost*` del ObraItem vs sum de `ObraItemComponent`**:
    - `scripts/investigate-cost-snapshot-drift.ts` — reporta drift por presupuesto en todos los proyectos.
    - `scripts/quick-drift-check.ts` — versión filtrada por proyectos específicos.
    - **Hallazgo principal**: drift sistémico en proyectos importados desde Excel viejos. Caso peor: Aguirre V7 ítem 3.1 "PROYECTO ELECTRICO" con snapshot $748k (correcto del Excel firmado) vs components actuales $16.833.420 (catálogo contaminado con un subcontrato Daniel Beltrán mal asignado).
    - **Causa raíz** (Aguirre 3.1): la PartidaCatalog del catálogo BLARQ tiene cargado un subcontrato Daniel Beltrán a $15.586.500. En el Excel V7 BASE DATOS la misma partida vale $480.000 + AUMENTO EMPALME $200.000 = $748.000 (lo firmado con la cliente). Alguien (probablemente JT) editó esa partida del catálogo en algún momento, contaminando el snapshot del proyecto.
    - **Conclusión**: para proyectos viejos (importados desde Excel), la verdad de los componentes vive en la hoja BASE DATOS del Excel original, NO en el catálogo BLARQ actual.
  - **Decisión arquitectónica (MJ 2026-05-15)**:
    - **Proyectos viejos** (importados desde Excel): los components reales se cargan desde la hoja BASE DATOS del Excel original. Script `scripts/import-base-datos-excel.ts` (dry-run por defecto, `--apply`).
    - **Proyectos nuevos** (a futuro): NO van a venir de Excel. Se importa solo cubicación de JP (partidas + cantidades). El resto (precios, componentes) vive en la app, matcheando contra el catálogo BLARQ.
    - **La regla "presupuesto aprobado no se toca por cambios al catálogo"** ya existe desde la ronda 12 (snapshot `ObraItemComponent` por proyecto). Hay que verificar que no tenga agujeros.
  - **Scripts nuevos disponibles para próxima sesión**:
    - `scripts/import-base-datos-excel.ts --project X --version V --excel /path/to.xlsx [--apply]` — importa hoja BASE DATOS del Excel y popula ObraItemComponent del proyecto, pisando lo que vino del catálogo. NO toca `cost*` del item ni `total`.
    - `scripts/snapshot-components-from-catalog.ts --project X [--version V] [--apply]` — para proyectos creados en la app sin components copiados (caso Depto Colon), copia desde el catálogo HOY al snapshot del proyecto. Replica la lógica del endpoint POST partidas.
    - `scripts/investigate-cost-snapshot-drift.ts` y `scripts/quick-drift-check.ts` — diagnóstico read-only.

  - **Aplicado en DEV (no en prod todavía)**:
    - Aguirre V7 → import BASE DATOS Excel. 60/70 items matched (los 10 sin match son cabeceras tipo "4.1 BAÑOS" y ajustes globales). 270 components creados. Total componentes pasa de $49.5M (contaminado) a $39.7M (calza con sum de snapshot cost* de items matched).
    - Lefevre V5 → import BASE DATOS Excel. 51/51 match perfecto. 251 components creados. Total componentes calza con snapshot cost* al peso (diff $26 redondeo).
    - Constanza Bravo (V1_Sin y V1_Con) → snapshot retroactivo desde catálogo + revertido después (MJ confirmó que la versión que vale está en prod, no en dev; el script `revert-constanza-snapshot.ts` fue ad-hoc, ya borrado).

  - **Estado de PROD al cierre (verificado read-only el 2026-05-15)**:
    - **Paseo del Sena V1** (= "Veronica" en jerga MJ): enviado, 40/40 items con components. Drift +$549k (4%). ✅ NO requiere acción.
    - **Depto Colon V1_Sin ampliación** (= "Constanza" V1_Sin): enviado, 27 items, **solo 7 con components**. Drift -$3.7M. ⚠️ Pendiente snapshot retroactivo desde catálogo.
    - **Depto Colon V1_Con ampliación**: enviado, 33 items, **solo 7 con components**. Drift -$6.4M. ⚠️ Pendiente snapshot retroactivo.
    - **Francisco de Aguirre V7**: aprobado, 60/70 con components. Drift +$7.3M. ⚠️ Pendiente import BASE DATOS Excel.
    - **Aguirre V4-BAÑO-VISITAS**: 16/16, drift -$1k. ✅ OK.
    - **Lefevre V5**: aprobado, 51/51 con components. Drift +$848k (chico). ⚠️ Pendiente import BASE DATOS Excel.
    - **Lefevre V4 borrador**: 49/49, drift +$664k. Decidir si arreglar.
    - **Lefevre V1 borrador**: 2/0, snap $312k. Probablemente abandonado.
    - **Rosas / Portofino / Arrau / Cocina Farellones**: MJ decidió DEJARLOS — no aplicar import.

  - **PENDIENTE para próxima sesión** (en este orden recomendado):
    1. **Pushear el bloque "Detalle por costo directo"** a prod (PR aparte, presentacional, no toca datos). Cambios locales en `CostoDirectoDetalle.tsx`, `ObraEditor.tsx`, `presupuesto/[budgetId]/page.tsx`.
    2. **Snapshot retroactivo en prod** sobre **Depto Colon V1_Sin + V1_Con**: correr `scripts/snapshot-components-from-catalog.ts --project "Depto Colon" --apply` apuntando a prod (env DATABASE_URL de Neon `ep-shy-morning`).
    3. **Import BASE DATOS Excel a prod** sobre **Aguirre V7 y Lefevre V5**: el Excel de Aguirre está en `/Users/mjblanco/Library/CloudStorage/GoogleDrive-mjblanco@blarq.cl/Unidades compartidas/BLARQ-SOCIOS/2- PROYECTOS/54_CAMILA DECOMBE/OBRA/5- PRESUPUESTO/V7_Entrega/V7_ OBRA_ FCO DE AGUIRRE.xlsx`, el de Lefevre en `/Users/mjblanco/Library/CloudStorage/GoogleDrive-mjblanco@blarq.cl/Unidades compartidas/BLARQ-SOCIOS/2- PROYECTOS/63_CRISTIAN LEFEVRE/1- Presupuesto/V5/V5_ OBRA_CRISTIAN LEFEVRE_08.04.26.xlsx`.
    4. **Pendientes menores**: decidir qué hacer con Lefevre V4 borrador y V1 borrador.

  - **Notas para no olvidar al retomar**:
    - El DATABASE_URL de prod lo conseguimos vía Neon Console (https://console.neon.tech/) → branch `production` → Connect → "Copy snippet" (Vercel oculta el valor de variables Sensitive, no se puede leer desde ahí). Guardar en `.env.prod` local (gitignored) — la usuaria debe regenerarlo cuando se retome la sesión.
    - **Constanza Bravo (en dev)** ≠ Depto Colon (prod). MJ dijo "yo ya entregué la version que esta en prod, esa es la que vale". Dev tiene 0 components para Constanza (revertido al estado pre-script).
    - **Veronica (en dev) no existe**. En prod se llama Paseo del Sena.
    - El bloque "Detalle por costo directo" está implementado pero MJ todavía no decidió si reemplazar el desglose granular por uno agregado simple (Materiales total / MO total / etc) cuando el granular sea inconsistente con el snapshot. Decisión postergada — los proyectos que importemos desde BASE DATOS van a tener granular fiel, así que probablemente no haga falta.

- **Ronda 20 — Sync diferencial cotización ↔ catálogo (PR #31, mergeado y deployado)**:
  - **Síntoma reportado por MJ**: agregó el material "FLEXIBLE GAS 1MT HI-HI1/2" a la partida "INSTALACION ENCIMERA GAS" en el catálogo. Abrió la cotización Paseo del Sena, apretó "Actualizar" en el banner amarillo. No pasaba nada.
  - **Causa raíz**: el sync existente solo actualizaba precios de componentes ya presentes en el `ObraItem`. Si el catálogo tenía un componente nuevo, nadie lo agregaba al presupuesto. Y al revés: si MJ borraba un componente del catálogo, los presupuestos seguían con el componente viejo.
  - **Cambio mayor implementado** (`syncBudgetWithCatalog`): diff completo entre `PartidaCatalog` y los `ObraItem` derivados en borrador. Agrega faltantes, actualiza stale, borra huérfanos. Respeta componentes customizados individualmente y descartes intencionales (tabla `ObraItemDiscardedCatalogComponent`).
  - **Granularidad fina de `isCustomized`**: ahora editar/agregar un componente puntual blinda solo ese componente, no la partida entera. Antes cualquier toque marcaba la partida toda como custom y la bloqueaba del sync.
  - **Regla contractual nueva (MJ 2026-05-15)**: partidas con `lineageId` heredado de una versión enviada/aprobada quedan blindadas — el sync no las toca aunque la versión actual sea borrador. La explicación de MJ: "no le voy a cambiar el costo de una partida a un cliente por actualización". Las partidas nuevas en V2 sí se sincronizan.
  - **Schema** (aditivo, aplicado en dev y prod): `ObraItemComponent.originComponentId String?` + tabla nueva `ObraItemDiscardedCatalogComponent`.
  - **Backfill aplicado en prod**: `scripts/backfill-origin-component-id.ts` mapeó 1562/1625 componentes (96%). 63 quedan sin map (38 ambiguos + 25 sin coincidencia) — protegidos por guarda anti-duplicados.
  - **Detalle de infra detectado**: el `.env` del repo apunta a `ep-solitary-mud` (dev/staging), no a prod. La BD que usa Vercel es `ep-shy-morning` (la mencionada en CLAUDE.md). MJ accede a través de Neon directo, no Vercel CLI — Vercel marca el DATABASE_URL como "Sensitive" y la CLI no decrypta.
  - **Estado**: deployado y en prod. MJ va a probar a su ritmo. **Paseo del Sena V1 obra está en estado "enviado"** — para probar el sync nuevo hay que usar otro proyecto en borrador o devolver Paseo del Sena a borrador.
  - **Referencias**: commit `d28fe6d`, PR [#31](https://github.com/blarq-app/blarq-app/pull/31), ADR `docs/decisions/2026-05-15-sync-diferencial-cotizacion-catalogo.md`.

- **Próximos pasos pendientes (ronda 20)**:
  - MJ prueba el flujo end-to-end en un proyecto en borrador (no Paseo del Sena V1, está enviado).
  - Si el sync se siente bien: dejar el script de backfill en `scripts/` para correr si en el futuro hace falta. Es idempotente y no toca datos sensibles (solo escribe `originComponentId`).
  - Eventualmente: limpiar branches `claude/funny-edison-455814` y `claude/docs-sync-diferencial` en GitHub (ya mergeadas).

- **Ronda 19 — Fix: las reglas de proveedor guardaban centro de costo sin consentimiento**:
  - **Síntoma**: MJ ve en `/facturas` que TODAS las facturas nuevas de Easy entran a Portofino, aunque históricamente Easy compra para muchas obras (Cocina Farellones, Ampliación Casa Arrau, Quincho La Llaveria, Francisco de Aguirre). Al cambiar una a "Ampliación Casa Arrau", el toaster avisa "1 regla cambiada" — sin que MJ haya pedido crear regla.
  - **Causa raíz**: el toggle "Guardar regla" en `BulkAssignBar` solo se mostraba cuando MJ asignaba categoría, pero el backend lo aprendía para categoría Y proyecto siempre (default ON). Cuando solo cambiaba proyecto, el toggle no aparecía → MJ no sabía que estaba guardando regla. La edición inline (PATCH) tampoco tenía toggle. Cada cambio de proyecto reescribía la regla del RUT, y `upsertInvoiceRule` dispara `updateMany` retroactivo (todas las facturas del mismo RUT con `projectId=null` se asignan al proyecto nuevo). Para proveedores transversales como Easy, eso es destructivo.
  - **Fix** (PR #28, branch `claude/gracious-banzai-f595ab`):
    - `src/app/api/facturas/bulk-assign/route.ts`: body acepta `learnCategoryRule` (default true) y `learnProjectRule` (default **false**), por separado. Reemplaza al campo único `learnRule`.
    - `src/app/api/facturas/[id]/route.ts` (PUT y PATCH): nunca pasan `projectId` a `upsertInvoiceRule`. Solo aprenden categoría.
    - `src/components/facturas/BulkAssignBar.tsx`: dos toggles independientes — "Guardar categoría en regla" (ON default, visible cuando hay categoría) y "Guardar centro de costo en regla" (OFF default, visible cuando hay proyecto). Tooltips explican cuándo prender cada uno.
    - `CLAUDE.md` §4.5 actualizado con el nuevo comportamiento.
  - **Verificación**: `scripts/test-rules.ts` corre igual antes y después (los fallos pre-existentes son del test desactualizado, no de mis cambios). TypeScript limpio.
  - **Pendiente para MJ después del deploy**:
    1. Verificar visualmente los dos toggles en `/facturas` (no pude testear UI sin sesión).
    2. Revisar la regla actual de Easy en prod — si quedó apuntando a Arrau o Cocina Farellones, decidir si borrarla manualmente.
    3. Revisar facturas de Easy de mayo en prod y corregir las mal asignadas a Portofino. Con el fix desplegado, esos cambios ya no contagian al resto.
  - **Nota técnica**: `scripts/test-rules.ts` tiene firmas desactualizadas de `upsertInvoiceRule` (pasa string en lugar de objeto). Pre-existe, no introducido por mí — vale la pena arreglarlo en una ronda futura.



- **Ronda 18 — Sistema completo de artefactos (PRs #14–#27)**:
  - Sesión larga centrada en artefactos. MJ trabajaba con Excel de proveedores (MK, CHC, TEKA, LedStudio, ByP, LedConcept) y quería que la app reemplace ese workflow.
  - **Importador de Excel** (`src/lib/import/parseArtefactos.ts` + `/api/proyectos/[id]/importar-artefactos`): parsea hojas tipo "ARTEFACTOS SANITARIOS" (con headers de habitación), "ARTEFACTOS COCINA/TEKA", "ARTEFACTOS ILUMINACION". Ignora sheets MAESTRA y *_HG (V1 vieja). Crea BudgetVersion type=artefactos status=borrador. Probado con planilla Veronica Villarreal: 37 items parseados (13 baño principal, 18 baño secundario, 3 cocina, 3 iluminación).
  - **Editor rediseñado** (`src/components/presupuesto/ArtefactosEditor.tsx`): formato editorial BLARQ imitando el Excel de referencia. Jerarquía subcategoría → habitación → items. Columnas IMG | ITEM | DETALLE | MARCA | CANT | LISTA | DCTO | TOTAL. Toggle "Mostrar columnas internas" agrega NETO BLARQ + UTILIDAD (no van al PDF). Subtotales por habitación y subcategoría + total general.
  - **PDF cliente rediseñado** (`src/lib/pdf/ArtefactosPDF.html.ts`): mismo formato editorial. Banner negro por subcategoría, gris claro por habitación. Imagen del producto a ~32mm (medido contra el Excel original que tenía imágenes entre 20-30mm).
  - **Fix de convenciones**: `discountPercent` ahora es decimal (0..1) en BD (antes el editor lo trataba como 0-100, pisaba mal el clientPrice al guardar). `clientPrice` siempre unitario (antes se multiplicaba por qty al guardar — doble cuenta).
  - **Imágenes con auto-extracción** (`src/lib/catalog/fetchArtefactoData.ts` + `/api/.../artefactos/extract`):
    - Campo `ArtefactoItem.imageUrl` (migración aditiva aplicada en dev y prod).
    - Click en thumbnail abre popover. MJ pega link del producto → "Extraer" trae imagen + nombre + marca + precio lista.
    - **Scraper universal**: usa JSON-LD Product + meta tags OpenGraph + regex de price. Funciona con cualquier URL que exponga datos estándar. Probado: mk.cl, chc.cl, byp.cl, ledstudio.cl, ledconcept.cl, sodimac.cl, easy.cl. Fallback: campo manual "URL de imagen" para sitios sin scrape (Falabella, Ripley, etc.) o productos descontinuados.
  - **Catálogo BLARQ global** (tabla `ArtefactoCatalog` + página `/catalogo/artefactos` + entry en Sidebar):
    - Items reutilizables entre proyectos. Campos: name, detail, brand, subcategory, tag, supplier, referenceLink, imageUrl, listPrice, discountPercent, isStandard, lastPriceCheck.
    - Página con buscador full-text, filtros por subcategoría/paleta estándar, edición inline, creación con atajo "pegar link + extraer".
    - En el editor del presupuesto, el "+ agregar artefacto" abre un buscador del catálogo. Click en item → se copia al budget con el `catalogId` linkeado. Botón "Crear nuevo" sigue disponible.
    - Estrella ★ en cada fila del editor para promover items al catálogo.
  - **Sincronización entre copias del mismo catalogId**:
    - Cuando MJ edita un campo en una copia del item, se propaga a:
      1. Otras copias del mismo catalogId en el mismo budget (mismo WC en baño principal y secundario quedan iguales).
      2. El catálogo BLARQ global (próximos proyectos arrancan con dato actualizado).
    - Scope por campo:
      - name, detail, brand, listPrice, discountPercent, clientPrice, referenceLink, imageUrl → propaga a budget + catálogo.
      - **realCostBlarq** (cotización privada de su vendedora) → propaga solo dentro del budget. NO sube al catálogo porque varía proyecto a proyecto.
      - quantity, room, subcategory → no se sincronizan (específicos de cada copia).
  - **Bug de sync SII arreglado de paso** (PR #23, `src/app/api/sii/sync/route.ts`):
    - Síntoma reportado por MJ: facturas de Maxi Mobility apareciendo sin catalogar aunque ya había regla activa para el RUT.
    - Causa: `applyInvoiceRule` solo se llamaba en creación. Si una factura llegaba al sync ANTES de que existiera la regla y después el SII la enviaba de nuevo, el branch de "existing" actualizaba montos pero nunca aplicaba la regla. Quedaba huérfana para siempre.
    - Fix: cuando una factura existente vuelve a entrar al sync y tiene `categoryId` o `projectId` vacío, se llama `applyInvoiceRule`. Respeta lo manual.
    - Recovery histórico: corrí applyInvoiceRule sobre todas las facturas existentes con campo vacío + regla activa. 1 factura afectada (folio 281571 Maxi Mobility), ya corregida en prod.

Pendientes de esta sesión (próximas iteraciones de artefactos):
- **Botón "Revisar precios actuales" en bulk**: recorrer items del budget, abrir cada link, traer precio actual, mostrar tabla con diferencias para que MJ apruebe cambios en bulk. Soluciona "cotizar con precios viejos". (Sesión 3 del plan)
- **Templates de espacio**: guardar "Baño con tina 120 + ducha en obra" como receta reutilizable (lista de itemRefs del catálogo). Al armar un baño nuevo, elegir plantilla → trae todos los items pre-cargados. (Sesión 4)
- **Agente conversacional** (ambicioso, lejos): input tipo "baño principal con tina 120, mueble vanitorio 80, ducha en obra" → LLM genera el setup. Requiere catálogo + templates ya funcionando. (Sesión 5)
- **Romper vínculo con catálogo en un item específico**: hoy si MJ edita un item con catalogId, se propaga. Si quiere que un item específico se desvincule (cambio puntual no quiere afectar otros), no hay UI para hacerlo. Falta botón "desvincular del catálogo BLARQ" en el item.
- **Auto-extraer imagen en bulk para items importados del Excel**: hoy MJ tiene que abrir item por item y apretar Extraer. Si los links del Excel original están vigentes, podríamos hacerlo en bulk. MJ dijo "los links los actualizo yo".

Tareas operacionales para MJ después del deploy:
- Cargar 10-15 items "paleta estándar BLARQ" en el catálogo (los WCs / griferías / accesorios que usa siempre).
- Probar en Paseo del Sena Veronica V1: actualizar los links de productos descontinuados, ir extrayendo imagen por item, promover al catálogo con ★ los que sean estándar.

---

- **Ronda 17 — LaunchAgent de PDFs SII apuntaba a dev, no a prod (fix sin commit, solo cambio en plist local)**:
  - **Síntoma reportado por MJ**: en `/facturas` (Vercel) las flechas de descarga PDF salen grises (no verde con ✓) incluso en facturas de hace varios días. Al hacer click, abre el PDF resumen feo en vez del oficial.
  - **Causa raíz**: el LaunchAgent `com.blarq.sii-sync-pdfs` (en mac de MJ) corría `npm run sii:sync-pdfs` con el `.env` del repo, que apunta a **dev** (`ep-solitary-mud`). Cada hora el sync entraba al SII, buscaba pendientes en dev, no encontraba nada (dev casi vacía), decía "0 pendientes" y se iba. Mientras tanto, la app en Vercel (que lee prod `ep-shy-morning`) tenía 174 facturas recibidas con `pdfContent = null` desde el sync inicial del 2026-05-04.
  - **Fix aplicado en mac local** (no es un commit — es cambio en `~/Library/LaunchAgents/com.blarq.sii-sync-pdfs.plist`):
    - Agregado bloque `EnvironmentVariables` con `DATABASE_URL = <url prod>`. Eso pisa al `.env` solo para el LaunchAgent — el dev server sigue leyendo `.env` (dev) sin cambio.
    - Recargado con `launchctl unload` + `load`.
    - Disparado run manual: bajó **126 PDFs OK**, 48 son intercambios directos que no aparecen en MIPE (caen al resumen interno), 0 errores.
    - Conteo prod post-run: 599 facturas recibidas con PDF oficial (473 → 599, +126). Pendientes nunca intentadas: 0.
  - **Doc actualizada**: `docs/SETUP_SII_pdf-oficial.md` ahora explica que el LaunchAgent apunta a prod via `EnvironmentVariables`, y cómo regenerar la URL si se rota el password.
  - **Backup del plist anterior**: `~/Library/LaunchAgents/com.blarq.sii-sync-pdfs.plist.bak-20260514-220725` (por si hay que revertir).
  - **No hubo commit** — esta ronda es config local de la mac de MJ. El repo no cambió excepto por `docs/WIP.md` + `docs/SETUP_SII_pdf-oficial.md`.

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
