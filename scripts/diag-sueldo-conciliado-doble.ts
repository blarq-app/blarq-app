// Diagnóstico SOLO LECTURA. Encuentra los movimientos bancarios que tienen a la
// vez (a) una categoría de PAGO A SOCIO (sueldo / retiro_personal / bono_socio /
// prestamo_socio) y (b) al menos una imputación a factura (InvoicePayment). Esos
// son reembolsos ya conciliados que se quedaron con el rótulo de sueldo/pago-a-
// socio que sugirió el import — no se pueden ser las dos cosas a la vez.
//
// NO escribe nada. Lee DATABASE_URL directo del archivo que se le pasa por
// argumento (NO confía en el nombre del archivo) e imprime el HOST para
// confirmar contra cuál base está corriendo.
//
// Uso: npx tsx scripts/diag-sueldo-conciliado-doble.ts <ruta-env>
import { PrismaClient } from "@prisma/client";
import { readFileSync } from "fs";

const CATEGORIAS_PAGO_SOCIO = ["sueldo", "retiro_personal", "bono_socio", "prestamo_socio"];

const envPath = process.argv[2];
if (!envPath) {
  console.error("Falta la ruta al .env. Uso: npx tsx scripts/diag-sueldo-conciliado-doble.ts <ruta-env>");
  process.exit(1);
}
const raw = readFileSync(envPath, "utf8");
const m = raw.match(/DATABASE_URL\s*=\s*"?([^"\n]+)"?/);
if (!m) {
  console.error("no DATABASE_URL en", envPath);
  process.exit(1);
}
const url = m[1].trim();
const host = url.match(/@([^/.]+)/)?.[1] ?? "?";

const prisma = new PrismaClient({ datasources: { db: { url } } });

const clp = (n: number) => "$" + Math.round(n).toLocaleString("es-CL");

async function main() {
  console.log("=== ENV:", envPath, "| HOST:", host, "===");

  // Marcador de la base viva (§4.9): proyecto #64 debe ser "Paseo del Sena".
  const p64 = await prisma.project.findFirst({
    where: { numeroProyecto: 64 },
    select: { name: true },
  });
  console.log(`Marcador base viva → #64 = ${p64?.name ?? "(no existe)"}`);
  console.log(host.includes("shy-morning") ? "  → es la base VIVA" : "  → NO es la viva (dev/copia)");
  console.log("");

  const movs = await prisma.bankMovement.findMany({
    where: {
      category: { in: CATEGORIAS_PAGO_SOCIO },
      payments: { some: {} }, // tiene al menos una imputación a factura
    },
    select: {
      id: true,
      date: true,
      amount: true,
      category: true,
      counterpartyName: true,
      counterpartyRut: true,
      description: true,
      status: true,
      payments: {
        select: {
          amountApplied: true,
          autoMatched: true,
          invoice: {
            select: {
              folioNumber: true,
              tipoDoc: true,
              origin: true,
              businessName: true,
              type: true,
            },
          },
        },
      },
    },
    orderBy: { date: "asc" },
  });

  console.log(`MOVIMIENTOS con categoría pago-a-socio + imputados a factura: ${movs.length}`);
  console.log("");

  let sumTotal = 0;
  const porCat: Record<string, { n: number; monto: number }> = {};
  let conFacturaSII = 0;
  let conSolo1043 = 0;

  for (const mv of movs) {
    const monto = Math.abs(mv.amount);
    sumTotal += monto;
    porCat[mv.category!] ??= { n: 0, monto: 0 };
    porCat[mv.category!].n++;
    porCat[mv.category!].monto += monto;

    // ¿Alguna de las facturas imputadas es una factura REAL del SII (tipoDoc
    // != 1043) o todas son 1043 (pago sin documento / boleta / internacional)?
    const tieneSII = mv.payments.some((pp) => pp.invoice.tipoDoc !== 1043);
    if (tieneSII) conFacturaSII++;
    else conSolo1043++;

    const facturas = mv.payments
      .map((pp) => {
        const inv = pp.invoice;
        const tipo = inv.tipoDoc === 1043 ? `1043/${inv.origin ?? "?"}` : `SII ${inv.tipoDoc}`;
        return `F-${inv.folioNumber ?? "?"} [${tipo}] ${inv.businessName ?? ""} (${clp(pp.amountApplied)}${pp.autoMatched ? ", auto" : ""})`;
      })
      .join(" · ");

    console.log(
      `${mv.date.toISOString().slice(0, 10)} | ${mv.category} | ${clp(monto)} | ` +
        `${(mv.counterpartyName ?? "—").slice(0, 24)} | estado:${mv.status}`
    );
    console.log(`    glosa: ${(mv.description ?? "").slice(0, 70)}`);
    console.log(`    → ${facturas}`);
  }

  console.log("");
  console.log("═══════════════ RESUMEN ═══════════════");
  console.log(`Total a corregir: ${movs.length} movimientos · ${clp(sumTotal)}`);
  console.log("Por categoría:");
  for (const [cat, v] of Object.entries(porCat)) {
    console.log(`  ${cat.padEnd(18)} ${String(v.n).padStart(3)}  ${clp(v.monto)}`);
  }
  console.log(`Imputados a ≥1 factura real del SII: ${conFacturaSII}`);
  console.log(`Imputados SOLO a doc interno 1043:   ${conSolo1043}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
