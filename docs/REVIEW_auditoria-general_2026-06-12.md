# Auditoría general — diagnóstico de solo lectura

- **Fecha**: 2026-06-15 (archivo nombrado `2026-06-12` por pedido de MJ).
- **Rama auditada**: `main` (commit `4599ec7`), que es lo que corre en producción.
- **Alcance**: solo lectura. No se tocó código, datos ni base. Las únicas escrituras de esta sesión son este reporte y la nota en `WIP.md`.
- **Método**: 6 revisores en paralelo (banco/conciliación, SII/facturas/NC, presupuesto/catálogo, EP/proyectos/métricas, barrido transversal de errores, UI/PDFs). Cada hallazgo grave fue re-verificado a mano contra el código y el `schema.prisma`.
- **Los fixes NO se hacen acá.** Este reporte es el insumo para sesiones de arreglo separadas, una por hallazgo, según el ranking.

---

## 1. Resumen ejecutivo (en simple)

La app está **bien donde más importa para la plata**: el cálculo central de cada proyecto (`metrics.ts`) está sólido, la conciliación bancaria es conservadora como pediste, el cierre de Estados de Pago es seguro, y los PDFs no inventan números. Los dos bugs viejos de conciliación que veníamos arrastrando **están realmente arreglados** en lo que corre hoy.

Pero apareció **un problema grande de seguridad**: las "puertas de servicio" de la app (las URLs internas que usa el navegador para guardar, borrar, conciliar, etc.) **no piden contraseña**. La pantalla de login protege lo que ves, pero no protege esas puertas traseras. Hoy eso es un riesgo latente (hay que conocer las URLs), pero cualquiera con acceso a la dirección de la app podría, en teoría, borrar facturas o mover plata sin estar logueado. Es lo primero a tapar.

Después hay un puñado de cosas contables de riesgo medio-alto que conviene arreglar de a una: marcar una factura como "anulada" a mano la deja **sumando al gasto igual** (porque el cálculo confía en que toda anulada tiene su nota de crédito); un Estado de Pago **cerrado todavía se puede modificar** por una puerta de servicio; y **algunas pantallas calculan los totales por su cuenta** en vez de usar la fuente única, así que muestran números distintos cuando hay notas de crédito. También detectamos que **los proyectos nuevos creados desde el formulario nacen sin número de cotización** — hay que confirmar si eso es a propósito o un olvido.

El resto son cosas menores (emojis que rompen la estética, validaciones flojas de formularios, código muerto). Nada de eso descuadra plata hoy.

---

## 2. Tabla de hallazgos

Severidad = qué tan grave si pasa. Probabilidad = qué tan fácil es que pase en uso real. "Rama pendiente" = si una rama ya commiteada (sin mergear) lo resuelve total o parcialmente.

