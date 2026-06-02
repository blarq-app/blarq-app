// Importa las Boletas de Honorarios Electrónicas (BHE) RECIBIDAS por BLARQ,
// bajadas del SII (loa.sii.cl) manejando el Chrome de MJ (2026-06-02).
//
// Decisiones de MJ (2026-06-02):
//   - Costo = BRUTO (el honorario completo; la retención se entera al SII).
//   - Las 2 boletas de honorarios de MJ (ene/feb) SÍ se importan como gasto.
//
// Modelo: cada BHE -> Invoice type="recibida", tipoDoc=1039 (convención interna
// para honorarios, igual que 1043 para mano de obra sin documento), sin IVA,
// totalAmount = netAmount = BRUTO. projectId/categoryId quedan null: MJ asigna
// la obra después, como con cualquier factura del SII. La retención NO se
// modela como campo (sin cambio de schema); el bruto ya captura el costo.
//
// Idempotente por (type, tipoDoc=1039, folioNumber, rutIssuer):
//   - si no existe -> crea (status "pendiente").
//   - si existe con un total distinto (las 2 de la ronda 39 quedaron al
//     LÍQUIDO) -> actualiza el monto al BRUTO; conserva status/projectId.
//
// CANDADOS: dry-run por default; --apply escribe. Solo corre contra PROD
// (ep-shy-morning) explícito. Verifica el delta de gasto recibidas.
//
// Uso:
//   dry-run dev/prod:  npx tsx scripts/importar-bhe.ts
//   aplicar a PROD:    DATABASE_URL="$(grep -m1 '^DATABASE_URL=' .env.prod | cut -d= -f2- | tr -d '\"')" npx tsx scripts/importar-bhe.ts --apply

import "dotenv/config";
import { prisma } from "../src/lib/prisma";

const APPLY = process.argv.includes("--apply");
const BLARQ_RUT = "77270733-9";

// Boletas bajadas del SII (informe mensual de BHE recibidas). Monto = BRUTO.
// `ret`/`pagado` se guardan solo como referencia en el log (no en BD).
const BOLETAS = [
  { folio: "18",       rut: "18023983-9", name: "MARIA JOSE BLANCO ROGAT",        date: "2025-01-30", bruto: 2339181, ret: 339181, pagado: 2000000 },
  { folio: "20",       rut: "18023983-9", name: "MARIA JOSE BLANCO ROGAT",        date: "2025-02-28", bruto: 2339181, ret: 339181, pagado: 2000000 },
  { folio: "14302251", rut: "60306045-8", name: "CONSERVADOR DE BIENES RAICES",   date: "2025-06-03", bruto: 2300,    ret: 0,      pagado: 2300 },
  { folio: "843",      rut: "12043874-3", name: "CHRISTIAN ANDRES YEVENES MORENO", date: "2025-07-10", bruto: 35088,  ret: 5088,   pagado: 30000 },
  { folio: "1",        rut: "23970083-7", name: "RUBEN AMADOR SORIANO",           date: "2025-07-26", bruto: 751000,  ret: 108895, pagado: 642105 },
  { folio: "567",      rut: "17409279-6", name: "DENISE SOFIA MARIA HEIRMAN ROA", date: "2025-08-25", bruto: 385965,  ret: 55965,  pagado: 330000 },
  { folio: "589",      rut: "17409279-6", name: "DENISE SOFIA MARIA HEIRMAN ROA", date: "2025-10-15", bruto: 116959,  ret: 16959,  pagado: 100000 },
  { folio: "94",       rut: "16531516-2", name: "JUAN FRANCISCO HILLBRECHT ELLI", date: "2026-03-06", bruto: 79650,   ret: 12147,  pagado: 67503 },
  { folio: "14",       rut: "20445752-2", name: "JUAN PABLO COSTA AGUIRRE",       date: "2026-03-31", bruto: 353982,  ret: 53982,  pagado: 300000 },
];

