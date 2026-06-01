// Webhook del bot de Telegram para capturar el centro de costo de una
// factura desde una foto.
//
// Flujo de un mensaje:
//   1. Validar que venga de Telegram (secret token) y de un usuario
//      autorizado (allowlist MJ + JT).
//   2. Si trae foto + texto: leer la foto (RUT, folio, total), matchear el
//      texto contra obra/categoría, y:
//        - si la factura YA existe en la app → asignar al toque.
//        - si no → dejar una etiqueta "en espera" que el sync aplicará.
//   3. Si trae foto SIN texto: usar la obra escrita A MANO en la foto, pero
//      NO asignar a ciegas — mandar botones Sí/No para confirmar (la lectura
//      de manuscrito es menos confiable).
//   4. Responder confirmando o pidiendo aclaración.
//
// Diseño conservador: si no podemos identificar el proveedor (RUT) o la
// obra con claridad, NO inventamos — le pedimos a MJ/JT que reenvíen o
// confirmen. Asignar a la obra equivocada es peor que volver a pedir.
//
// Este endpoint solo ESCRIBE asignaciones de proyecto/categoría (y filas en
// PendingProjectTag). No toca cálculos contables, no borra nada, no mueve
// plata. Bajo riesgo.

import { NextRequest, NextResponse } from "next/server";
import {
  sendMessage,
  sendMessageWithButtons,
  answerCallbackQuery,
  downloadFileAsBase64,
} from "@/lib/telegram/api";
import { readInvoicePhoto } from "@/lib/telegram/readInvoicePhoto";
import {
  matchProject,
  matchCategory,
  type NamedMatch,
} from "@/lib/telegram/matchProjectCategory";
import {
  findInvoiceByRutFolio,
  applyTagToInvoice,
  createPendingTag,
  createPendingTagToConfirm,
  resolvePendingTagConfirmation,
} from "@/lib/facturas/pendingTags";

// ---- Tipos mínimos del update de Telegram (solo lo que usamos) ----
interface TgPhotoSize {
  file_id: string;
  file_size?: number;
  width: number;
  height: number;
}
interface TgUser {
  id: number;
  first_name?: string;
  username?: string;
}
interface TgMessage {
  message_id: number;
  from?: TgUser;
  chat: { id: number };
  text?: string;
  caption?: string;
  photo?: TgPhotoSize[];
}
interface TgCallbackQuery {
  id: string;
  from: TgUser;
  message?: { chat: { id: number } };
  data?: string;
}
interface TgUpdate {
  message?: TgMessage;
  callback_query?: TgCallbackQuery;
}

/** Lista de IDs de Telegram autorizados (MJ, JT). Coma-separados en env. */
function allowedIds(): Set<string> {
  const raw = process.env.TELEGRAM_ALLOWED_IDS ?? "";
  return new Set(
    raw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
  );
}

function formatMonto(n: number | null): string {
  if (n == null) return "—";
  return "$" + n.toLocaleString("es-CL");
}

/** Lista candidatos para un mensaje de aclaración (máx 8 para no saturar). */
function listarOpciones(cands: NamedMatch[]): string {
  return cands
    .slice(0, 8)
    .map((c) => `• ${c.name}`)
    .join("\n");
}