| ID | Módulo | Problema (en simple) | Sev. | Prob. | Archivo(s):línea | ¿Resuelto en rama pendiente? |
|---|---|---|---|---|---|---|
| **H1** | Seguridad / toda la API | Las URLs internas (`/api/**`) no piden login. No hay `middleware.ts` ni control de sesión: 84 de 85 endpoints están abiertos. Permite borrar facturas, mover plata, disparar el sync SII, importar cartola, cerrar EPs sin estar logueado. | **CRÍTICA** | ALTA | sin `src/middleware.ts`; `src/lib/auth.ts:39` (no hay callback `authorized`); único `auth()` en `api/account/change-password/route.ts:14` | No |
| **H2** | Facturas / metrics | Marcar una factura recibida como "anulada" a mano (desde la ficha) la deja **sumando el gasto completo**. El cálculo no mira el estado "anulada"; confía en que exista la nota de crédito que la reste. El form deja anular sin crear NC. | **ALTA** | MEDIA | `metrics.ts:225,242-244`; `FacturaForm.tsx:293-305`; `api/facturas/[id]/route.ts:54` | No (es el riesgo del ADR 2026-05-30, ahora con vector real) |
| **H3** | EP | Un Estado de Pago **cerrado** todavía puede cambiar su estado/fecha/notas. El endpoint guarda los cambios de cabecera **antes** de chequear si está cerrado; el bloqueo llega tarde. | **ALTA** | MEDIA | `api/estados-pago/[id]/route.ts:29-48` | No |
| **H4** | Métricas duplicadas | Varias pantallas calculan totales **por su cuenta sin restar las notas de crédito**, en vez de usar `metrics.ts`. Dan números distintos a otras pantallas cuando hay NC: dashboard ("por pagar"/"por cobrar"), vista de centro de costo interno (BLARQ), y los totales de cabecera de la lista global de facturas. | **MEDIA** | MEDIA | dashboard `page.tsx:28-41`; `CentroCostoView.tsx:121,135,183,206`; `facturas/page.tsx:124-135` | No |
| **H5** | Proyectos / numeración | Los proyectos creados desde el formulario **nacen sin `numeroCotizacion`** (el POST nunca lo asigna). Contradice el ADR de numeración y el principio de "memoria espacial por número". Los números viejos existen porque se sembraron por script. **CONFIRMADO BUG por MJ (2026-06-15): esperaba que la app lo asignara sola.** | **MEDIA** | ALTA | `api/proyectos/route.ts:48-65` (create sin el campo); `schema.prisma:27` | No |
| **H6** | Facturas / NC | Si se limpia/cambia la compensación de una nota de crédito, la factura que quedó "anulada" **no vuelve atrás** — se queda anulada para siempre, y como la NC ya no la compensa, el gasto se descuadra. | **ALTA** | MEDIA | `api/facturas/[id]/compensar/route.ts:172-175`; `invoicePayments.ts:27-28` (early-return en anulada) | No |
| **H7** | Presupuesto / blindaje | Los endpoints que editan/borran/duplican/reordenan partidas y artefactos **no chequean** si la versión está enviada/aprobada ni el lineage congelado. El front esconde los botones, pero la puerta de servicio queda abierta (agravado por H1). Puede pisar un presupuesto firmado. | **ALTA** | MEDIA | `api/presupuestos/[id]/partidas/[itemId]/route.ts:38,119`; `.../partidas/route.ts:5,122`; `.../duplicate/route.ts:15`; `.../reorder/route.ts:14`; `.../artefactos/[itemId]/route.ts:4,144` | Parcial — `feat/presupuesto-detalle-raiz` hace el encabezado solo-lectura, pero NO agrega guardas a la API |
| **H8** | Catálogo / SSRF | Los endpoints que "extraen" datos de un link (`extract`, `fetch-price`) **fetchean cualquier URL** sin lista blanca, a diferencia de `img-proxy` que sí valida. Combinado con H1, el servidor puede ser inducido a pedir direcciones internas. | **ALTA** | MEDIA | `api/catalogo/artefactos/extract/route.ts:23`; `fetchArtefactoData.ts:196-208`; `fetchPrice.ts:87,110` | No |
| **H9** | EP | El sync de un EP (traer cambios del presupuesto) **no es transaccional**: hace muchos cambios sueltos. Si falla a la mitad, el EP queda a medias (algunas partidas sí, otras no, puntero de versión sin actualizar). El cierre de EP sí es transaccional — la inconsistencia es la señal. | **ALTA** | BAJA | `api/estados-pago/[id]/sync/route.ts:96-210` (vs `close/route.ts:35` que sí usa `$transaction`) | No |
| **H10** | Presupuesto / drift | En el catálogo, editar o borrar un componente del desglose **no recalcula** el encabezado de la partida (P.U. / costos). El molde queda descuadrado y se propaga a cotizaciones nuevas. | **MEDIA** | MEDIA | `api/catalogo/partidas/[id]/componentes/[compId]/route.ts:15,52`; `api/catalogo/partidas/[id]/route.ts:31` | No (la rama pendiente toca el editor de cotización, no el catálogo) |
| **H11** | Presupuesto / drift | Editar la mano de obra "inline" en una partida actualiza el componente base pero **no recalcula las leyes sociales** (el % sobre la MO) ni el encabezado desde el desglose. Descuadre encabezado↔desglose. | **MEDIA** | MEDIA | `api/presupuestos/[id]/partidas/[itemId]/route.ts:62-107` | Parcial — `feat/presupuesto-detalle-raiz` hace MO solo-lectura cuando hay desglose → lo evita |
| **H12** | Banco | El "Asignar pago fino" del modal y los splits **no topean contra el saldo de la factura** (solo contra el monto del movimiento). Puede dejar una factura imputada por más de su total. | MEDIA | MEDIA | `api/banco/movimientos/[id]/route.ts:64-112` | No (es decisión consciente de MJ; se reporta como confirmación del camino) |
| **H13** | Banco | Un monto inválido (`NaN`) en el cuerpo de la petición **evade las validaciones** (toda comparación con NaN da falso) y se guarda como imputación `NaN`, que envenena los cálculos de estado de la factura. Requiere petición a mano, pero la API está abierta (H1). | MEDIA | MEDIA | `api/banco/movimientos/[id]/route.ts:68-77` | No |
| **H14** | Banco | El "Asignar a factura" masivo suma por **valor absoluto**, mezclando abonos (ingresos) y cargos (egresos) si se seleccionan juntos. Imputar un ingreso como pago de una factura recibida es incoherente. | MEDIA | BAJA | `api/banco/movimientos/bulk/route.ts:236,269-277` | No |
| **H15** | Métricas / fondo sueldos | `fondoSueldos` usa **una sola versión de obra** (`bestVersion`) mientras `metrics` suma **todas las aprobadas** (`allApproved`, caso anexos). En proyectos con anexo aprobado, el fondo calcula sobre una sola y diverge. | MEDIA | BAJA | `fondoSueldos.ts:74,83` vs `metrics.ts:134-179` | No |
| **H16** | API / seguridad | Endpoints anidados (`/[id]/.../[hijo]`) **no verifican que el hijo pertenezca al padre** de la URL. Con ids cruzados se podría editar la partida o el ítem de otro presupuesto/proyecto (agravado por H1). | MEDIA | MEDIA | `api/presupuestos/[id]/partidas/[itemId]/route.ts`; `api/proyectos/[id]/lista-compra/[itemId]/route.ts` | No |
| **H17** | Telegram | El webhook valida el secret **solo si la variable de entorno existe** (`if (secret)`) en vez de exigirla siempre. **VERIFICADO (2026-06-15): el secret SÍ está seteado en Vercel Production → hoy NO es explotable** (la validación corre). Queda como fragilidad: si la variable se borra alguna vez, la puerta se abre sin aviso (la única barrera sería la lista de IDs, spoofeable desde el cuerpo). No mueve plata (solo asigna proyecto/categoría). | BAJA | BAJA | `api/telegram/webhook/route.ts:103-109,135` | No |
| **H18** | Lista de compra / PDF | El PDF de lista de compra **omite los materiales agregados a mano y los excedentes** que sí aparecen en pantalla. La lógica está copiada en dos lados y quedó desincronizada. | MEDIA | MEDIA | `api/proyectos/[id]/lista-compra/pdf/route.tsx:111-129` vs `lista-compra/page.tsx:145-163` | No |
| **H19** | EP | Se puede **borrar un EP "cerrado"** (el bloqueo solo cubre "pagado"). Borrar un EP cerrado intermedio descuadra los acumulados de los EPs siguientes. | MEDIA | BAJA | `api/estados-pago/[id]/route.ts:96-103` | No |
| **H20** | Presupuesto / concurrencia | El número de versión (V1/V2) puede **duplicarse** con dos creaciones casi simultáneas: se lee el máximo y se crea, sin transacción, y el schema **no tiene restricción única** sobre la versión. Relevante porque MJ trabaja con varias sesiones a la vez. | MEDIA | BAJA | `api/presupuestos/route.ts:17-27`; `schema.prisma` (BudgetVersion sin `@@unique`) | No |
| **H21** | SII | El sync envuelve en try/catch las tareas secundarias (reglas, tags), pero **no el alta/edición central de la factura**: un DTE con un dato inesperado **aborta todo el sync** de ese tipo. | MEDIA | MEDIA | `runSiiSync.ts:91-94` | No |
| **H22** | Facturas | El PUT de factura **fuerza IVA al 19%** sobre el neto. Si MJ edita una factura exenta (sin IVA) desde la ficha, le inventa 19% y cambia el total. | BAJA | MEDIA | `api/facturas/[id]/route.ts:31-33`; `api/facturas/route.ts:76-78` | No |
| **H23** | Catálogo | El cache de "lineage congelado" **nunca se limpia en runtime** (solo en tests). En el server local de MJ (proceso de larga vida), un sync posterior podría usar la lista vieja y pisar una partida ya blindada. En Vercel (procesos efímeros) el riesgo es menor. | MEDIA | BAJA | `frozenLineage.ts:20,55` (sin caller productivo de `clearFrozenLineageCache`) | No |
| **H24** | Transaccionalidad | Operaciones de plata multi-paso **sin transacción**, que quedan a medias si falla el paso 2+: compensar NC, payments DELETE, forma-pago (delete+recrea). | MEDIA | BAJA | `api/facturas/[id]/compensar/route.ts:123-180`; `api/presupuestos/[id]/forma-pago/route.ts:14-32` | No |
| **H25** | Errores silenciosos | `catch` que tragan el error sin avisar: carga de proyectos/reembolsadores en el modal de conciliación (queda lista vacía como si no hubiera datos); el parse del body del sync de EP cae a "aplicar TODO" si viene malformado. | BAJA | MEDIA | `MovementReconcileModal.tsx:178,189,271`; `api/estados-pago/[id]/sync/route.ts:33-38` | No |
| **H26** | Fondo sueldos | El total de artefactos del fondo suma `clientPrice` **sin multiplicar por cantidad** (metrics sí lo hace). Es solo informativo (no aporta al fondo), pero el número mostrado queda bajo si hay cantidad > 1. | BAJA | MEDIA | `fondoSueldos.ts:97-99` | No |
| **H27** | Estética BLARQ | **Emojis como íconos** en la UI, contra el principio "sin emojis, solo lucide-react": el menú lateral entero, y 💡/✨/🛒 en banco y lista de compra. | BAJA | ALTA | `Sidebar.tsx:8-17`; `MovementReconcileModal.tsx:619`; `MatchHintButton.tsx:51`; `banco/movimientos/page.tsx:256`; `ListaCompraClient.tsx:187` | No |
| **H28** | Formularios | Validaciones flojas de UI: `FacturaForm` no ofrece estado "parcial" (queda confuso al editar una factura parcial) y el monto neto no tiene mínimo (acepta negativo/vacío en el cliente). El form de proyecto no valida campos requeridos en cliente. | BAJA | BAJA | `FacturaForm.tsx:284-305` | No |
| **H29** | Presupuesto | `discountPercentage` de obra **se guarda y arrastra pero no se aplica** al total de obra (sí en muebles). Campo que aparenta tener efecto y no lo tiene. | BAJA | BAJA | `ObraEditor.tsx` / `ObraPDF.html.ts` (sin consumidores del campo) | No |
| **H30** | Limpieza / código muerto | `FacturaEmitidaPDF.html.ts` no lo usa nadie; `gastoMes` se calcula en el dashboard y no se muestra; el PDF de EP recibe `?variant=maestro` y lo ignora; `versionDiff` no contempla `lineageId` duplicado/nulo en el snapshot base. | BAJA | BAJA | varios (ver detalle por revisor) | No |

