// READ-ONLY. Detecta movimientos bancarios probablemente duplicados por el
// bug de dedup por saldo corrido (ver src/lib/banco/dedup.ts). NO borra ni
// modifica nada.
//
// Agrupa por la huella estable (fecha + monto + contraparte). Dentro de cada
// grupo con 2+ filas distingue:
//   - GEMELO LEGÍTIMO: las filas se crearon en la MISMA importación
//     (createdAt junto, < 1h). Probable: dos transferencias reales iguales
//     el mismo día. NO tocar.
//   - DUPLICADO PROBABLE: las filas se crearon en importaciones distintas
//     (createdAt separado > 1h). Probable: el mismo movimiento importado dos
//     veces desde cartolas que se solapan.
// La clasificación es una pista; la decisión final la toma MJ.
//
// Uso (dev):   npx tsx scripts/diagnostico-dup-cartolas.ts
//      (prod): DATABASE_URL="$(grep -m1 '^DATABASE_URL=' .env.prod | cut -d= -f2- | tr -d '\"')" npx tsx scripts/diagnostico-dup-cartolas.ts

import "dotenv/config";
import { prisma } from "../src/lib/prisma";
import { movementFingerprint } from "../src/lib/banco/dedup";

const fmtCLP = (n: number) =>
  new Intl.NumberFormat("es-CL", { style: "currency", currency: "CLP", maximumFractionDigits: 0 }).format(n);
const fmtDate = (d: Date) => d.toISOString().slice(0, 10);
const fmtTime = (d: Date) => d.toISOString().slice(0, 16).replace("T", " ");

function env(): string {
  const u = process.env.DATABASE_URL ?? "";
  if (/ep-shy-morning/.test(u)) return "PROD";
  if (/ep-solitary-mud/.test(u)) return "dev";
  return "desconocido";
}

async function main() {
  console.log(`Base: ${env()}  (host ${(process.env.DATABASE_URL ?? "").match(/@([^/?]+)/)?.[1] ?? "—"})\n`);
  const accounts = await prisma.bankAccount.findMany();
  const accById = new Map(accounts.map((a) => [a.id, a]));

  const movements = await prisma.bankMovement.findMany({
    orderBy: [{ date: "asc" }, { createdAt: "asc" }],
    include: { payments: { select: { id: true } } },
  });
  console.log(`Total movimientos: ${movements.length}  ·  cuentas: ${accounts.map((a) => a.alias).join(", ")}\n`);

  // Agrupar por (cuenta, huella estable).
  const groups = new Map<string, typeof movements>();
  for (const m of movements) {
    const fp = `${m.bankAccountId}::${movementFingerprint(m)}`;
    const arr = groups.get(fp) ?? [];
    arr.push(m);
    groups.set(fp, arr);
  }

  const dupGroups = [...groups.values()].filter((g) => g.length > 1);
  dupGroups.sort((a, b) => a[0].date.getTime() - b[0].date.getTime());

  let probables = 0, gemelos = 0, dineroProbable = 0, conPago = 0;

  for (const g of dupGroups) {
    const acc = accById.get(g[0].bankAccountId);
    const spreadMs = Math.max(...g.map((m) => m.createdAt.getTime())) - Math.min(...g.map((m) => m.createdAt.getTime()));
    const esProbable = spreadMs > 60 * 60 * 1000;
    const extra = g.length - 1;
    if (esProbable) { probables += extra; dineroProbable += Math.abs(g[0].amount) * extra; }
    else gemelos += extra;

    console.log("─".repeat(80));
    console.log(`[${esProbable ? "DUPLICADO PROBABLE" : "GEMELO LEGÍTIMO"}]  ${fmtDate(g[0].date)}  ${fmtCLP(g[0].amount)}  ·  ${acc?.alias ?? "?"}  (${g.length} filas)`);
    for (const m of g) {
      const pagos = m.payments.length;
      if (pagos > 0) conPago++;
      console.log(`   · id=${m.id}  status=${m.status}  creado=${fmtTime(m.createdAt)}  ${pagos > 0 ? `IMPUTADO(${pagos})` : "sin imputar"}  bal=${m.balanceAfter ?? "—"}`);
      console.log(`     "${m.description}"`);
    }
  }

  console.log("─".repeat(80));
  console.log("\nRESUMEN");
  console.log(`  Grupos con 2+ filas de igual huella: ${dupGroups.length}`);
  console.log(`  Filas de más marcadas DUPLICADO PROBABLE: ${probables}  (${fmtCLP(dineroProbable)})`);
  console.log(`  Filas de más marcadas GEMELO LEGÍTIMO (NO tocar): ${gemelos}`);
  if (conPago > 0) console.log(`  OJO: ${conPago} de las filas en estos grupos tienen pagos imputados — revisar antes de limpiar.`);
  if (probables === 0) console.log("\n  No hay duplicados probables. Nada que limpiar.");
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
