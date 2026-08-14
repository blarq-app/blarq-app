// Arma el escenario real del bot en la base de DESARROLLO y saca la captura de
// cómo queda el traspaso en Banco, para que MJ apruebe viendo el resultado
// (§4.10: no lee código).
//
// Qué hace:
//   1. Mete el comprobante por el webhook REAL (Telegram interceptado) → queda
//      la etiqueta en espera.
//   2. Simula que llegó la cartola: crea el par de movimientos del traspaso y
//      corre el enganche del import.
//   3. Se loguea en el dev local firmando el token de sesión y captura
//      /banco/movimientos con el traspaso ya etiquetado.
//
// Uso: npx tsx scripts/capturar-traspaso-etiquetado.ts <env-dev> <comprobante.png>
import { readFileSync } from "fs";
import { chromium } from "playwright";
import { encode } from "next-auth/jwt";

const [envPath, fotoPath] = process.argv.slice(2);
if (!envPath || !fotoPath) {
  console.error("Uso: npx tsx scripts/capturar-traspaso-etiquetado.ts <env-dev> <comprobante.png>");
  process.exit(1);
}
const env = readFileSync(envPath, "utf8");
const leer = (k: string) =>
  env.match(new RegExp(`${k}\\s*=\\s*"?([^"\\n]+)"?`))?.[1]?.trim();

const dbUrl = leer("DATABASE_URL")!;
const host = dbUrl.match(/@([^/.]+)/)?.[1] ?? "?";
if (host.includes("shy-morning")) {
  console.error("ABORTADO: esto escribe y apunta a la base VIVA.");
  process.exit(1);
}

const CHAT_TRASPASOS = -1009999001;
const SECRET_WEBHOOK = "secreto-de-prueba";
const USER_ID = "42";
process.env.DATABASE_URL = dbUrl;
process.env.ANTHROPIC_API_KEY = leer("ANTHROPIC_API_KEY")!;
process.env.TELEGRAM_WEBHOOK_SECRET = SECRET_WEBHOOK;
process.env.TELEGRAM_ALLOWED_IDS = USER_ID;
process.env.TELEGRAM_SUELDOS_CHAT_ID = String(CHAT_TRASPASOS);
process.env.TELEGRAM_BOT_TOKEN = "token-de-prueba";

const fotoBase64 = readFileSync(fotoPath).toString("base64");
const respuestas: string[] = [];

// Telegram interceptado: la foto sale de un archivo local y los mensajes del
// bot se guardan acá en vez de enviarse. La API de Claude sí sale de verdad.
const fetchReal = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input.toString();
  if (url.includes("api.telegram.org")) {
    if (url.includes("/getFile")) {
      return new Response(
        JSON.stringify({ ok: true, result: { file_path: "photos/p.png" } }),
        { status: 200 }
      );
    }
    if (url.includes("/file/bot")) {
      return new Response(Buffer.from(fotoBase64, "base64"), { status: 200 });
    }
    if (url.includes("/sendMessage")) {
      respuestas.push(JSON.parse((init?.body as string) ?? "{}").text ?? "");
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  }
  return fetchReal(input, init);
}) as typeof fetch;

async function main() {
  const { POST } = await import("@/app/api/telegram/webhook/route");
  const { prisma } = await import("@/lib/prisma");
  const { applyPendingTransferTagsForMovement } = await import(
    "@/lib/banco/pendingTransferTags"
  );

  // ── Limpieza de corridas anteriores ──
  await limpiar(prisma);

  // ── 1. MJ manda el comprobante ──
  const update = {
    message: {
      message_id: 1,
      from: { id: Number(USER_ID), first_name: "MJ" },
      chat: { id: CHAT_TRASPASOS, type: "private" },
      caption: "Portofino obra",
      photo: [{ file_id: "foto", width: 400, height: 600 }],
    },
  };
  await POST(
    new Request("http://localhost/api/telegram/webhook", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-telegram-bot-api-secret-token": SECRET_WEBHOOK,
      },
      body: JSON.stringify(update),
    }) as never
  );
  console.log("BOT respondió:\n" + respuestas.join("\n---\n") + "\n");

  const tag = await prisma.pendingTransferTag.findFirst({
    where: { requestedBy: USER_ID },
    orderBy: { createdAt: "desc" },
  });
  if (!tag) throw new Error("No quedó la etiqueta en espera");

  // ── 2. Llega la cartola: aparece el traspaso ──
  const operativa = await prisma.bankAccount.findFirst({ where: { role: "operating" } });
  const sueldos = await prisma.bankAccount.findFirst({ where: { role: "salary_fund" } });
  const sale = await prisma.bankMovement.create({
    data: {
      bankAccountId: operativa!.id, date: tag.transferDate,
      description: "TRASPASO A CTA SUELDOS", amount: -tag.amount, type: "cargo",
      category: "transfer_interno", status: "interno",
    },
  });
  const entra = await prisma.bankMovement.create({
    data: {
      bankAccountId: sueldos!.id, date: tag.transferDate,
      description: "TRASPASO DESDE CTA OPERATIVA", amount: tag.amount, type: "abono",
      category: "transfer_interno", status: "interno", internalTransferToId: sale.id,
    },
  });
  await prisma.bankMovement.update({
    where: { id: sale.id }, data: { internalTransferToId: entra.id },
  });
  const n = await applyPendingTransferTagsForMovement(entra.id);
  console.log(`El import aplicó ${n} etiqueta(s).`);

  const final = await prisma.bankMovement.findUnique({
    where: { id: entra.id },
    include: { project: { select: { name: true } } },
  });
  console.log(
    `El movimiento quedó: obra "${final?.project?.name}" · concepto "${final?.internalConcepto}"\n`
  );

  // ── 3. Captura de la pantalla, logueado ──
  const user = await prisma.user.findFirst({ select: { id: true, email: true, name: true } });
  if (!user) throw new Error("No hay usuario en la base dev para loguearse");

  const token = await encode({
    token: { sub: user.id, email: user.email, name: user.name },
    secret: leer("NEXTAUTH_SECRET")!,
    salt: "authjs.session-token",
  });

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.context().addCookies([
    {
      name: "authjs.session-token", value: token,
      domain: "localhost", path: "/", httpOnly: true, sameSite: "Lax",
    },
  ]);

  await page.goto("http://localhost:3000/banco/movimientos", {
    waitUntil: "networkidle",
  });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: "scripts/_capturas/158-traspaso-etiquetado.png", fullPage: false });
  console.log("captura: scripts/_capturas/158-traspaso-etiquetado.png");

  // Recorte de las dos filas del par — es lo que MJ tiene que mirar: el mismo
  // traspaso visto desde las dos cuentas, los dos con la obra y el concepto.
  const fila = page.locator("tr", { hasText: "TRASPASO DESDE CTA OPERATIVA" }).first();
  const caja = await fila.boundingBox();
  if (caja) {
    await page.screenshot({
      path: "scripts/_capturas/158-traspaso-detalle.png",
      clip: {
        x: Math.max(0, caja.x - 10),
        y: Math.max(0, caja.y - 40),
        width: Math.min(1440 - caja.x + 10, caja.width + 20),
        height: caja.height * 2 + 50,
      },
    });
    console.log("captura: scripts/_capturas/158-traspaso-detalle.png");
  }

  await browser.close();
  await prisma.$disconnect();
}

async function limpiar(prisma: import("@prisma/client").PrismaClient) {
  await prisma.pendingTransferTag.deleteMany({ where: { requestedBy: USER_ID } });
  const movs = await prisma.bankMovement.findMany({
    where: { description: { startsWith: "TRASPASO " } },
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

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
