// Concilia en la base VIVA los cargos internacionales de Anthropic y Neon que
// emparejan con una factura PDF de ~/Desktop/BLARQ-Contador. Por cada uno:
//   - crea un Invoice 1043 (origin=gasto_internacional, iva:0)
//   - le adjunta la factura PDF como data URL (Invoice.attachmentUrl)
//   - lo cuelga del movimiento bancario (InvoicePayment) y lo deja conciliado
//
// IVA: se registra sin IVA (iva:0), por decisión de MJ (la duda del crédito de
// IVA la resuelve el contador aparte; esto no la prejuzga — el total es el costo).
//
// SEGURIDAD:
//   - Lee el DATABASE_URL del archivo directo (§4.9) e imprime el HOST + el
//     marcador #64 = "Paseo del Sena". Aborta si no es la viva.
//   - DRY-RUN por default: imprime el plan sin escribir. Con --apply escribe.
//   - Idempotente: si el movimiento ya tiene un gasto colgado, lo saltea.
//
// Uso:
//   npx tsx scripts/conciliar-internacionales-anthropic-neon.ts .env.prod          (dry-run)
//   npx tsx scripts/conciliar-internacionales-anthropic-neon.ts .env.prod --apply  (escribe)
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { PrismaClient } from "@prisma/client";

const envPath = process.argv[2] ?? ".env.prod";
const APPLY = process.argv.includes("--apply");
const BLARQ_RUT = "77.270.733-9";
const CARPETA = join(homedir(), "Desktop/BLARQ-Contador/gastos-internacionales");

// Emparejamiento verificado a mano (movimiento ↔ factura). La clave es
// (fecha, monto) del movimiento; el monto es en pesos, positivo.
const PARES = [
  { fecha: "2026-04-22", monto: 105903, archivo: "anthropic/Invoice-AHVTTWWX-0002.pdf", emisor: "Anthropic PBC", folio: "AHVTTWWX-0002" },
  { fecha: "2026-05-22", monto: 109349, archivo: "anthropic/Invoice-AHVTTWWX-0003.pdf", emisor: "Anthropic PBC", folio: "AHVTTWWX-0003" },
  { fecha: "2026-06-01", monto: 5441, archivo: "anthropic/Invoice-BACAPETT-0001.pdf", emisor: "Anthropic PBC", folio: "BACAPETT-0001" },
  { fecha: "2026-06-22", monto: 110384, archivo: "anthropic/Invoice-AHVTTWWX-0004.pdf", emisor: "Anthropic PBC", folio: "AHVTTWWX-0004" },
  { fecha: "2026-07-22", monto: 114300, archivo: "anthropic/Invoice-AHVTTWWX-0005.pdf", emisor: "Anthropic PBC", folio: "AHVTTWWX-0005" },
  { fecha: "2026-07-01", monto: 4534, archivo: "neon/Invoice-UASFJS-00002.pdf", emisor: "Neon Inc", folio: "UASFJS-00002" },
];

const url = readFileSync(envPath, "utf8")
  .split("\n")
  .map((l) => l.match(/^\s*DATABASE_URL\s*=\s*"?([^"\n]+)"?\s*$/))
  .find(Boolean)![1];
const host = url.match(/@([^/]+)\//)?.[1] ?? "?";
const prisma = new PrismaClient({ datasources: { db: { url } } });

function pdfDataUrl(rel: string): string {
  const b64 = readFileSync(join(CARPETA, rel)).toString("base64");
  return `data:application/pdf;base64,${b64}`;
}

async function main() {
  console.log(`HOST: ${host}`);
  console.log(`MODO: ${APPLY ? "APLICAR (escribe)" : "DRY-RUN (no escribe)"}\n`);

  const p64 = await prisma.project.findFirst({ where: { numeroProyecto: 64 }, select: { name: true } });
  if (p64?.name !== "Paseo del Sena") {
    console.error("PARAR: el marcador #64 no es 'Paseo del Sena' → no es la base viva.");
    process.exit(1);
  }

  let creados = 0, saltados = 0;
  for (const par of PARES) {
    // Busco por monto exacto y comparo el día en UTC (las fechas del banco se
    // guardan como instante UTC; filtrar por rango en hora local se los salta).
    const candidatos = await prisma.bankMovement.findMany({
      where: { amount: -par.monto },
      select: {
        id: true, counterpartyName: true, description: true, date: true,
        payments: { select: { invoice: { select: { origin: true } } } },
      },
    });
    const movs = candidatos.filter(
      (m) => m.date.toISOString().slice(0, 10) === par.fecha
    );
    if (movs.length !== 1) {
      console.log(`⚠ ${par.fecha} $${par.monto.toLocaleString("es-CL")} → ${movs.length} movimientos (esperaba 1). SALTEO.`);
      saltados++;
      continue;
    }
    const mov = movs[0];
    const yaTiene = mov.payments.some((p) => p.invoice?.origin?.startsWith("gasto"));
    if (yaTiene) {
      console.log(`• ${par.fecha} $${par.monto.toLocaleString("es-CL")} ${par.emisor} → YA conciliado, salteo.`);
      saltados++;
      continue;
    }

    const dataUrl = pdfDataUrl(par.archivo);
    console.log(`${APPLY ? "✓" : "○"} ${par.fecha} $${par.monto.toLocaleString("es-CL")} ${par.emisor} (${par.folio}) + ${par.archivo} [${Math.round(dataUrl.length / 1024)}KB]`);

    if (APPLY) {
      await prisma.$transaction(async (tx) => {
        const inv = await tx.invoice.create({
          data: {
            type: "recibida", tipoDoc: 1043, folioNumber: par.folio,
            rutIssuer: null, rutReceiver: BLARQ_RUT, businessName: par.emisor,
            issueDate: mov.date, dueDate: mov.date,
            netAmount: par.monto, iva: 0, totalAmount: par.monto,
            status: "pagada", paidAt: mov.date, origin: "gasto_internacional",
            attachmentUrl: dataUrl,
            notes: "Servicio digital del exterior. Registrado desde el movimiento bancario con su factura.",
          },
          select: { id: true },
        });
        await tx.invoicePayment.create({
          data: { bankMovementId: mov.id, invoiceId: inv.id, amountApplied: par.monto },
        });
        await tx.bankMovement.update({
          where: { id: mov.id }, data: { status: "conciliado", category: null },
        });
      });
    }
    creados++;
  }

  console.log(`\n${APPLY ? "Creados" : "A crear"}: ${creados} · Salteados: ${saltados}`);
  if (!APPLY) console.log("Dry-run: no se escribió nada. Corré con --apply para aplicar.");
}

main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
