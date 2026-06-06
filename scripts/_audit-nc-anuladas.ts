// DIAGNÓSTICO SOLO-LECTURA (no commitear). Cuenta cuántas facturas están
// hoy en estado "anulada" pero tienen pagos reales del banco > 0 — es decir,
// las que bajo la regla nueva deberían quedar "pagada" (no anuladas).
//
// No escribe nada. Candado: aborta si la base no es prod (ep-shy-morning).

import { PrismaClient } from "@prisma/client";

const url = process.env.DATABASE_URL ?? "";
const isProd = /ep-shy-morning/.test(url);
if (!isProd) {
  console.error(
    "ABORTA: este conteo es contra PRODUCCIÓN. DATABASE_URL no apunta a ep-shy-morning."
  );
  process.exit(1);
}

const prisma = new PrismaClient();
const TOL = 10;

async function main() {
  console.log("Entorno: PROD (ep-shy-morning) | modo: SOLO LECTURA\n");

  // Todas las facturas anuladas, con sus pagos reales (banco) y las NC que
  // las referencian (appliedToInvoiceId apunta a esta factura).
  const anuladas = await prisma.invoice.findMany({
    where: { status: "anulada" },
    select: {
      id: true,
      type: true,
      tipoDoc: true,
      folioNumber: true,
      businessName: true,
      rutIssuer: true,
      totalAmount: true,
      payments: { select: { amountApplied: true } },
    },
  });

  // NC que apuntan a cada factura anulada (para saber si la anulación
  // vino de una NC y por cuánto).
  const ncs = await prisma.invoice.findMany({
    where: {
      tipoDoc: 61,
      appliedToInvoiceId: { in: anuladas.map((a) => a.id) },
    },
    select: { appliedToInvoiceId: true, totalAmount: true },
  });
  const ncByTarget = new Map<string, number>();
  for (const nc of ncs) {
    if (!nc.appliedToInvoiceId) continue;
    ncByTarget.set(
      nc.appliedToInvoiceId,
      (ncByTarget.get(nc.appliedToInvoiceId) ?? 0) + Math.abs(nc.totalAmount)
    );
  }

  let caso1 = 0; // pagada entera por banco + anulada (devolución mal-anulada)
  let caso2 = 0; // pagó una parte + anulada (saldada mal-anulada)
  let caso3 = 0; // no pagó nada + anulada (correcta / void)
  let sumCaso1 = 0,
    sumCaso2 = 0;
  const muestra: string[] = [];

  for (const inv of anuladas) {
    const realPaid = inv.payments.reduce((s, p) => s + p.amountApplied, 0);
    const total = Math.abs(inv.totalAmount);
    const ncCredit = ncByTarget.get(inv.id) ?? 0;
    let caso: 1 | 2 | 3;
    if (realPaid >= total - TOL) {
      caso = 1;
      caso1++;
      sumCaso1 += realPaid;
    } else if (realPaid > 0) {
      caso = 2;
      caso2++;
      sumCaso2 += realPaid;
    } else {
      caso = 3;
      caso3++;
    }
    if (caso !== 3 && muestra.length < 12) {
      muestra.push(
        `  [caso ${caso}] ${inv.type} F-${inv.folioNumber ?? "—"} ${
          inv.businessName ?? inv.rutIssuer ?? ""
        } | total $${Math.round(total).toLocaleString("es-CL")} | pagado banco $${Math.round(
          realPaid
        ).toLocaleString("es-CL")} | NC $${Math.round(ncCredit).toLocaleString("es-CL")}`
      );
    }
  }

  const clp = (n: number) => "$" + Math.round(n).toLocaleString("es-CL");

  console.log(`Facturas en estado "anulada": ${anuladas.length}`);
  console.log("");
  console.log(`Caso 1 — pagada ENTERA por banco y aun así anulada: ${caso1}`);
  console.log(`         (deberían ser "pagada" + devolución sin clasificar)`);
  console.log(`         plata real pagada involucrada: ${clp(sumCaso1)}`);
  console.log("");
  console.log(`Caso 2 — pagó una PARTE y luego anulada: ${caso2}`);
  console.log(`         (deberían ser "pagada"/saldada — no debe nada)`);
  console.log(`         plata real pagada involucrada: ${clp(sumCaso2)}`);
  console.log("");
  console.log(`Caso 3 — NO pagó nada, anulada: ${caso3}  (correctas, sin cambio)`);
  console.log("");
  console.log(`TOTAL mal-anuladas (caso 1 + caso 2): ${caso1 + caso2}`);
  console.log("");
  if (muestra.length) {
    console.log("Muestra (hasta 12):");
    console.log(muestra.join("\n"));
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
