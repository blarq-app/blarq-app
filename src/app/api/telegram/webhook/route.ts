// Webhook del bot de Telegram.
//
// El MISMO bot (mismo token, mismo webhook) atiende DOS conversaciones que no
// se mezclan, y se distinguen por el chat del que viene el mensaje:
//
//   - Chat de siempre → FACTURAS: foto de la factura + la obra, para capturar
//     el centro de costo. Es el flujo que documenta el resto de este archivo.
//   - Chat dedicado a los TRASPASOS a Sueldos (TELEGRAM_SUELDOS_CHAT_ID) →
//     pantallazo del comprobante de transferencia + obra y concepto. Vive en
//     manejarTraspaso(), al final del archivo.
//
// El ruteo es por chat.id, no por lo que se vea en la foto: es una decisión
// dura y sin ambigüedad. La lectura de la imagen se usa solo como red de
// seguridad — si al chat de traspasos entra una factura, el bot avisa y no
// guarda nada, en vez de tratar de adivinar a cuál flujo pertenece.
//
// Flujo de un mensaje de FACTURA:
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
  matchCategoryPath,
  type NamedMatch,
  type CategoryMatch,
} from "@/lib/telegram/matchProjectCategory";
import {
  findInvoiceByRutFolio,
  applyTagToInvoice,
  createPendingTag,
  createPendingTagToConfirm,
  resolvePendingTagConfirmation,
} from "@/lib/facturas/pendingTags";
import { readTransferPhoto } from "@/lib/telegram/readTransferPhoto";
import {
  createPendingTransferTag,
  completarConcepto,
  resolverEtiqueta,
  aplicarEtiquetaACandidato,
  getPendingTransferTag,
  getCandidatoPorId,
  type TraspasoCandidato,
  type ResultadoEtiquetado,
} from "@/lib/banco/pendingTransferTags";
import { esConceptoValido } from "@/lib/banco/internalTransferTags";
import { parseTraspasoTexto } from "@/lib/telegram/parseTraspasoTexto";

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
  // type: "private" en el chat 1:1; "group"/"supergroup" en el grupo
  // compartido (MJ + JT + JP). Lo usamos para no spamear el grupo.
  chat: { id: number; type?: string };
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

/**
 * ¿Este chat es el dedicado a los TRASPASOS a Sueldos? Se configura con
 * TELEGRAM_SUELDOS_CHAT_ID. Si la variable no está seteada, no hay chat de
 * traspasos y todo sigue yendo al flujo de facturas de siempre.
 */