function inferEnv(): string {
  const u = process.env.DATABASE_URL ?? "";
  if (/ep-shy-morning/.test(u)) return "prod";
  if (/ep-solitary-mud/.test(u)) return "dev";
  return "unknown";
}

// Gasto bruto de recibidas no-anuladas (NC restan): la métrica que cuidamos (§4.1).
async function gastoRecibidas(): Promise<number> {
  const invs = await prisma.invoice.findMany({
    where: { type: "recibida", status: { not: "anulada" } },
    select: { tipoDoc: true, totalAmount: true },
  });
  return invs.reduce((s, i) => s + (i.tipoDoc === 61 ? -1 : 1) * i.totalAmount, 0);
}

async function main() {
  const env = inferEnv();
  console.log(`\n=== Importar BHE recibidas — entorno: ${env.toUpperCase()} — modo: ${APPLY ? "APLICAR" : "DRY-RUN"} ===\n`);
  if (APPLY && env !== "prod") {
    throw new Error("--apply solo permitido contra PROD (ep-shy-morning). Abortado.");
  }

  const gastoAntes = await gastoRecibidas();
  console.log(`Gasto recibidas no-anuladas ANTES: $${gastoAntes.toLocaleString("es-CL")}\n`);

  let toCreate = 0, toUpdate = 0, unchanged = 0, deltaGasto = 0;

  for (const b of BOLETAS) {
    const existing = await prisma.invoice.findFirst({
      where: { type: "recibida", tipoDoc: 1039, folioNumber: b.folio, rutIssuer: b.rut },
    });
    const etq = `BHE f${b.folio} ${b.name} ${b.date} bruto $${b.bruto.toLocaleString("es-CL")} (ret $${b.ret.toLocaleString("es-CL")}, líq $${b.pagado.toLocaleString("es-CL")})`;

    if (!existing) {
      toCreate++;
      deltaGasto += b.bruto;
      console.log(`  [CREAR]      ${etq}`);
      if (APPLY) {
        await prisma.invoice.create({
          data: {
            type: "recibida", tipoDoc: 1039, folioNumber: b.folio,
            rutIssuer: b.rut, rutReceiver: BLARQ_RUT, businessName: b.name,
            issueDate: new Date(`${b.date}T00:00:00.000Z`),
            netAmount: b.bruto, iva: 0, totalAmount: b.bruto,
            status: "pendiente", origin: "sii_automatica", syncedAt: new Date(),
          },
        });
      }
    } else if (existing.totalAmount !== b.bruto) {
      toUpdate++;
      deltaGasto += b.bruto - existing.totalAmount;
      console.log(`  [ACTUALIZAR] ${etq}  (estaba $${existing.totalAmount.toLocaleString("es-CL")} → bruto; obra=${existing.projectId ? "SÍ" : "—"}, status=${existing.status})`);
      if (APPLY) {
        await prisma.invoice.update({
          where: { id: existing.id },
          data: { netAmount: b.bruto, totalAmount: b.bruto },
        });
      }
    } else {
      unchanged++;
      console.log(`  [OK ya está] ${etq}`);
    }
  }

  console.log(`\nResumen: crear ${toCreate} · actualizar ${toUpdate} · sin cambio ${unchanged}`);
  console.log(`Delta gasto recibidas esperado: +$${deltaGasto.toLocaleString("es-CL")}`);

  if (APPLY) {
    const gastoDespues = await gastoRecibidas();
    console.log(`\nGasto recibidas DESPUÉS: $${gastoDespues.toLocaleString("es-CL")}  (delta real: +$${(gastoDespues - gastoAntes).toLocaleString("es-CL")})`);
    if (gastoDespues - gastoAntes !== deltaGasto) {
      console.log("⚠ El delta real NO coincide con el esperado — revisar.");
    } else {
      console.log("✓ Delta coincide con lo esperado.");
    }
  } else {
    console.log("\n(DRY-RUN — no se escribió nada. Las boletas quedan SIN obra asignada: MJ las asigna después.)");
  }

  await prisma.$disconnect();
}

main().catch((e) => { console.error("ERROR:", e?.message ?? e); process.exit(1); });
