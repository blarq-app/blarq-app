// Prueba de punta a punta del bot de traspasos: mete updates de Telegram por
// el webhook REAL y muestra la conversación que MJ vería.
//
// Cómo funciona sin tocar Telegram: se intercepta fetch. Todo lo que va a
// api.telegram.org se simula acá (la bajada de la foto devuelve un PNG local,
// y los mensajes que el bot manda se imprimen en vez de enviarse). Las
// llamadas a la API de Claude SÍ salen de verdad — la lectura de la imagen es
// la parte que interesa probar en serio.
//
// Escribe en la base que se le pase: usar la de DESARROLLO. Limpia lo suyo.
//
// Uso: npx tsx scripts/test-webhook-traspaso.ts <env-dev> <comprobante.png>
import { readFileSync } from "fs";

const [envPath, fotoPath] = process.argv.slice(2);
if (!envPath || !fotoPath) {
  console.error("Uso: npx tsx scripts/test-webhook-traspaso.ts <env-dev> <comprobante.png>");
  process.exit(1);
}
const env = readFileSync(envPath, "utf8");
const leer = (k: string) =>
  env.match(new RegExp(`${k}\\s*=\\s*"?([^"\\n]+)"?`))?.[1]?.trim();

const dbUrl = leer("DATABASE_URL");
const apiKey = leer("ANTHROPIC_API_KEY");
if (!dbUrl || !apiKey) {
  console.error("Falta DATABASE_URL o ANTHROPIC_API_KEY en", envPath);
  process.exit(1);
}
const host = dbUrl.match(/@([^/.]+)/)?.[1] ?? "?";
if (host.includes("shy-morning")) {
  console.error("ABORTADO: esto escribe y apunta a la base VIVA.");
  process.exit(1);
}

// Entorno del webhook. El chat de traspasos es uno inventado para la prueba.
const CHAT_TRASPASOS = -1009999001;
const CHAT_FACTURAS = 1234567;
const SECRET = "secreto-de-prueba";
const USER_ID = "42";
process.env.DATABASE_URL = dbUrl;
process.env.ANTHROPIC_API_KEY = apiKey;
process.env.TELEGRAM_WEBHOOK_SECRET = SECRET;
process.env.TELEGRAM_ALLOWED_IDS = USER_ID;
process.env.TELEGRAM_SUELDOS_CHAT_ID = String(CHAT_TRASPASOS);
process.env.TELEGRAM_BOT_TOKEN = "token-de-prueba";

// Qué imagen devuelve la descarga simulada. Es mutable porque un caso de
// prueba manda una factura en vez del comprobante.
const foto = { base64: readFileSync(fotoPath).toString("base64") };

// ── Intercepción de Telegram ────────────────────────────────────────────────
// Guardamos lo que el bot responde para imprimirlo como conversación.
interface Respuesta {
  texto: string;
  botones: { text: string; callback_data: string }[][];
}
let respuestas: Respuesta[] = [];

const fetchReal = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input.toString();

  if (url.includes("api.telegram.org")) {
    if (url.includes("/getFile")) {
      return new Response(
        JSON.stringify({ ok: true, result: { file_path: "photos/prueba.png" } }),
        { status: 200 }
      );
    }
    if (url.includes("/file/bot")) {
      return new Response(Buffer.from(foto.base64, "base64"), { status: 200 });
    }
    if (url.includes("/sendMessage")) {
      const body = JSON.parse((init?.body as string) ?? "{}");
      respuestas.push({
        texto: body.text ?? "",
        botones: body.reply_markup?.inline_keyboard ?? [],
      });
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  }

  // Todo lo demás (la API de Claude) sale de verdad.
  return fetchReal(input, init);
}) as typeof fetch;

// ── Helpers de la simulación ────────────────────────────────────────────────
let messageId = 1;

function pintarRespuestas(): void {
  for (const r of respuestas) {
    // El bot escribe en Markdown de Telegram; se muestra tal cual lo ve MJ.
    console.log("   BOT ┃ " + r.texto.split("\n").join("\n       ┃ "));
    for (const fila of r.botones) {
      console.log("       ┃ [ " + fila.map((b) => b.text).join(" ] [ ") + " ]");
    }
  }
  console.log();
}

