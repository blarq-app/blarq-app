# ADR — Intake de facturas por foto: grupo de Telegram compartido

- **Fecha**: 2026-06-24
- **Estado**: aceptado
- **Autor**: MJ (decisión), evaluado con asistente

## Contexto

Hoy el centro de costo de una factura se captura mandándole una **foto al bot de
Telegram**: el bot lee proveedor/folio/total, matchea la obra escrita como
descripción y asigna (o deja una etiqueta en espera que el sync del SII aplica).
Todo el flujo vive en `src/app/api/telegram/webhook/route.ts`.

El problema: **cada persona usa su propio Telegram 1:1 con el bot**. MJ no ve lo
que carga JT y viceversa, y no hay forma de sumar a JP (arquitecto jr) al flujo.
MJ quiere algo **compartido**: ver lo que hace el otro y poder sumar a JP.

Hallazgos del código relevantes a la decisión:

- La autorización **ya es por persona**: el bot compara `msg.from.id` (el ID de
  Telegram de quien manda) contra la lista `TELEGRAM_ALLOWED_IDS`. No le importa
  desde qué chat llega — `route.ts:145`.
- **Ya se registra quién subió cada factura**: `requestedBy` (ID) y
  `requestedByName` (nombre) se guardan en `PendingProjectTag`
  (`prisma/schema.prisma:971`). Pero ese dato **no se muestra en ninguna
  pantalla de la app** — queda guardado e invisible.
- El bot responde **al chat de donde vino el mensaje** (`msg.chat.id`).

Conclusión: como la autorización es por persona y la atribución ya se guarda, un
**grupo de Telegram prácticamente ya funciona**. Lo que faltaba no era código de
negocio, sino configuración de Telegram + un ajuste para que el bot no spamee el
grupo.

## Decisión

**Opción A — un grupo de Telegram compartido (MJ + JT + JP) con el mismo bot.**

El bot responde dentro del grupo, así que los tres ven en vivo lo que carga cada
uno ("Listo. Easy, folio 123 → Portofino"). Gratis, sin cambiar de plataforma.

Para que funcione hacen falta tres cosas:

1. **Código (hecho):** en un grupo, el bot ignora en silencio los mensajes que
   claramente no son una interacción con él (sin foto y que no son comando
   `/...`). Si no, al apagar el modo privacidad respondería a cada mensaje de
   conversación y volvería el grupo inusable. En el chat 1:1 sigue respondiendo
   todo como antes. Ver `route.ts` (bloque `isGroup`).
2. **Config de Telegram (acción de MJ):** apagar el **modo privacidad** del bot
   en BotFather (`/setprivacy` → *Disable*) para que reciba las fotos del grupo.
3. **Variable de entorno (acción de MJ):** agregar el **ID de Telegram de JP** a
   `TELEGRAM_ALLOWED_IDS` en Vercel (JP le escribe al bot una vez; el bot le
   responde su ID).

La atribución "quién subió qué" ya queda guardada en `PendingProjectTag` y, en el
grupo, además se ve implícita porque la respuesta del bot va enganchada al
mensaje de cada persona.

## Alternativas descartadas

- **B — WhatsApp Business Cloud API (oficial).** Descartada (por ahora). La API
  oficial es **1:1 empresa↔persona, no soporta grupos**, así que **no da la
  visibilidad compartida** que es justo lo que MJ quiere; cada uno le escribiría
  por separado al bot. Además implica número de empresa, verificación de Meta,
  aprobación de plantillas y costo por conversación. Si algún día se decide
  abandonar Telegram, la visibilidad compartida tendría que resolverse igual
  dentro de la app (ver opción C). No se evaluó implementar; no se tocó. No se
  consideran librerías no oficiales de WhatsApp (violan los términos, riesgo de
  baneo).
- **C — Feed compartido dentro de la app.** No elegida ahora, pero **viable como
  fase 2**. Sería una pantalla read-only que liste todo lo subido por intake
  (quién / cuándo / proveedor / folio / monto / obra / categoría / estado), sin
  importar el canal. El dato **ya se guarda** (`PendingProjectTag` +
  `requestedByName`), falta solo mostrarlo. Resuelve "ver lo que hace el otro"
  del lado de la app y sirve con cualquier intake. Estética BLARQ: tabla densa,
  `tabular-nums`, gris neutro, estado por peso de texto (verde solo "aplicada",
  rojo solo "descartada"). Esfuerzo chico-medio.

## Consecuencias

- **Positivas**: chat compartido real entre MJ, JT y JP de forma inmediata;
  gratis; sin cambiar de plataforma; sin tocar cálculos contables ni lógica de
  asignación. Riesgo bajo (el endpoint solo escribe asignaciones de
  proyecto/categoría y etiquetas en espera).
- **Costos / contras**: el chat de Telegram es **efímero** — no hay un registro
  durable en la app de "quién imputó qué" (la atribución está en la base pero no
  se ve). El grupo expone el bot a más mensajes (mitigado por el ignore en
  grupos). Apagar el modo privacidad implica que el bot recibe todos los
  mensajes del grupo (no se loguean ni procesan los que no son foto/comando).
- **Deuda generada**: si se quiere registro durable y visible, queda pendiente
  la **opción C (feed en la app)** como fase aparte.

## Referencias

- Archivos del repo: `src/app/api/telegram/webhook/route.ts`,
  `src/lib/facturas/pendingTags.ts`, `prisma/schema.prisma` (modelo
  `PendingProjectTag`).
- Env vars (Vercel): `TELEGRAM_BOT_TOKEN`, `TELEGRAM_ALLOWED_IDS`,
  `TELEGRAM_WEBHOOK_SECRET`.
- Rama: `spike/intake-facturas-compartido`.