function esChatDeTraspasos(chatId: number): boolean {
  const id = (process.env.TELEGRAM_SUELDOS_CHAT_ID ?? "").trim();
  return id !== "" && String(chatId) === id;
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
  //
  //    H17: el secret es OBLIGATORIO. Antes se validaba solo "si existía"
  //    (if (secret)) — si la variable se borraba, la puerta quedaba abierta
  //    sin aviso (la única barrera habría sido la lista de IDs, falsificable
  //    desde el cuerpo). Ahora, sin variable configurada, el webhook se niega
  //    en vez de procesar. El secret YA está seteado en Vercel Production.
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!secret) {
    console.error(
      "TELEGRAM_WEBHOOK_SECRET no configurado — webhook deshabilitado"
    );
    return NextResponse.json({ ok: false }, { status: 503 });
  }
  const got = request.headers.get("x-telegram-bot-api-secret-token");
  if (got !== secret) {
    return NextResponse.json({ ok: false }, { status: 401 });
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

  // Intake compartido: el bot vive en un GRUPO (MJ + JT + JP) además de los
  // chats 1:1. Con el modo privacidad apagado en BotFather, en el grupo
  // recibe TODOS los mensajes — también la conversación normal entre los
  // tres. Para no convertir al bot en un loro que contesta cada mensaje,
  // en un grupo ignoramos en silencio lo que claramente NO es una
  // interacción con él: mensajes sin foto que tampoco son un comando (/...).
  // En privado (1:1) seguimos respondiendo a todo, que ahí sí ayuda guiar.
  const texto = (msg.text ?? msg.caption ?? "").trim();
  const isGroup =
    msg.chat.type === "group" || msg.chat.type === "supergroup";
  const tieneFoto = !!(msg.photo && msg.photo.length > 0);
  const esComando = texto.startsWith("/");
  if (isGroup && !tieneFoto && !esComando) {
    return NextResponse.json({ ok: true });
  }

  // 2. Allowlist. Si el usuario no está autorizado, le decimos su ID para
  //    que MJ lo pueda agregar (es como se descubre el ID la primera vez).
  if (!allowedIds().has(fromId)) {
    await sendMessage(
      chatId,
      `No estás autorizado para usar este bot.\nTu ID de Telegram es: \`${fromId}\`\nPasáselo a MJ para que te habilite.`
    );
    return NextResponse.json({ ok: true });
  }

  // Devuelve el id de ESTE chat. Es el paso de configuración del chat de
  // traspasos: para separar los dos flujos hay que poner el id del chat nuevo
  // en TELEGRAM_SUELDOS_CHAT_ID, y no hay otra forma de averiguarlo desde el
  // teléfono. Solo lo ven los usuarios de la allowlist (se valida arriba).
  if (texto === "/chatid") {
    await sendMessage(
      chatId,
      `El id de este chat es: \`${chatId}\`\n\n${
        esChatDeTraspasos(chatId)
          ? "Ya está configurado como el chat de *traspasos a Sueldos*."
          : "Hoy este chat va al flujo de *facturas*."
      }`
    );
    return NextResponse.json({ ok: true });
  }

  // Ruteo por chat: el chat dedicado a los traspasos a Sueldos tiene su propio
  // flujo completo (ayuda incluida) y no comparte nada con el de facturas.
  if (esChatDeTraspasos(chatId)) {
    await manejarTraspaso(chatId, texto, msg, fromId, fromName);
    return NextResponse.json({ ok: true });
  }

  // Comando de ayuda / start.
  if (texto === "/start" || texto === "/ayuda" || texto === "/help") {
    await sendMessage(
      chatId,
      "Mandame la *foto de la factura* y escribí el *nombre de la obra* como descripción de la foto.\n\nEjemplo simple: foto + `Portofino`.\n\nPara precisar la *categoría* (y subcategoría), separá con barras:\n`Obra / Categoría / Subcategoría`\nEjemplos:\n`JNC / muebles / herrajes`\n`Portofino / materiales / pisos`\nAsí no se confunde la categoría con una obra de nombre parecido.\n\nSi anotaste la obra *a mano* sobre el papel, podés mandar la foto sin escribir nada: la leo del papel y te pido que confirmes.\n\nLeo el proveedor y el folio de la foto, y le asigno la obra a esa factura cuando llegue del SII."
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

  // Formato opcional con barras: "Obra / Categoría / Subcategoría".
  // La obra se busca SOLO en la parte ANTES de la primera barra, así una
  // palabra de categoría (ej. "muebles") no choca con una OBRA parecida (ej.
  // "Muebles Cruz del Sur"). Sin barras → comportamiento de siempre: todo el
  // texto va tanto a obra como a categoría.
  const partes = texto.split("/").map((p) => p.trim()).filter(Boolean);
  const usaBarras = partes.length >= 2;
  const obraText = usaBarras ? partes[0] : texto;
  const catText = usaBarras ? partes.slice(1).join(" ") : texto;

  const proj = await matchProject(obraText);
  if (proj.kind === "ninguno") {
    await sendMessage(
      chatId,
      `Leí la factura (${provLabel}, ${formatMonto(
        datos.totalAmount
      )}), pero no reconocí ninguna obra en "${obraText}".\n\nObras disponibles:\n${listarOpciones(
        proj.candidates
      )}\n\nReenviá la foto con el nombre de la obra.`
    );
    return;
  }
  if (proj.kind === "ambiguo" || !proj.match) {
    await sendMessage(
      chatId,
      `No estoy seguro de a qué obra te referís con "${obraText}". ¿Cuál de estas?\n${listarOpciones(
        proj.candidates
      )}\n\nReenviá la foto con el nombre más preciso (podés separar con barras: \`Obra / Categoría\`).`
    );
    return;
  }
  const project = proj.match;

  // Categoría/subcategoría. Con barras usamos el matcher jerárquico sobre la
  // parte de después de la primera barra; sin barras, el plano de siempre.
  let category: CategoryMatch | null = null;
  let catNote = "";
  if (usaBarras) {
    const cat = await matchCategoryPath(catText);
    if (cat.kind === "exacto") {
      category = cat.match ?? null;
    } else if (catText) {
      // Pidió categoría explícita pero no quedó clara: no bloqueamos la obra,
      // pero avisamos para que la complete a mano si quiere.
      catNote = `\nLa categoría "${catText}" no la reconocí clara, la dejé sin categoría.`;
    }
  } else {
    const cat = await matchCategory(texto);
    category = cat.kind === "exacto" ? cat.match ?? null : null;
  }

  const existing = await findInvoiceByRutFolio(
    datos.rutIssuer!,
    datos.folioNumber,
    datos.totalAmount,
    datos.issueDate
  );

  // Etiqueta de categoría para el mensaje: "Madre > Hija" si es subcategoría.
  const catLabel = category
    ? `, ${category.parentName ? `${category.parentName} > ` : ""}${category.name}`
    : "";
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
        )} → *${project.name}*${catLabel}.${catNote}`
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
    )} → *${project.name}*${catLabel}.${catNote}\n\nLa factura todavía no llegó del SII; se la asigno sola cuando aparezca.`
  );
}