---

## 3. Ranking — los 5 a atacar primero

Ordenados por severidad × probabilidad × impacto-en-plata, con mi postura.

1. **H1 — La API sin login (CRÍTICA).** Es el techo de todo lo demás: varios hallazgos medios (H7, H8, H13, H16) son graves *porque* la API está abierta. Taparlo con un `middleware.ts` que exija sesión en `/api/**` es un cambio chico y acotado, y baja el riesgo de golpe. Va primero sí o sí. **Postura: arreglar ya, en su propia sesión, con cuidado de no romper el webhook de Telegram ni el img-proxy (que deben seguir públicos).**

2. **H2 — Anular a mano suma al gasto (ALTA × MEDIA).** Toca plata y se gatilla desde la pantalla normal (no requiere nada raro). El ADR 2026-05-30 ya dejó anotada la defensa: filtrar `status="anulada"` en el gastado de `metrics.ts`. Como toca el archivo contable, va con snapshot pre/post (§4.1). **Postura: arreglar pronto; es la deuda que el propio ADR predijo, ahora con un vector real (el form que anula sin crear NC).**

3. **H3 — EP cerrado todavía editable (ALTA × MEDIA).** Rompe la inmutabilidad que es la base de los Estados de Pago. El arreglo es chico (chequear cerrado *antes* de guardar) y de bajo riesgo. **Postura: arreglar pronto; es una inversión de dos líneas en el orden de las operaciones.**