export async function POST(request: NextRequest) {
  // 1. Validar que el request venga de Telegram. Telegram manda el secret
  //    que registramos con setWebhook en este header.
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (secret) {
    const got = request.headers.get("x-telegram-bot-api-secret-token");
    if (got !== secret) {
      return NextResponse.json({ ok: false }, { status: 401 });
    }
  }

  let update: TgUpdate;
  try {
    update = (await request.json()) as TgUpdate;
  } catch {
    return NextResponse.json({ ok: true }); // ignoramos basura
  }

  // Toque de botón (confirmación de obra manuscrita).
  if (update.callback_query) {
    await handleCallback(update.callback_query);
    return NextResponse.json({ ok: true });
  }

  const msg = update.message;
  // Siempre respondemos 200 a Telegram (si no, reintenta el mismo update en
  // loop). Los problemas se comunican por mensaje de chat, no por HTTP.
  if (!msg || !msg.from) return NextResponse.json({ ok: true });

  const chatId = msg.chat.id;
  const fromId = String(msg.from.id);
  const fromName = msg.from.first_name ?? msg.from.username ?? "—";

  // 2. Allowlist. Si el usuario no está autorizado, le decimos su ID para
  //    que MJ lo pueda agregar (es como se descubre el ID la primera vez).
  if (!allowedIds().has(fromId)) {
    await sendMessage(
      chatId,
      `No estás autorizado para usar este bot.\nTu ID de Telegram es: \`${fromId}\`\nPasáselo a MJ para que te habilite.`
    );
    return NextResponse.json({ ok: true });
  }

  // Comando de ayuda / start.
  const texto = (msg.text ?? msg.caption ?? "").trim();
  if (texto === "/start" || texto === "/ayuda" || texto === "/help") {
    await sendMessage(
      chatId,
      "Mandame la *foto de la factura* y escribí el *nombre de la obra* como descripción de la foto.\n\nEjemplo: foto + `Portofino materiales`.\n\nSi anotaste la obra *a mano* sobre el papel, podés mandar la foto sin escribir nada: la leo del papel y te pido que confirmes.\n\nLeo el proveedor y el folio de la foto, y le asigno la obra a esa factura cuando llegue del SII."
    );
    return NextResponse.json({ ok: true });
  }

  // 3. Necesitamos foto.
  if (!msg.photo || msg.photo.length === 0) {
    await sendMessage(
      chatId,
      "Necesito la *foto* de la factura. Mandá la imagen con el nombre de la obra como descripción (o anotada a mano sobre el papel)."
    );
    return NextResponse.json({ ok: true });
  }

  try {
    // Telegram manda varios tamaños; el último es el de mayor resolución.
    const best = msg.photo[msg.photo.length - 1];
    const { base64, mediaType } = await downloadFileAsBase64(best.file_id);

    // Leer la factura (incluye texto manuscrito si lo hay).
    const datos = await readInvoicePhoto(base64, mediaType);

    if (!datos.rutIssuer) {
      await sendMessage(
        chatId,
        "No pude leer el *RUT del proveedor* en la foto. Probá con una foto más nítida o más de cerca al recuadro rojo."
      );
      return NextResponse.json({ ok: true });
    }

    const provLabel = datos.businessName ?? datos.rutIssuer;
    const folioLabel = datos.folioNumber
      ? `folio ${datos.folioNumber}`
      : "folio ?";

    // ¿De dónde sale la obra?
    //   (a) texto tipeado en el mensaje → confiable, se usa directo.
    //   (b) no hay texto, pero hay manuscrito en la foto → menos confiable,
    //       se pide confirmación por botones.
    //   (c) ni texto ni manuscrito → pedir que escriban la obra.
    if (texto) {
      // Camino (a): obra del texto tipeado. Comportamiento de siempre.
      await asignarDesdeTexto(chatId, texto, datos, fromId, fromName);
      return NextResponse.json({ ok: true });
    }

    if (datos.handwrittenNote) {
      // Camino (b): obra leída a mano → confirmar antes de aplicar.
      const proj = await matchProject(datos.handwrittenNote);
      if (proj.kind === "exacto" && proj.match) {
        const cat = await matchCategory(datos.handwrittenNote);
        const category = cat.kind === "exacto" ? cat.match ?? null : null;
        const tagId = await createPendingTagToConfirm({
          rutIssuer: datos.rutIssuer,
          folioNumber: datos.folioNumber,
          totalAmount: datos.totalAmount,
          issueDate: datos.issueDate,
          businessName: datos.businessName,
          projectId: proj.match.id,
          categoryId: category?.id ?? null,
          requestedBy: fromId,
          requestedByName: fromName,
        });
        const catLabel = category ? `, ${category.name}` : "";
        await sendMessageWithButtons(
          chatId,
          `Leí a mano *${datos.handwrittenNote}*.\n${provLabel}, ${folioLabel}, ${formatMonto(
            datos.totalAmount
          )} → *${proj.match.name}*${catLabel}.\n\n¿Es correcto?`,
          [
            [
              { text: "Sí, asignar", callbackData: `ok:${tagId}` },
              { text: "No", callbackData: `no:${tagId}` },
            ],
          ]
        );
        return NextResponse.json({ ok: true });
      }
      // El manuscrito no calzó con una obra clara → pedir que escriban.
      await sendMessage(
        chatId,
        `Leí a mano "${datos.handwrittenNote}", pero no reconocí una obra clara.\nReenviá la foto escribiendo el nombre de la obra como descripción.`
      );
      return NextResponse.json({ ok: true });
    }

    // Camino (c): nada de obra.
    await sendMessage(
      chatId,
      `Recibí la factura (${provLabel}, ${folioLabel}), pero no encontré el *nombre de la obra* — ni escrito en el mensaje ni a mano en el papel.\nReenviá la foto escribiendo la obra como descripción (ej: \`Portofino\`).`
    );
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[telegram webhook] error:", err);
    await sendMessage(
      chatId,
      "Hubo un problema procesando la foto. Intentá de nuevo en un momento."
    );
    return NextResponse.json({ ok: true });
  }
}

/**
 * Asigna la obra a partir del texto tipeado en el mensaje. Camino confiable,
 * sin confirmación. (Antes era el cuerpo principal del webhook.)
 */
