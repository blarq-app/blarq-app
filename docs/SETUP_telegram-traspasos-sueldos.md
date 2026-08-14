# Bot de Telegram — etiquetar los traspasos a Sueldos desde el comprobante

Estado: **implementado, falta activarlo** (crear el chat dedicado + poner la
variable en Vercel + crear la tabla en la base viva). Última actualización:
2026-08-13.

## Qué resuelve

MJ se transfiere plata de la cuenta Operativa a la cuenta Sueldos ("me paso a
Sueldos"), separando lo que corresponde a **obra** de lo que corresponde a
**muebles**. Esas transferencias entran a la app cuando importa la cartola, y
quedaban **sin obra y sin concepto** hasta que se acordaba de etiquetarlas a
mano en /banco/movimientos.

Con esto, en el momento de hacer la transferencia MJ le manda al bot el
**pantallazo del comprobante** y escribe la obra y el concepto (`Sena obra`). El
bot lee la fecha y el monto del comprobante y etiqueta ese traspaso: al toque si
ya está en la app, o **anotado en espera** si todavía no importó la cartola, en
cuyo caso se aplica solo cuando el traspaso entra.

**Esto no mueve plata.** Solo le pone obra y concepto a un movimiento que ya
existe (o que va a existir). No crea movimientos, no borra, no toca `metrics.ts`.

## Cómo se usa (MJ)

1. Hacer la transferencia de Operativa a Sueldos.
2. Sacarle pantallazo al comprobante.
3. Mandarlo al **chat de traspasos** con la obra y el concepto como descripción:
   - `Sena obra`
   - `Paseo del Sena muebles`
4. El bot responde:
   - "Listo. Traspaso del 13/08 por $2.500.000 → **Paseo del Sena**, obra."
     (el traspaso ya estaba en la app y quedó etiquetado)
   - "Anotado… se la etiqueto sola cuando importes la cartola." (quedó en espera)
   - Si no dijo el concepto, pregunta con dos botones: **Obra** / **Muebles**.
   - Si no reconoce la obra, lista las obras y pide que reenvíe.

Comandos: `/ayuda` muestra las instrucciones. `/chatid` responde el id del chat
(sirve para la configuración, ver abajo).

### Un traspaso es de obra **o** de muebles

Un movimiento bancario no se puede partir por la mitad. Si MJ escribe "obra y
muebles", el bot lo dice y sugiere hacer **dos transferencias separadas**, una
por concepto. Es la única forma de que el "me paso a Sueldos" de cada obra
cuadre por concepto.

## Los dos chats del mismo bot

Es el **mismo bot** (mismo token, mismo webhook) atendiendo dos conversaciones
que no se mezclan. El ruteo es por `chat.id`:

| Chat | Qué se manda | Env var |
|---|---|---|
| El de siempre | Foto de la **factura** + la obra | (ninguna) |
| El nuevo, dedicado | Pantallazo del **comprobante** + obra y concepto | `TELEGRAM_SUELDOS_CHAT_ID` |

El ruteo es por chat y no por lo que se vea en la foto: es una decisión dura y
sin ambigüedad. La lectura de la imagen se usa solo como **red de seguridad** —
si por el chat de traspasos entra una factura, el bot avisa ("se ve como factura
electrónica de Sodimac") y **no guarda nada**, en vez de tratar de adivinar.

Si `TELEGRAM_SUELDOS_CHAT_ID` no está seteada, no hay chat de traspasos y todo
sigue yendo al flujo de facturas como hasta ahora.

## Arquitectura

```
Telegram -> POST /api/telegram/webhook
              |- valida secret (header) + allowlist (TELEGRAM_ALLOWED_IDS)
              |- ¿chat.id == TELEGRAM_SUELDOS_CHAT_ID?
              |     no -> flujo de FACTURAS (el de siempre, sin cambios)
              |     si -> flujo de TRASPASOS:
              |            |- baja el pantallazo (lib/telegram/api.ts)
              |            |- lee fecha+monto (lib/telegram/readTransferPhoto.ts)
              |            |   y confirma que ES un comprobante
              |            |- separa obra y concepto del texto
              |            |   (lib/telegram/parseTraspasoTexto.ts)
              |            |- matchea la obra (lib/telegram/matchProjectCategory.ts)
              |            \- lib/banco/pendingTransferTags.ts:
              |                 |- 1 traspaso calza -> lo etiqueta (sin pisar lo manual)
              |                 |- 0 calzan        -> queda "esperando"
              |                 \- 2+ calzan       -> NO elige: pregunta con botones

Import de cartola (/api/banco/import), al detectar cada traspaso interno:
   \- applyPendingTransferTagsForMovement -> busca la etiqueta "esperando" de
      esa fecha y monto, etiqueta los dos lados del par, la marca "aplicada".
```

Modelo nuevo: `PendingTransferTag` (prisma/schema.prisma).

### Decisiones de diseño

- **Modelo aparte de `PendingProjectTag`**: aquel identifica su destino por
  `(rutIssuer, folioNumber)`, los dos obligatorios. Una transferencia entre dos
  cuentas propias no tiene RUT emisor ni folio; meterle valores falsos para
  reusar el modelo ensuciaría el flujo de facturas.
- **La identidad del traspaso es fecha + monto.** Es lo único duro que trae el
  papel. Medido en la base viva sobre los 38 traspasos históricos a Sueldos:
  **nunca** hubo dos del mismo monto el mismo día, ni con ventana de ±1 día
  (`scripts/diag-traspasos-sueldos-match.ts`). Aun así, si aparece más de un
  candidato el bot **no elige** — pregunta con botones.
- **Se etiquetan los dos lados del par.** Una transferencia son dos movimientos
  linkeados (sale de Operativa, entra a Sueldos). La regla vive en
  `lib/banco/internalTransferTags.ts`, compartida con el botón de la app — antes
  estaba duplicada dentro del PATCH de movimientos.
- **No pisa lo puesto a mano.** Si el traspaso ya tenía obra o concepto, el bot
  lo deja como está y avisa. Mismo criterio que las facturas.
- **El concepto nunca se adivina.** Si MJ no lo dice, la etiqueta queda
  "por_confirmar" y el bot manda los dos botones. Una etiqueta sin concepto no
  se aplica sola.
- **Sin guardar la imagen**: se lee y se descarta.

## Para activarlo

1. **Crear el chat dedicado** en Telegram (un grupo nuevo con el bot adentro, o
   un canal — lo importante es que sea distinto del de facturas).
2. **Sacar el id del chat**: escribirle `/chatid` en ese chat. El bot responde
   el número (los grupos dan un id negativo, ej `-1001234567890`).
3. **Env var en Vercel** (Production): `TELEGRAM_SUELDOS_CHAT_ID` = ese número.
   Redeploy para que tome la variable.
4. **Crear la tabla en la base viva** (confirmar con MJ antes, §4.7 del
   CLAUDE.md):
   ```
   psql "$DATABASE_URL" -f scripts/migrate-pending-transfer-tag.sql
   ```
   Es puramente aditivo: crea una tabla nueva, no toca ninguna existente. Está
   escrito a mano y no con `prisma migrate diff` a propósito (el diff completo
   arrastra DROPs de columnas de otras ramas sin mergear).

No hace falta re-registrar el webhook: es el mismo bot, la misma URL.

## Cómo se probó

Sin desplegar, contra la base de desarrollo:

| Script | Qué prueba |
|---|---|
| `scripts/test-webhook-traspaso.ts` | La conversación completa de punta a punta: mete updates por el webhook real, con la lectura de la imagen de verdad, e imprime lo que el bot responde. Telegram está interceptado (no se manda nada). |
| `scripts/test-pending-transfer-tags.ts` | Los 6 comportamientos del motor: etiqueta al toque, queda esperando, el import la aplica, los dos lados del par, no pisar lo manual, no elegir si hay dos candidatos. |
| `scripts/test-parse-traspaso-texto.ts` | Que "Sena obra" resuelva a la obra correcta contra los nombres reales (solo lectura). |
| `scripts/test-read-transfer-photo.ts` | Que el lector saque fecha y monto de un comprobante, y que rechace una factura. |

## Riesgo

Bajo. El endpoint solo escribe obra/concepto en movimientos que ya existen y
filas en `PendingTransferTag`. No mueve plata, no crea ni borra movimientos, no
toca `metrics.ts`. El webhook sigue validando el secret y la allowlist igual que
antes.