4. **H4 — Pantallas que calculan por su cuenta y divergen (MEDIA × MEDIA, pero alta visibilidad).** Es exactamente lo que querías vigilar: `metrics.ts` como única fuente de verdad. Hoy el dashboard, la vista BLARQ y la lista global de facturas muestran totales que no restan notas de crédito, así que **pueden contradecir** a otras pantallas. Confunde sin descuadrar la contabilidad de fondo. **Postura: unificar para que esas pantallas usen el mismo criterio de signo de NC; medio, pero erosiona la confianza en los números si no se toca.**

5. **H5 — Proyectos nuevos sin número de cotización (MEDIA × ALTA).** Afecta a *todo* proyecto creado desde el formulario y toca un principio no negociable (la memoria espacial por número). **MJ confirmó (2026-06-15) que esperaba que la app lo asignara sola → es un bug, no una decisión.** El arreglo es chico: asignar `max(numeroCotizacion)+1` en el POST (con cuidado de concurrencia, mismo patrón que H20). **Postura: arreglar; es un olvido que afecta la identidad de cada lead nuevo.**

*Quedan en la antesala del top-5 y conviene mirarlos juntos con H1 porque la falta de auth los agrava: H6 (NC que no revierte), H7 (pisar presupuesto firmado por API) y H8 (SSRF).*

---

## 4. Lo que está BIEN (cubierto, sin problema)

