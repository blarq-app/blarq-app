# ADR — Artefactos: una línea deja de seguir al catálogo solo cuando MJ fija el precio

- **Fecha**: 2026-09-25
- **Estado**: aceptado. Ajusta los puntos 2 y 3 del ADR [2026-06-18](2026-06-18-artefactos-precios-catalogo-a-cotizacion.md) (qué despega una línea y qué hace "Comparar con la tienda web").
- **Autor**: MJ (decisiones de negocio), implementado con Claude Code (pendiente 186).

## Contexto

Una línea de artefactos "despegada" (`ArtefactoItem.priceOverridden`) deja de recibir los cambios del catálogo. La marca existe para proteger un precio que MJ decidió, pero se prendía por cosas que no eran una decisión suya y **no había forma de apagarla**:

- **Aplicar desde "Comparar con la tienda web" despegaba**, a propósito (ADR 2026-06-18: "el precio pasa a venir de la tienda"). Medido en la viva el 2026-09-24, Casa Los Algarrobos V4: 30 líneas despegadas y solo 5 eran decisión de MJ (los Teka al 10%). 20 se despegaron aplicando la tienda y quedaron clavadas en el precio de ese día ($76.533 por encima del catálogo de hoy). 4 tenían el precio idéntico al catálogo (ruido puro) y 1 no tiene producto de catálogo.
- **"Comparar con mi catálogo" no reconectaba**: bajaba el precio esa vez, pero la línea seguía despegada para siempre.
- **Duplicar una versión perdía la marca del descuento de MJ** (`discountOverridden`): copiaba el porcentaje sin dueño. Pasó con los 6 Teka al 10% de Los Algarrobos V3→V4. El que no estaba además despegado (grifo lavadero) quedó sin ninguna protección. "Volver a lo enviado" tenía el mismo problema.
- **"Comparar con la tienda web" pre-marcaba las líneas con descuento de MJ**: aplicar de corrido le pisaba el porcentaje. Además, aplicar solo la FOTO (o solo la lista, en una tienda que no publica descuento) le borraba la marca sin que el porcentaje cambiara.

## Decisión

1. **Aplicar el precio de la tienda no despega la línea, y si estaba despegada la vuelve a conectar.** El precio que queda es el de la tienda, no uno que fijó MJ. El editor lo avisa en un campo propio, `precioDeLaTienda`, que solo viaja si se aplicó la lista. `descuentoDeLaTienda` solo viaja si se aplicó el porcentaje (antes viajaba siempre). Las copias del mismo producto en la cotización (mismo `catalogId` o mismo nombre) quedan en el mismo estado que la línea. Aplicar solo la foto no toca ninguna marca.
2. **"Comparar con mi catálogo" vuelve a conectar la línea al bajarle el precio**: `priceOverridden = false`, y `discountOverridden = false` si bajó el porcentaje del catálogo. Bajar solo el costo o la foto no toca las marcas. El modal lo dice en una nota.
3. **Tipear un precio a mano sigue despegando. Tipear un descuento lo marca como de MJ, sin despegar.** Sin cambios desde el 2026-08-02. El editor ahora muestra la marca apenas se guarda (antes se veía recién al recargar).
4. **En "Comparar con la tienda web", una línea con descuento de MJ viene sin marcar y con el aviso "Este descuento lo pusiste vos"** cuando la tienda publica el suyo, igual que las despegadas. Si la tienda no publica descuento, aplicar actualiza solo la lista y conserva el de MJ, así que se trata como cualquier otra línea.
5. **Duplicar una versión y "Volver a lo enviado" copian también `discountOverridden`.**
6. **Resguardo**: si una tienda con lectura directa de precios (VTEX: MK, LED Studio; Shopify: Kitchen House, etc.) no responde, la fila va a "No se pudieron leer" en vez de usar el número de la página. Salió al probar esto: MK cambió los links de todos sus productos, y el modal ofrecía (y "Traer de otra cotización" aplicaba sin preguntar) la oferta del día como si fuera la lista.

La propagación catálogo → cotizaciones (`propagateCatalogToBorradores`) **no se tocó**: sigue tocando solo borradores. Por eso reconectar una línea no puede mover un precio que el cliente ya vio.

## Alternativas descartadas

- **Botón "fijar precio".** Descartado por MJ: para amarrar un número pone el descuento a mano, y el catálogo respeta ese porcentaje mientras sigue actualizando la lista.
- **Aplicar la tienda sin despegar, pero sin reconectar** (la línea despegada seguía despegada). MJ eligió reconectar: si no, las 20 líneas clavadas solo se soltaban con "Comparar con mi catálogo".
- **Para el descuento de MJ en "Comparar con la tienda web": actualizar solo la lista y conservar su %** (lo que ya hace el catálogo). Era la opción recomendada. MJ eligió "sin marcar, con aviso": prefiere ver el descuento de la tienda y decidir fila por fila.
- **"Descuento mínimo" automático** (darle al cliente el mejor entre el de la tienda y el 10% de MJ, su regla con Teka en Kitchen House). Es una regla nueva y queda propuesta aparte. Por ahora el aviso del punto 4 le muestra cuándo la tienda tiene uno distinto.

## Consecuencias

- **Positivas**: "no sigue al catálogo" vuelve a significar "MJ fijó este precio". Hay dos caminos de vuelta (aplicar la tienda o el catálogo). Las marcas de MJ sobreviven a duplicar y a "Volver a lo enviado".
- **Costo**: un precio de la tienda aplicado en la cotización deja de estar protegido. Si después se edita ese producto en el catálogo (por cualquier campo), la línea toma el precio del catálogo, aunque sea más viejo. Para que no retroceda, conviene actualizar el catálogo ("Revisar precios" en /catálogo), que además baja solo a todos los borradores.
- **Datos existentes**: el cambio no corrige lo que ya estaba marcado. Corrección de una vez con `scripts/aplicar-186-reconectar.ts` (prueba por defecto; partes A/B/C; respaldo previo). A = despegadas con precio idéntico al catálogo (5 en borradores). B = marca de descuento perdida al duplicar (6, Los Algarrobos V4). C = de esas, lista idéntica al catálogo, así que siguen la lista con su % (5 Teka). Ninguna mueve un peso.
- **Deuda**: MK cambió sus links (`…/acc080034-pro-asis-stapa-cr-accesorios/p` → `…/acc080034-accesorios-klipen-asis/p`), la API ya no encuentra los productos por el link viejo y todo MK queda "sin poder leer" hasta que la app siga la redirección. Es un arreglo aparte.

## Referencias

- Regresión: `scripts/test-186-despegue.ts` (35 casos, contra la app y una base local o de desarrollo).
- Medición: `scripts/diag-186-despegados.ts` · foto de control antes/después del deploy: `scripts/snapshot-186-artefactos.ts`.
- Archivos: `src/app/api/presupuestos/[id]/artefactos/[itemId]/route.ts`, `…/actualizar-catalogo/route.ts`, `…/revisar-precios/route.ts`, `src/app/api/presupuestos/route.ts`, `src/lib/catalog/budgetSnapshot.ts`, `src/lib/catalog/revisarArtefactos.ts`, `src/components/presupuesto/ArtefactosEditor.tsx`, `RevisarPreciosArtefactos.tsx`, `ActualizarDesdeCatalogo.tsx`.
