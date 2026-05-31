# Bot de Telegram — asignar centro de costo desde una foto

Estado: **implementado, sin desplegar aún** (falta API key de Claude + activar webhook en Vercel). Última actualización: 2026-05-31.

## Qué resuelve

Cuando MJ/JT compran en Sodimac/Easy/etc. con factura (RUT BLARQ), la factura
llega sola a la app por el sync del SII — pero **sin centro de costo** (la obra),
porque esos proveedores son transversales y la app no puede adivinar a qué obra
va cada compra. Hoy eso se asigna a mano.

Este bot reemplaza ese trabajo manual: en el momento de la compra, sacás la foto
de la factura y escribís el nombre de la obra. El bot lee el proveedor y el folio
de la foto, y le pega la obra a esa factura — al toque si ya llegó del SII, o
"en espera" si todavía no, aplicándola sola cuando aparezca.

**Alcance**: solo facturas electrónicas (las que llegan por el SII). Las boletas
de reembolso a maestros quedan fuera por ahora (no entran por el SII; el bot no
crea gastos, solo etiqueta facturas que ya van a llegar).

## Cómo se usa (MJ/JT)

1. En Telegram, abrir el chat del bot.
2. Mandar la **foto de la factura** y, como descripción de la foto (caption),
   escribir el **nombre de la obra** (y opcional la categoría).
   Ej: foto + `Portofino materiales`.
3. El bot responde:
   - "Listo. SODIMAC, folio 1234, $45.000 → Portofino, Materiales." (ya estaba)
   - "Anotado... se la asigno sola cuando aparezca." (quedó en espera)
   - O pide aclaración si no reconoció la obra o no leyó el RUT.

Comandos: `/start` o `/ayuda` muestran las instrucciones.

## Arquitectura

```
Telegram -> POST /api/telegram/webhook
              |
              |- valida secret (header) + allowlist (TELEGRAM_ALLOWED_IDS)
              |- baja la foto (lib/telegram/api.ts)
              |- lee RUT+folio+total con Claude vision (lib/telegram/readInvoicePhoto.ts)
              |- matchea obra/categoria del texto (lib/telegram/matchProjectCategory.ts)
              \- lib/facturas/pendingTags.ts:
                   |- factura YA existe -> applyTagToInvoice (asigna sin pisar lo manual)
                   \- no existe -> createPendingTag (status "esperando")

Sync SII (runSiiSync.ts) al crear/actualizar cada factura recibida:
   \- applyPendingTagsForInvoice -> busca tag "esperando" del mismo RUT,
      compara folio laxo (ignora ceros a la izq), asigna, marca "aplicada".
```

Modelo nuevo: `PendingProjectTag` (prisma/schema.prisma). Identifica la factura
objetivo por `(rutIssuer, folioNumber)`. Guarda total/fecha leídos como respaldo.

### Decisiones de diseño

- **No es una `InvoiceCategorizationRule`**: esa es por proveedor (RUT -> siempre
  esta obra). Acá los proveedores son transversales; la etiqueta es de **un solo
  uso**, para una factura específica.
- **Conservador**: si no se lee el RUT, o la obra del texto es ambigua/no calza,
  el bot NO adivina — pide reenviar. Asignar a la obra equivocada es peor.
- **No pisa lo manual**: `applyTagToInvoice` solo completa campos vacíos.
- **La obra viene del texto, no de la foto**: la letra manuscrita en el papel es
  menos confiable que lo tipeado.
- **Sin guardar la foto**: se lee y se descarta. No hay almacenamiento de imágenes.

## Para desplegar (pendiente)

1. **API key de Claude**: ✓ HECHO en `.env` local (cuenta Individual, USD 5
   cargados, recarga automática OFF). Verificada con el lector real (factura
   SODIMAC de prueba leída OK, confianza 0.98). FALTA: copiar
   `ANTHROPIC_API_KEY` a la env var de Vercel (Production). Costo: ~centavos por
   foto (modelo Haiku).
2. **Descubrir los IDs de Telegram de MJ y JT**: con el bot desplegado, cada uno
   le manda `/start`; el bot responde con su ID numérico. Esos IDs van en
   `TELEGRAM_ALLOWED_IDS` (coma-separados), local y en Vercel.
3. **Env vars en Vercel** (Production): `TELEGRAM_BOT_TOKEN`,
   `TELEGRAM_WEBHOOK_SECRET`, `TELEGRAM_ALLOWED_IDS`, `ANTHROPIC_API_KEY`.
4. **Push del modelo a prod**: `PendingProjectTag` está en dev. Confirmar con MJ
   y correr `npx prisma db push` apuntando a prod (Neon `ep-shy-morning`).
5. **Registrar el webhook** (una vez, tras el deploy):
   `npx tsx scripts/telegram-set-webhook.ts https://blarq-app.vercel.app`
   (toma el secret de `TELEGRAM_WEBHOOK_SECRET` si está). Telegram empieza a
   mandar los mensajes a `/api/telegram/webhook`.

Nota: el webhook **debe** correr en Vercel (Telegram necesita una URL pública).
No se puede probar el ciclo completo en local sin un túnel.

## Riesgo

Bajo. El endpoint solo escribe asignaciones de proyecto/categoría en facturas y
filas en `PendingProjectTag`. No toca `metrics.ts`, no mueve plata, no borra.
El token del bot y el secret del webhook son credenciales — viven en `.env`
(gitignored) y en Vercel, nunca en el repo.