- **`metrics.ts` (la fuente de verdad contable).** El signo de las NC, neto vs c/IVA, las divisiones por cero (todas con guarda `> 0`), el no-doble-conteo de EPs como gasto, y el manejo de anexos (`allApproved`) están bien. El único pero es que confía en la invariante "toda anulada tiene su NC" (H2) — pero eso es el riesgo ya documentado, no un error de cálculo.
- **Los dos bugs viejos de conciliación están arreglados de verdad.** El matching está centralizado (`decideMovementInvoiceMatch` / `tryAutoMatchMovementWithInvoices`), la validación de RUT corre siempre (incluso con un solo candidato), no quedan copias viejas inline, y el tope anti-sobre-imputación del bulk (`18ca6dd`) está en `main`.
- **La regla NC de 4 casos está en `main`** (no quedó la lógica vieja que anulaba pagadas), en sus dos lugares (`linkNcReferences.ts` y `compensar/route.ts`).
- **Cierre de EP**: transaccional, con snapshot inmutable de `amountPaid`, identidad por `lineageId`. Funciona como dice el ADR.
- **Dedup de import de cartolas**: la huella estable preserva las transferencias gemelas legítimas y no duplica al reimportar un período solapado. El parser aborta si la cartola no cuadra.
- **PDFs**: todos escapan el HTML (`esc()` + sanitizado del rich-text), reciben los totales ya calculados (no re-derivan, salvo el caso puntual H18 de lista de compra), y `renderPDF` cierra el browser en `finally` (sin leak).
- **Refresco de UI**: la gran mayoría de las acciones llaman `router.refresh()` y chequean `res.ok` antes de cantar éxito; los botones críticos tienen guarda anti-doble-click.
- **Auto-asignación de proyecto**: nunca se infiere sin regla explícita; las reglas solo completan campos vacíos (`IS NULL`), no pisan lo manual. Consistente con CLAUDE.md §4.5 y el principio de placeholders↔null.
- **`img-proxy`**: valida protocolo + lista blanca de hosts (no es vector de SSRF — el contraste que dejó ver el hueco de H8).
- **Borrado de proyecto**: solo permite borrar cotizaciones/archivados; bloquea ejecución/terminado.
- **Parseo de fechas de cartola**: dd/mm/yyyy reordenado explícito, sin ambigüedad de formato US.
- **Fetchers externos** (VTEX, Shopify, SII REST): chequean `res.ok` antes de parsear; los `JSON.parse` sobre HTML scrapeado están en try/catch.
- **EstadoPago tiene `@@unique([projectId, number])`**: una creación concurrente de EP falla ruidosa, no corrompe el correlativo (a diferencia de las versiones de presupuesto, H20).

---

## 5. Pendientes — lo que NO se alcanzó a revisar a fondo

- **Verificación en vivo**: toda la auditoría fue por lectura de código. No se corrió nada, no se levantó dev server, no se tocó la BD. Los hallazgos están confirmados leyendo el código, no reproducidos con datos reales.
- **H5 y H17 — RESUELTOS en esta sesión (2026-06-15)**: H5 confirmado bug por MJ (esperaba que la app asignara el número sola). H17 verificado contra Vercel (`vercel env ls production`, solo nombres): el secret está seteado en Production → no explotable hoy, baja a BAJA.
- **`ObraEditor.tsx` (2284 líneas)**: se revisaron los handlers de guardado/cálculo, no todos los estados locales optimistas. Puede haber más desincronización de estado de la apuntada en H11.
- **Muebles**: `MueblesEditor` y los endpoints de capítulos/cotizaciones se miraron por encima; no se auditó concurrencia de reordenamiento de muebles.
- **`onDelete` cascade del schema**: no se trazó el efecto completo de borrar un proyecto/EP sobre todas sus relaciones (importa para H19; el borrado de proyecto en sí está acotado a cotizaciones).
- **Lectura de factura por foto** (`readInvoicePhoto`, `matchProjectCategory`): leídas por referencia, no a fondo.
- **`siiBrowser.ts`, `cert.ts`, `timbre.ts`, `simpleFacturaClient.ts`**: mirada superficial (no eran el foco contable).
- **Scripts (`scripts/`)**: fuera de alcance (no corren en prod). Solo se confirmó que `backfill-correlativos.ts` es el que sembró los números viejos (contexto de H5).

---

*Reporte generado en sesión de auditoría de solo lectura. Próximo paso: sesiones de arreglo separadas, una por hallazgo, según el ranking de la sección 3. Los fixes que tocan `metrics.ts` (H2, H4) van con snapshot pre/post según CLAUDE.md §4.1.*
