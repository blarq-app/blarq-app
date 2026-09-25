# ADR — Artefactos: una línea deja de seguir al catálogo solo cuando MJ fija el precio

- **Fecha**: 2026-09-25
- **Estado**: aceptado. Ajusta los puntos 2 y 3 del ADR [2026-06-18](2026-06-18-artefactos-precios-catalogo-a-cotizacion.md): qué despega una línea y cuándo baja el precio del catálogo.
- **Autor**: MJ (decisiones de negocio), implementado con Claude Code (pendiente 186).

## Contexto

Una línea de artefactos "despegada" (`ArtefactoItem.priceOverridden`) deja de recibir los cambios del catálogo. La marca existe para proteger un precio que MJ decidió, pero se prendía por cosas que no eran una decisión suya. En Casa Los Algarrobos V4 había 30 líneas despegadas y solo 5 eran decisión de MJ (los Teka al 10%). 20 se despegaron al aplicar el precio de la tienda desde "Comparar con la tienda web".

**La premisa inicial estaba al revés.** El pedido original daba por sentado que el catálogo era la verdad y que la cotización tenía "$76.533 de más". Verificado contra la API de MK el 2026-09-25 (siguiendo el link nuevo de cada producto): la cotización tiene las listas de MK de hoy, y **el catálogo de artefactos está atrasado respecto de la tienda**. Está más bajo en los 6 productos revisados; en la grifería lavamanos Urban-N antique bronze, $38.000 abajo. MJ: *"yo no comparo con el catálogo, en general cuando estoy en una cotización pongo actualizar según la página web, eso es más real que ir al catálogo."*

Además:

- **El catálogo bajaba su precio a las cotizaciones en CADA guardado del producto**, aunque solo se arreglara la foto, el link o el costo.
- **Duplicar una versión perdía la marca del descuento de MJ** (`discountOverridden`). Pasó con los 6 Teka al 10% de Los Algarrobos V3→V4: el grifo lavadero quedó sin ninguna protección. "Volver a lo enviado" tenía el mismo problema.
- **"Comparar con la tienda web" pre-marcaba las líneas con descuento de MJ**, y aplicar de corrido se lo pisaba. Aplicar solo la FOTO le borraba la marca, aunque el porcentaje no cambiara.

## Decisión

1. **Aplicar el precio de la tienda no despega la línea, y si estaba despegada la vuelve a conectar** (elección de MJ): el precio que queda es el de la tienda, no uno que fijó MJ. El editor lo avisa en un campo propio, `precioDeLaTienda`, que solo viaja si se aplicó la lista. `descuentoDeLaTienda` solo viaja si se aplicó el porcentaje. Las copias del mismo producto en la cotización (mismo `catalogId` o mismo nombre) quedan en el mismo estado. Aplicar solo la foto no toca ninguna marca.
2. **El PRECIO del catálogo baja a las cotizaciones solo cuando cambia el precio del catálogo** (`propagateCatalogToBorradores(…, { conPrecio })`, decidido desde el PUT del catálogo comparando con el precio anterior). Los datos del producto (nombre, detalle, marca, link, foto) bajan siempre. Sigue tocando solo borradores y líneas conectadas. Sin esto, el punto 1 dejaría las líneas actualizadas desde la tienda expuestas a que cualquier guardado del producto en el catálogo les baje un precio viejo y más barato.
3. **"Comparar con mi catálogo" no cambia: no toca ninguna marca.** Se evaluó que reconectara la línea y se descartó (ver alternativas).
4. **Tipear un precio a mano sigue despegando. Tipear un descuento lo marca como de MJ, sin despegar** (sin cambios desde 2026-08-02). El editor ahora muestra la marca apenas se guarda.
5. **En "Comparar con la tienda web", una línea con descuento de MJ viene sin marcar y con el aviso "Este descuento lo pusiste vos"** cuando la tienda publica el suyo (elección de MJ).
6. **Duplicar una versión y "Volver a lo enviado" copian también `discountOverridden`.**
7. **Resguardo**: si una tienda con lectura directa de precios (VTEX o Shopify) no responde, la fila va a "No se pudieron leer", en vez de usar el número de la página. MK cambió los links de todos sus productos; la app ofrecía, y "Traer de otra cotización" aplicaba sin preguntar, la oferta del día como si fuera la lista.

## Alternativas descartadas

- **"Comparar con mi catálogo" reconecta la línea.** Venía en el pedido original. Se descartó: con el catálogo atrasado, conectar líneas a él las expone a precios más baratos que la realidad, y MJ casi no usa ese botón.
- **Limpiar la marca de las despegadas con el precio idéntico al catálogo.** Se descartó por lo mismo. Las 25 despegadas de Los Algarrobos se quedan como están: sus precios son los de la tienda.
- **El punto 1 sin el resguardo del punto 2.** La primera versión del cambio lo hacía así. Arreglar la foto o el link de un producto en el catálogo (algo que va a pasar pronto por el cambio de links de MK) le habría bajado sola la grifería antique bronze de $147.990 a $109.990 a una cotización.
- **Que aplicar la tienda siga despegando** (sin punto 1). Protege el precio, pero esas líneas vendrían siempre sin marcar y con "no sigue al catálogo", y habría que marcarlas a mano cada vez que MJ actualiza desde la web.
- **Descuento de MJ en la tienda web: actualizar solo la lista y conservar su %.** Era la opción recomendada; MJ prefirió ver el descuento de la tienda y decidir fila por fila.
- **Botón "fijar precio"**: descartado por MJ. **"Descuento mínimo" automático** (el mejor entre el de la tienda y el 10% de MJ): propuesto aparte.

## Consecuencias

- **Positivas**: "no sigue al catálogo" vuelve a significar "MJ fijó este precio". Lo que MJ actualiza desde la web viene marcado la próxima vez. Un catálogo atrasado ya no puede pisar precios de la tienda por un guardado cualquiera. Las marcas del descuento sobreviven a duplicar y a "Volver a lo enviado".
- **Costo**: una línea conectada ya no se "re-sincroniza" con el catálogo cuando se guarda el producto sin cambiarle el precio.
- **Datos**: única corrección, con OK de MJ: `scripts/aplicar-186-marca-descuento-perdida.ts` devuelve la marca a los 6 Teka de Los Algarrobos V4. Solo marca, $0, con respaldo.
- **Deuda**: el catálogo atrasado es un dato de MJ, no se tocó. MK cambió sus links (`…/acc080034-pro-asis-stapa-cr-accesorios/p` → `…/acc080034-accesorios-klipen-asis/p`); siguiendo la redirección, la API vuelve a responder. Es un arreglo aparte.

## Referencias

- Regresión: `scripts/test-186-despegue.ts` (37 casos, contra la app y una base local o de desarrollo).
- Medición: `scripts/diag-186-despegados.ts` · foto de control antes/después del deploy: `scripts/snapshot-186-artefactos.ts`.
- Archivos: `src/app/api/presupuestos/[id]/artefactos/[itemId]/route.ts`, `…/revisar-precios/route.ts`, `src/app/api/catalogo/artefactos/[id]/route.ts`, `src/lib/catalog/syncArtefactos.ts`, `src/app/api/presupuestos/route.ts`, `src/lib/catalog/budgetSnapshot.ts`, `src/lib/catalog/revisarArtefactos.ts`, `src/components/presupuesto/ArtefactosEditor.tsx`, `RevisarPreciosArtefactos.tsx`.
