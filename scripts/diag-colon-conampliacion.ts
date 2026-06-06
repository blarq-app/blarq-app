import "dotenv/config";
import { prisma } from "../src/lib/prisma";

/** SOLO LECTURA. Mapa del descuadre de Depto Colon "V1_Con ampliación". */
const r2 = (n: number) => Math.round(n * 100) / 100;

async function main() {
  const v = await prisma.budgetVersion.findFirst({
    where: {
      version: { contains: "Con ampliaci", mode: "insensitive" },
      project: { name: { contains: "Colon", mode: "insensitive" } },
    },
    select: { id: true, version: true, status: true },
  });
  if (!v) throw new Error("No se encontró la versión Con ampliación");
  console.log(`Versión: ${v.version} [${v.status}]  id=${v.id}\n`);

  const items = await prisma.obraItem.findMany({
    where: { budgetVersionId: v.id },
    orderBy: [{ chapter: "asc" }, { itemNumber: "asc" }],
  });

  let descuadradas = 0;
  let totalCliente = 0;
  let totalDesglose = 0;
  for (const it of items) {
    const comps = await prisma.obraItemComponent.findMany({ where: { obraItemId: it.id } });
    const sum = comps.reduce((s, c) => s + c.totalCost, 0);
    const pu = it.unitPrice ?? 0;
    const drift = pu - sum;
    totalCliente += (it.total ?? 0);
    totalDesglose += sum * (it.quantity ?? 0);
    const flag = Math.abs(drift) > 1 ? (comps.length === 0 ? "⚠ SIN DESGLOSE" : "⚠ DESCUADRE") : "✓";
    if (Math.abs(drift) > 1) descuadradas++;
    console.log(`${(it.itemNumber || "").padEnd(5)} ${(it.name || "").slice(0, 38).padEnd(38)} P.U.guardado=${String(r2(pu)).padStart(9)} desglose=${String(r2(sum)).padStart(9)} drift=${String(r2(drift)).padStart(9)} comps=${comps.length} ${flag}`);
  }
  console.log(`\nPartidas: ${items.length} | descuadradas: ${descuadradas}`);
  console.log(`Total al cliente (suma de totales guardados): ${r2(totalCliente)}`);
  console.log(`Total si viniera del desglose:                 ${r2(totalDesglose)}`);
  console.log(`Diferencia (lo que el desglose NO refleja):    ${r2(totalCliente - totalDesglose)}`);
}
main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