// ==================== TRASPASOS A SUELDOS ====================
//
// MJ se pasa plata de la cuenta Operativa a la cuenta Sueldos separando lo que
// corresponde a obra de lo que corresponde a muebles. Esas transferencias
// entran a la app recién cuando importa la cartola, y hasta ahora quedaban sin
// obra y sin concepto hasta que se acordaba de etiquetarlas a mano.
//
// Con este flujo, MJ manda el pantallazo del comprobante + "Sena obra" apenas
// hace la transferencia. El bot lee fecha y monto del papel, resuelve la obra
// del texto, y:
//   - si el traspaso YA está en la app (ya importó la cartola) → lo etiqueta.
//   - si no → deja la etiqueta esperando y el import la aplica sola.
//
// Esto NO mueve plata: solo le pone obra y concepto a un movimiento que existe
// (o que va a existir). No crea movimientos, no borra, no toca los cálculos.

/** Fecha corta para los mensajes (el dato se guarda en UTC, se lee en UTC). */
function formatFecha(d: Date): string {
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${dd}/${mm}`;
}

/** Botones para elegir el concepto cuando MJ no lo dijo. */
async function pedirConcepto(
  chatId: number,
  tagId: string,
  encabezado: string
): Promise<void> {
  await sendMessageWithButtons(
    chatId,
    `${encabezado}\n\n¿De qué es este traspaso?`,
    [
      [
        { text: "Obra", callbackData: `tc:${tagId}:obra` },
        { text: "Muebles", callbackData: `tc:${tagId}:muebles` },
      ],
    ]
  );
}

/** Texto de cierre según qué se alcanzó a etiquetar y qué ya estaba puesto. */
function mensajeAplicada(
  candidato: TraspasoCandidato,
  obra: string,
  concepto: string,
  r: ResultadoEtiquetado
): string {
  const cabeza = `Traspaso del ${formatFecha(candidato.date)} por ${formatMonto(
    Math.abs(candidato.amount)
  )}`;

  if (!r.setProject && !r.setConcepto) {
    return `${cabeza} ya estaba etiquetado como *${r.yaTeniaProject ?? "—"}*, ${
      r.yaTeniaConcepto ?? "sin concepto"
    }. No lo cambié.\nSi hay que moverlo, se hace desde la app.`;
  }
  let msg = `Listo. ${cabeza} → *${obra}*, ${concepto}.`;
  // Aviso cuando solo se completó una de las dos cosas porque la otra ya venía
  // puesta a mano: lo hecho a mano manda, pero MJ tiene que enterarse.
  if (!r.setProject && r.yaTeniaProject) {
    msg = `Listo. ${cabeza} → ${concepto}.\nLa obra ya estaba puesta (*${r.yaTeniaProject}*) y no la cambié.`;
  } else if (!r.setConcepto && r.yaTeniaConcepto) {
    msg = `Listo. ${cabeza} → *${obra}*.\nEl concepto ya estaba puesto (${r.yaTeniaConcepto}) y no lo cambié.`;
  }
  return msg;
}

/**
 * Toma el resultado de resolver una etiqueta completa y le responde a MJ.
 * Compartido entre el mensaje con foto y el toque del botón de concepto.
 */
async function responderResolucion(
  chatId: number,
  tagId: string,
  obra: string,
  concepto: string,
  fecha: Date,
  monto: number
): Promise<void> {
  const res = await resolverEtiqueta(tagId);
  if (!res) {
    await sendMessage(chatId, "No encontré esa anotación. Reenviá el comprobante.");
    return;
  }

  if (res.tipo === "aplicada") {
    await sendMessage(
      chatId,
      mensajeAplicada(res.candidato, obra, concepto, res.resultado)
    );
    return;
  }

  if (res.tipo === "en_espera") {
    await sendMessage(
      chatId,
      `Anotado. Traspaso del ${formatFecha(fecha)} por ${formatMonto(
        monto
      )} → *${obra}*, ${concepto}.\n\nLa transferencia todavía no está en la app; se la etiqueto sola cuando importes la cartola.`
    );
    return;
  }

  // Ambiguo: hay más de un traspaso con esa fecha y ese monto. No elegimos.
  const botones = res.candidatos
    .slice(0, 4)
    .map((c) => [
      {
        text: `${formatFecha(c.date)} · ${formatMonto(Math.abs(c.amount))} · ${c.cuenta}`,
        callbackData: `tm:${tagId}:${c.id}`,
      },
    ]);
  await sendMessageWithButtons(
    chatId,
    `Encontré ${res.candidatos.length} traspasos con esa fecha y ese monto. ¿Cuál es?`,
    botones
  );
}

/**
 * Flujo completo del chat de traspasos: pantallazo del comprobante + la obra
 * (y el concepto) escritos como descripción de la foto.
 */
async function manejarTraspaso(
  chatId: number,
  texto: string,
  msg: TgMessage,
  fromId: string,
  fromName: string
): Promise<void> {
  if (texto === "/start" || texto === "/ayuda" || texto === "/help") {
    await sendMessage(
      chatId,
      "Este chat es para los *traspasos a la cuenta Sueldos*.\n\nMandame el *pantallazo del comprobante* de la transferencia y escribí como descripción la *obra* y si es *obra* o *muebles*.\n\nEjemplos:\n`Sena obra`\n`Paseo del Sena muebles`\n\nLeo la fecha y el monto del comprobante y le pongo obra y concepto a esa transferencia. Si todavía no importaste la cartola, la dejo anotada y se etiqueta sola cuando la importes.\n\nUn traspaso es de obra *o* de muebles, no mitad y mitad: si te pasás plata de los dos, conviene hacer dos transferencias separadas."
    );
    return;
  }

  if (!msg.photo || msg.photo.length === 0) {
    await sendMessage(
      chatId,
      "Necesito el *pantallazo del comprobante* de la transferencia. Mandá la imagen con la obra y el concepto como descripción (ej: `Sena obra`)."
    );
    return;
  }

  try {
    // Telegram manda varios tamaños; el último es el de mayor resolución.
    const best = msg.photo[msg.photo.length - 1];
    const { base64, mediaType } = await downloadFileAsBase64(best.file_id);
    const datos = await readTransferPhoto(base64, mediaType);

    // Red de seguridad del ruteo por chat: si acá entró una factura (o
    // cualquier otra cosa), avisamos y no guardamos nada. Adivinar el flujo a
    // partir de la imagen sería peor que pedir que la reenvíe al chat correcto.
    if (!datos.esComprobante) {
      await sendMessage(
        chatId,
        `Esto no parece un comprobante de transferencia${
          datos.queEs ? ` — se ve como ${datos.queEs}` : ""
        }, así que no anoté nada.\n\nEn este chat van solo los traspasos a Sueldos. Si es una *factura*, mandala al chat de siempre.`
      );
      return;
    }

    if (!datos.transferDate || datos.amount == null) {
      await sendMessage(
        chatId,
        "Leí el comprobante pero no pude sacar la *fecha* y el *monto* con claridad. Probá con un pantallazo más nítido o más completo."
      );
      return;
    }

    // La fecha se guarda a medianoche UTC, igual que BankMovement.date, para
    // que el match por día sea comparable (el banco no guarda hora).
    const fecha = new Date(`${datos.transferDate}T00:00:00.000Z`);
    const monto = Math.round(Math.abs(datos.amount));
    const resumen = `Comprobante del ${formatFecha(fecha)} por ${formatMonto(monto)}`;

    if (!texto) {
      await sendMessage(
        chatId,
        `${resumen}, pero no me dijiste a qué obra va.\nReenviá el comprobante escribiendo la obra y el concepto como descripción (ej: \`Sena obra\`).`
      );
      return;
    }

    const { concepto, ambos, resto } = parseTraspasoTexto(texto);

    if (ambos) {
      await sendMessage(
        chatId,
        `${resumen}. Me dijiste *obra y muebles* a la vez, y un traspaso es de uno o del otro — la app no lo puede partir en dos.\n\nSi te pasaste plata de los dos, conviene hacer *dos transferencias separadas* y mandarme un comprobante de cada una.`
      );
      return;
    }

    const proj = await matchProject(resto);
    if (proj.kind === "ninguno") {
      await sendMessage(
        chatId,
        `${resumen}, pero no reconocí ninguna obra en "${resto}".\n\nObras disponibles:\n${listarOpciones(
          proj.candidates
        )}\n\nReenviá el comprobante con el nombre de la obra.`
      );
      return;
    }
    if (proj.kind === "ambiguo" || !proj.match) {
      await sendMessage(
        chatId,
        `${resumen}. No estoy seguro de a qué obra te referís con "${resto}". ¿Cuál de estas?\n${listarOpciones(
          proj.candidates
        )}\n\nReenviá el comprobante con el nombre más preciso.`
      );
      return;
    }
    const project = proj.match;

    // La etiqueta se guarda SIEMPRE (aunque el traspaso ya exista): deja el
    // rastro de quién lo mandó y unifica los dos caminos.
    const tagId = await createPendingTransferTag({
      transferDate: fecha,
      amount: monto,
      bankName: datos.bankName,
      destination: datos.destination,
      projectId: project.id,
      concepto,
      requestedBy: fromId,
      requestedByName: fromName,
    });

    if (!concepto) {
      // Falta el concepto: preguntamos con botones en vez de asumir uno.
      await pedirConcepto(
        chatId,
        tagId,
        `${resumen} → *${project.name}*.`
      );
      return;
    }

    await responderResolucion(chatId, tagId, project.name, concepto, fecha, monto);
  } catch (err) {
    console.error("[telegram webhook traspaso] error:", err);
    await sendMessage(
      chatId,
      "Hubo un problema procesando el comprobante. Intentá de nuevo en un momento."
    );
  }
}

