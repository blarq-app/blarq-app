// Siembra gastos de prueba (boletas + internacionales, con foto) en la base de
// DESARROLLO para poder ver el PDF mensual con datos parecidos a los reales.
//
// SEGURIDAD: se niega a correr si el host NO es la base de desarrollo
// (ep-solitary-mud). La viva (ep-shy-morning) no se toca nunca desde acá.
//
// Uso:  npx tsx scripts/seed-dev-gastos-f22.ts .env
import { readFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
import puppeteer from "puppeteer";

const envPath = process.argv[2] ?? ".env";
const url = readFileSync(envPath, "utf8")
  .split("\n")
  .map((l) => l.match(/^\s*DATABASE_URL\s*=\s*"?([^"\n]+)"?\s*$/))
  .find(Boolean)![1];
const host = url.match(/@([^/]+)\//)?.[1] ?? "?";
console.log("HOST:", host);
if (!host.includes("ep-solitary-mud")) {
  console.error(
    "PARAR: este script solo escribe en la base de DESARROLLO (ep-solitary-mud)."
  );
  process.exit(1);
}
const prisma = new PrismaClient({ datasources: { db: { url } } });

const BLARQ_RUT = "77.270.733-9";

// Gastos de junio 2026. Los internacionales son los reales que hoy están sin
// registrar en la viva; las boletas simulan el reembolso a Daniel Ignacio.
const SEMILLA = [
  { dia: 1, tipo: "internacional" as const, comercio: "GOOGLE *Workspace", monto: 46088, doc: null, reembolsoA: null },
  { dia: 1, tipo: "internacional" as const, comercio: "CLAUDE.AI SUBSCRIPTION", monto: 109349, doc: null, reembolsoA: null },
  { dia: 4, tipo: "boleta" as const, comercio: "Ferretería El Roble", monto: 12480, doc: "1103", reembolsoA: "DANIEL IGNACIO" },
  { dia: 4, tipo: "boleta" as const, comercio: "Sodimac Constructor", monto: 23990, doc: "1104", reembolsoA: "DANIEL IGNACIO" },
  { dia: 9, tipo: "boleta" as const, comercio: "Notaría Iturra", monto: 46000, doc: "88231", reembolsoA: null },
  { dia: 12, tipo: "boleta" as const, comercio: "Estacionamiento Costanera", monto: 4500, doc: null, reembolsoA: "JOSE TOMAS LARRAIN" },
  { dia: 20, tipo: "boleta" as const, comercio: "Easy La Dehesa", monto: 27303, doc: "1187", reembolsoA: "DANIEL IGNACIO" },
  { dia: 22, tipo: "internacional" as const, comercio: "ANTHROPIC* CLAUDE", monto: 110384, doc: null, reembolsoA: null },
];

// Genera una imagen JPEG (data URL) que parece la foto de una boleta de papel,
// para que el PDF se vea como se va a ver con fotos de verdad.
async function fotosDePrueba(): Promise<string[]> {
  const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox"] });
  const page = await browser.newPage();
  await page.setViewport({ width: 620, height: 820 });
  const fotos: string[] = [];
  for (const s of SEMILLA) {
    const lineas = Array.from({ length: 7 }, (_, i) => {
      const w = 40 + ((i * 41) % 45);
      return `<div style="height:6px;background:#c9c4bd;width:${w}%;margin:0 auto 12px"></div>`;
    }).join("");
    await page.setContent(`<html><body style="margin:0;background:#e8e6e1;display:flex;align-items:center;justify-content:center;height:820px;font-family:monospace">
      <div style="width:62%;background:#fdfcfa;padding:34px 24px;text-align:center;box-shadow:0 2px 10px rgba(0,0,0,.15);transform:rotate(-1.2deg)">
        <div style="font-size:15px;letter-spacing:.14em;text-transform:uppercase;font-weight:700">${s.comercio}</div>
        <div style="font-size:11px;color:#888;margin:6px 0 22px">${
          s.tipo === "boleta" ? `BOLETA N° ${s.doc ?? "—"}` : "CARGO INTERNACIONAL"
        }</div>
        ${lineas}
        <div style="border-top:2px dashed #c9c4bd;margin-top:18px;padding-top:14px;font-size:20px;font-weight:700">$${s.monto.toLocaleString("es-CL")}</div>
        <div style="font-size:10px;color:#999;margin-top:8px">FOTO DE PRUEBA</div>
      </div>
    </body></html>`);
    const buf = await page.screenshot({ type: "jpeg", quality: 70 });
    fotos.push(`data:image/jpeg;base64,${Buffer.from(buf).toString("base64")}`);
  }
  await browser.close();
  return fotos;
}

async function main() {
  // Limpieza de corridas anteriores de este mismo script.
  const borrados = await prisma.invoice.deleteMany({
    where: { notes: { contains: "[semilla-f22]" } },
  });
  if (borrados.count) console.log(`Borradas ${borrados.count} semillas viejas.`);

  const fotos = await fotosDePrueba();
  console.log(`Fotos generadas: ${fotos.length} (~${Math.round(fotos[0].length / 1024)} KB c/u)`);

  // Una cuenta bancaria cualquiera de dev para colgar los movimientos.
  const cuenta = await prisma.bankAccount.findFirst({ select: { id: true } });
  if (!cuenta) throw new Error("No hay cuentas bancarias en dev");

  let creados = 0;
  for (const [i, s] of SEMILLA.entries()) {
    const fecha = new Date(2026, 5, s.dia); // junio 2026
    const origin = s.tipo === "boleta" ? "gasto_boleta" : "gasto_internacional";
    const prefijo = s.tipo === "boleta" ? "BOL" : "INT";

    // Movimiento bancario que pagó el gasto. La contraparte es la persona a la
    // que se le reembolsó, o el comercio mismo cuando el cargo salió directo.
    const contraparte = s.reembolsoA ?? s.comercio;
    const mov = await prisma.bankMovement.create({
      data: {
        bankAccountId: cuenta.id,
        date: fecha,
        description: `[semilla-f22] ${contraparte}`,
        amount: -s.monto,
        type: "cargo",
        counterpartyName: contraparte,
        status: "conciliado",
      },
    });

    const inv = await prisma.invoice.create({
      data: {
        type: "recibida",
        tipoDoc: 1043,
        // Cuando la boleta tiene número impreso se guarda ese; si no, el folio
        // interno generado desde el movimiento.
        folioNumber: s.doc ?? `${prefijo}-${mov.id.slice(-8)}`,
        rutIssuer: null,
        rutReceiver: BLARQ_RUT,
        businessName: s.comercio,
        issueDate: fecha,
        dueDate: fecha,
        netAmount: s.monto,
        iva: 0,
        totalAmount: s.monto,
        status: "pagada",
        paidAt: fecha,
        origin,
        attachmentUrl: fotos[i],
        notes: "[semilla-f22] gasto de prueba",
      },
    });
    await prisma.invoicePayment.create({
      data: { bankMovementId: mov.id, invoiceId: inv.id, amountApplied: s.monto },
    });
    creados++;
  }

  const total = SEMILLA.reduce((s, g) => s + g.monto, 0);
  console.log(`Creados ${creados} gastos de prueba en junio 2026. Total $${total.toLocaleString("es-CL")}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