async function asignarDesdeTexto(
  chatId: number,
  texto: string,
  datos: Awaited<ReturnType<typeof readInvoicePhoto>>,
  fromId: string,
  fromName: string
): Promise<void> {
  const provLabel = datos.businessName ?? datos.rutIssuer!;
  const folioLabel = datos.folioNumber ? `folio ${datos.folioNumber}` : "folio ?";

  const proj = await matchProject(texto);
  if (proj.kind === "ninguno") {
    await sendMessage(
      chatId,
      `Leí la factura (${provLabel}, ${formatMonto(
        datos.totalAmount
      )}), pero no reconocí ninguna obra en "${texto}".\n\nObras disponibles:\n${listarOpciones(
        proj.candidates
      )}\n\nReenviá la foto con el nombre de la obra.`
    );
    return;
  }
  if (proj.kind === "ambiguo" || !proj.match) {
    await sendMessage(
      chatId,
      `No estoy seguro de a qué obra te referís con "${texto}". ¿Cuál de estas?\n${listarOpciones(
        proj.candidates
      )}\n\nReenviá la foto con el nombre más preciso.`
    );
    return;
  }
  const project = proj.match;

  const cat = await matchCategory(texto);
  const category = cat.kind === "exacto" ? cat.match ?? null : null;

  const existing = await findInvoiceByRutFolio(
    datos.rutIssuer!,
    datos.folioNumber,
    datos.totalAmount,
    datos.issueDate
  );

  const catLabel = category ? `, ${category.name}` : "";
  // El monto a mostrar: el de la factura real si existe, si no el leído de
  // la foto (arregla el caso donde la foto no traía total claro).
  const monto = existing ? existing.totalAmount : datos.totalAmount;

  if (existing) {
    const r = await applyTagToInvoice(
      existing.id,
      { projectId: existing.projectId, categoryId: existing.categoryId },
      project.id,
      category?.id ?? null
    );
    if (!r.setProject && existing.projectId) {
      await sendMessage(
        chatId,
        `Esa factura (${provLabel}, ${folioLabel}) ya tenía obra asignada. No la cambié.\nSi querés moverla, hacelo desde la app.`
      );
    } else {
      await sendMessage(
        chatId,
        `Listo. ${provLabel}, ${folioLabel}, ${formatMonto(
          monto
        )} → *${project.name}*${catLabel}.`
      );
    }
    return;
  }

  await createPendingTag({
    rutIssuer: datos.rutIssuer!,
    folioNumber: datos.folioNumber,
    totalAmount: datos.totalAmount,
    issueDate: datos.issueDate,
    businessName: datos.businessName,
    projectId: project.id,
    categoryId: category?.id ?? null,
    requestedBy: fromId,
    requestedByName: fromName,
  });

  await sendMessage(
    chatId,
    `Anotado. ${provLabel}, ${folioLabel}, ${formatMonto(
      monto
    )} → *${project.name}*${catLabel}.\n\nLa factura todavía no llegó del SII; se la asigno sola cuando aparezca.`
  );
}

/**
 * Maneja el toque de un botón (Sí/No de la confirmación de obra manuscrita).
 * El callbackData viene como "ok:<tagId>" o "no:<tagId>".
 */
async function handleCallback(cq: TgCallbackQuery): Promise<void> {
  await answerCallbackQuery(cq.id);
  const chatId = cq.message?.chat.id;
  if (!chatId) return;

  // Allowlist también acá (un botón viejo no debería servirle a otro).
  if (!allowedIds().has(String(cq.from.id))) return;

  const data = cq.data ?? "";
  const [action, tagId] = data.split(":");
  if (!tagId || (action !== "ok" && action !== "no")) return;

  const r = await resolvePendingTagConfirmation(tagId, action === "ok");
  const prov = r.businessName ?? "factura";
  const folio = r.folioNumber ? `folio ${r.folioNumber}` : "";

  if (r.outcome === "descartada") {
    await sendMessage(
      chatId,
      `Listo, no la asigné. Reenviá la foto escribiendo la obra correcta como descripción.`
    );
  } else if (r.outcome === "aplicada") {
    await sendMessage(chatId, `Listo. ${prov}, ${folio} → *${r.projectName}*.`);
  } else if (r.outcome === "en_espera") {
    await sendMessage(
      chatId,
      `Anotado. ${prov}, ${folio} → *${r.projectName}*.\nLa factura todavía no llegó del SII; se la asigno sola cuando aparezca.`
    );
  } else if (r.outcome === "ya_resuelta") {
    await sendMessage(chatId, `Esa ya la había procesado.`);
  } else {
    await sendMessage(chatId, `No encontré esa confirmación. Reenviá la foto.`);
  }
}