/**
 * Toques de botón del flujo de traspasos:
 *   "tc:<tagId>:<obra|muebles>" → el concepto que faltaba.
 *   "tm:<tagId>:<movimientoId>" → cuál de los traspasos era, cuando había más
 *                                 de uno con la misma fecha y monto.
 */
async function handleCallbackTraspaso(
  chatId: number,
  data: string
): Promise<void> {
  const [action, tagId, valor] = data.split(":");
  if (!tagId || !valor) return;

  const tag = await getPendingTransferTag(tagId);
  if (!tag) {
    await sendMessage(chatId, "No encontré esa anotación. Reenviá el comprobante.");
    return;
  }
  const obra = tag.project?.name ?? "—";

  if (action === "tc") {
    if (!esConceptoValido(valor)) return;
    const r = await completarConcepto(tagId, valor);
    if (r && !r.ok) {
      // Doble toque del botón: ya se había resuelto. Idempotente.
      await sendMessage(chatId, "Ese ya lo había anotado.");
      return;
    }
    await responderResolucion(
      chatId,
      tagId,
      obra,
      valor,
      tag.transferDate,
      tag.amount
    );
    return;
  }

  if (action === "tm") {
    if (tag.status === "aplicada") {
      await sendMessage(chatId, "Ese ya lo había etiquetado.");
      return;
    }
    const candidato = await getCandidatoPorId(valor);
    if (!candidato) {
      await sendMessage(chatId, "Ese movimiento ya no está disponible. Reenviá el comprobante.");
      return;
    }
    const r = await aplicarEtiquetaACandidato(tagId, candidato);
    await sendMessage(
      chatId,
      mensajeAplicada(candidato, obra, tag.concepto ?? "—", r)
    );
  }
}

/**
 * Maneja el toque de un botón. El callbackData viene como "<acción>:<...>":
 *   "ok:" / "no:" → confirmación de la obra manuscrita de una FACTURA.
 *   "tc:" / "tm:" → flujo de TRASPASOS a Sueldos (concepto / cuál traspaso).
 */
async function handleCallback(cq: TgCallbackQuery): Promise<void> {
  await answerCallbackQuery(cq.id);
  const chatId = cq.message?.chat.id;
  if (!chatId) return;

  // Allowlist también acá (un botón viejo no debería servirle a otro).
  if (!allowedIds().has(String(cq.from.id))) return;

  const data = cq.data ?? "";
  const [action, tagId] = data.split(":");

  if (action === "tc" || action === "tm") {
    await handleCallbackTraspaso(chatId, data);
    return;
  }

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