async function main() {
  console.log("=== HOST:", host, "===\n");
  const { POST } = await import("@/app/api/telegram/webhook/route");
  const { prisma } = await import("@/lib/prisma");

  const obra = await prisma.project.findFirst({
    where: { name: { contains: "Portofino", mode: "insensitive" }, status: { not: "archivado" } },
    select: { id: true, name: true },
  });
  if (!obra) {
    console.error("No hay obra 'Portofino' en esta base para la prueba.");
    process.exit(1);
  }

  /** Manda un update al webhook y devuelve lo que el bot respondió. */
  async function mandar(opts: {
    chatId: number;
    texto?: string;
    conFoto?: boolean;
    callbackData?: string;
  }) {
    respuestas = [];
    const update = opts.callbackData
      ? {
          callback_query: {
            id: String(messageId++),
            from: { id: Number(USER_ID), first_name: "MJ" },
            message: { chat: { id: opts.chatId } },
            data: opts.callbackData,
          },
        }
      : {
          message: {
            message_id: messageId++,
            from: { id: Number(USER_ID), first_name: "MJ" },
            chat: { id: opts.chatId, type: "private" },
            ...(opts.texto ? { caption: opts.texto } : {}),
            ...(opts.conFoto
              ? { photo: [{ file_id: "foto-prueba", width: 400, height: 600 }] }
              : {}),
          },
        };

    const req = new Request("http://localhost/api/telegram/webhook", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-telegram-bot-api-secret-token": SECRET,
      },
      body: JSON.stringify(update),
    });
    // El handler solo usa headers.get() y json(): un Request estándar alcanza.
    await POST(req as never);
    return respuestas;
  }

  // Limpieza de corridas anteriores.
  await limpiar();

  // ══ 1. La ayuda del chat de traspasos (verifica el ruteo por chat) ══
  console.log("── 1. MJ escribe /ayuda en el chat de TRASPASOS ──");
  console.log("   MJ  ┃ /ayuda");
  await mandar({ chatId: CHAT_TRASPASOS, texto: "/ayuda" });
  pintarRespuestas();

  // ══ 2. La misma /ayuda en el chat de facturas: no se mezclan ══
  console.log("── 2. La misma /ayuda en el chat de FACTURAS (no se mezclan) ──");
  console.log("   MJ  ┃ /ayuda");
  await mandar({ chatId: CHAT_FACTURAS, texto: "/ayuda" });
  pintarRespuestas();

  // ══ 3. El caso normal: comprobante + obra y concepto ══
  console.log("── 3. MJ manda el comprobante diciendo obra y concepto ──");
  console.log("   MJ  ┃ [foto del comprobante] Portofino obra");
  await mandar({ chatId: CHAT_TRASPASOS, texto: "Portofino obra", conFoto: true });
  pintarRespuestas();

  const tag = await prisma.pendingTransferTag.findFirst({
    where: { requestedBy: USER_ID },
    orderBy: { createdAt: "desc" },
    include: { project: { select: { name: true } } },
  });
  console.log(
    `   → quedó anotado: ${tag?.project?.name} · ${tag?.concepto} · $${Math.round(
      tag?.amount ?? 0
    ).toLocaleString("es-CL")} · ${tag?.transferDate.toISOString().slice(0, 10)} · estado "${tag?.status}"\n`
  );

  // ══ 4. Ahora "llega la cartola": el traspaso entra y se etiqueta solo ══
  console.log("── 4. MJ importa la cartola: entra el traspaso ──");
  const { applyPendingTransferTagsForMovement } = await import(
    "@/lib/banco/pendingTransferTags"
  );
  const fecha = tag!.transferDate;
  const monto = tag!.amount;
  const { entra } = await crearParDePrueba(fecha, monto);
  const n = await applyPendingTransferTagsForMovement(entra.id);
  const yaEtiquetado = await prisma.bankMovement.findUnique({
    where: { id: entra.id },
    include: { project: { select: { name: true } } },
  });
  console.log(`   → el import aplicó ${n} etiqueta(s).`);
  console.log(
    `   → el movimiento en Banco quedó: obra "${yaEtiquetado?.project?.name}" · concepto "${yaEtiquetado?.internalConcepto}"\n`
  );

  // ══ 5. Comprobante sin decir el concepto → pregunta con botones ══
  // Se limpia lo del caso anterior para que este empiece de cero (el
  // comprobante de prueba tiene siempre la misma fecha y monto).
  console.log("── 5. MJ manda el comprobante sin decir obra/muebles ──");
  await limpiar();
  console.log("   MJ  ┃ [foto del comprobante] Portofino");
  await mandar({ chatId: CHAT_TRASPASOS, texto: "Portofino", conFoto: true });
  pintarRespuestas();

  const tag5 = await prisma.pendingTransferTag.findFirst({
    where: { requestedBy: USER_ID },
    orderBy: { createdAt: "desc" },
  });
  console.log("   MJ  ┃ (toca el botón 'Muebles')");
  await mandar({ chatId: CHAT_TRASPASOS, callbackData: `tc:${tag5!.id}:muebles` });
  pintarRespuestas();

  // Y cuando entra la cartola, se aplica el concepto que eligió con el botón.
  const par5 = await crearParDePrueba(fecha, monto);
  await applyPendingTransferTagsForMovement(par5.entra.id);
  const mov5 = await prisma.bankMovement.findUnique({
    where: { id: par5.entra.id },
    include: { project: { select: { name: true } } },
  });
  console.log(
    `   → al importar la cartola quedó: obra "${mov5?.project?.name}" · concepto "${mov5?.internalConcepto}"\n`
  );

  // ══ 6. Red de seguridad: una factura entrando por el chat de traspasos ══
  console.log("── 6. Entra una FACTURA por el chat de traspasos (red de seguridad) ──");
  const facturaPath = fotoPath.replace("comprobante", "factura");
  console.log("   MJ  ┃ [foto de una factura] Portofino obra");
  await mandarConFoto(facturaPath, "Portofino obra");
  pintarRespuestas();

  // ══ 7. Sin foto ══
  console.log("── 7. MJ escribe sin mandar el comprobante ──");
  console.log("   MJ  ┃ Portofino obra");
  await mandar({ chatId: CHAT_TRASPASOS, texto: "Portofino obra" });
  pintarRespuestas();

  await limpiar();
  await prisma.$disconnect();

  /** Manda una imagen distinta a la del comprobante (el caso de la factura). */
  async function mandarConFoto(path: string, texto: string) {
    const guardada = foto.base64;
    try {
      foto.base64 = readFileSync(path).toString("base64");
    } catch {
      console.log(`   (no encontré ${path}, se omite este caso)`);
      return;
    }
    await mandar({ chatId: CHAT_TRASPASOS, texto, conFoto: true });
    foto.base64 = guardada;
  }

  /** Crea el par de movimientos que deja el import al detectar un traspaso. */
  async function crearParDePrueba(fecha: Date, monto: number) {
    const operativa = await prisma.bankAccount.findFirst({ where: { role: "operating" } });
    const sueldos = await prisma.bankAccount.findFirst({ where: { role: "salary_fund" } });
    const sale = await prisma.bankMovement.create({
      data: {
        bankAccountId: operativa!.id, date: fecha, description: "TEST-WEBHOOK salida",
        amount: -monto, type: "cargo", category: "transfer_interno", status: "interno",
      },
    });
    const entra = await prisma.bankMovement.create({
      data: {
        bankAccountId: sueldos!.id, date: fecha, description: "TEST-WEBHOOK entrada",
        amount: monto, type: "abono", category: "transfer_interno", status: "interno",
        internalTransferToId: sale.id,
      },
    });
    await prisma.bankMovement.update({
      where: { id: sale.id }, data: { internalTransferToId: entra.id },
    });
    return { sale, entra };
  }

  async function limpiar() {
    await prisma.pendingTransferTag.deleteMany({ where: { requestedBy: USER_ID } });
    const movs = await prisma.bankMovement.findMany({
      where: { description: { startsWith: "TEST-WEBHOOK" } },
      select: { id: true },
    });
    const ids = movs.map((m) => m.id);
    if (ids.length > 0) {
      await prisma.bankMovement.updateMany({
        where: { id: { in: ids } }, data: { internalTransferToId: null },
      });
      await prisma.bankMovement.deleteMany({ where: { id: { in: ids } } });
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
