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
//   3. Responder confirmando o pidiendo aclaración.
//
// Diseño conservador: si no podemos identificar el proveedor (RUT) o la
// obra con claridad, NO inventamos — le pedimos a MJ/JT que reenvíen o
// escriban mejor. Asignar a la obra equivocada es peor que volver a pedir.
//
// Este endpoint solo ESCRIBE asignaciones de proyecto/categoría (y filas en
// PendingProjectTag). No toca cálculos contables, no borra nada, no mueve
// plata. Bajo riesgo.

import { NextRequest, NextResponse } from "next/server";
import { sendMessage, downloadFileAsBase64 } from "@/lib/telegram/api";
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
} from "@/lib/facturas/pendingTags";

// ---- Tipos mínimos del update de Telegram (solo lo que usamos) ----
interface TgPhotoSize {
  file_id: string;
  file_size?: number;
  width: number;
  height: number;
}
interface TgMessage {
  message_id: number;
  from?: { id: number; first_name?: string; username?: string };
  chat: { id: number };
  text?: string;
  caption?: string;
  photo?: TgPhotoSize[];
}
interface TgUpdate {
  message?: TgMessage;
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
      "Mandame la *foto de la factura* y, en el mismo mensaje (como descripción de la foto), escribí el *nombre de la obra* y opcional la categoría.\n\nEjemplo: foto + `Portofino materiales`.\n\nYo leo el proveedor y el folio de la foto, y le asigno la obra a esa factura cuando llegue del SII."
    );
    return NextResponse.json({ ok: true });
  }

  // 3. Necesitamos foto.
  if (!msg.photo || msg.photo.length === 0) {
    await sendMessage(
      chatId,
      "Necesito la *foto* de la factura. Mandá la imagen con el nombre de la obra como descripción."
    );
    return NextResponse.json({ ok: true });
  }

  // Necesitamos texto con la obra (va como caption de la foto).
  if (!texto) {
    await sendMessage(
      chatId,
      "Recibí la foto, pero falta el *nombre de la obra*. Reenviá la foto escribiendo la obra como descripción (ej: `Portofino`)."
    );
    return NextResponse.json({ ok: true });
  }

  try {
    // Telegram manda varios tamaños; el último es el de mayor resolución.
    const best = msg.photo[msg.photo.length - 1];
    const { base64, mediaType } = await downloadFileAsBase64(best.file_id);

    // Leer la factura.
    const datos = await readInvoicePhoto(base64, mediaType);

    if (!datos.rutIssuer) {
      await sendMessage(
        chatId,
        "No pude leer el *RUT del proveedor* en la foto. Probá con una foto más nítida o más de cerca al recuadro rojo."
      );
      return NextResponse.json({ ok: true });
    }

    // Etiqueta del proveedor para los mensajes (nombre o, si no, el RUT).
    const provLabel = datos.businessName ?? datos.rutIssuer;

    // Matchear obra (obligatoria) y categoría (opcional).
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
      return NextResponse.json({ ok: true });
    }
    if (proj.kind === "ambiguo" || !proj.match) {
      await sendMessage(
        chatId,
        `No estoy seguro de a qué obra te referís con "${texto}". ¿Cuál de estas?\n${listarOpciones(
          proj.candidates
        )}\n\nReenviá la foto con el nombre más preciso.`
      );
      return NextResponse.json({ ok: true });
    }
    const project = proj.match;

    // Categoría: solo si el texto la menciona claramente. Si no, queda en
    // null y la completa la regla por proveedor (o MJ después).
    const cat = await matchCategory(texto);
    const category = cat.kind === "exacto" ? cat.match ?? null : null;

    // ¿La factura ya existe en la app?
    const existing = await findInvoiceByRutFolio(
      datos.rutIssuer,
      datos.folioNumber
    );

    const folioLabel = datos.folioNumber
      ? `folio ${datos.folioNumber}`
      : "folio ?";
    const catLabel = category ? `, ${category.name}` : "";

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
            datos.totalAmount
          )} → *${project.name}*${catLabel}.`
        );
      }
      return NextResponse.json({ ok: true });
    }

    // No existe todavía: dejar etiqueta en espera.
    await createPendingTag({
      rutIssuer: datos.rutIssuer,
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
        datos.totalAmount
      )} → *${project.name}*${catLabel}.\n\nLa factura todavía no llegó del SII; se la asigno sola cuando aparezca.`
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
