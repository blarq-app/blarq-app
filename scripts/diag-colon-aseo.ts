import "dotenv/config";
import { prisma } from "../src/lib/prisma";

/** SOLO LECTURA. Estado de las versiones de Depto Colon + la partida ASEO. */
const r2 = (n: number) => Math.round(n * 100) / 100;

async function main() {
  const projects = await prisma.project.findMany({
    where: { name: { contains: "Colon", mode: "insensitive" } },
    select: { id: true, name: true },
  });
  for (const p of projects) {
    const versions = await prisma.budgetVersion.findMany({
      where: { projectId: p.id },
      select: { id: true, version: true, type: true, status: true, sentAt: true },
      orderBy: { createdAt: "asc" },
    });
    console.log(`\nProyecto: ${p.name}`);
    for (const v of versions) {
      console.log(`  - ${v.version} [${v.type}] status=${v.status} ${v.sentAt ? "sentAt=" + v.sentAt.toISOString().slice(0, 10) : ""}`);
    }
  }

  // Partida ASEO en cualquier versión de Colon.
  const items = await prisma.obraItem.findMany({
    where: {
      name: { contains: "ASEO", mode: "insensitive" },
      budgetVersion: { project: { name: { contains: "Colon", mode: "insensitive" } } },
    },
    include: { budgetVersion: { select: { version: true, status: true } } },
  });
  console.log(`\n\nPartidas ASEO en Colon: ${items.length}`);
  for (const it of items) {
    const comps = await prisma.obraItemComponent.findMany({ where: { obraItemId: it.id }, orderBy: { sortOrder: "asc" } });
    const sum = comps.reduce((s, c) => s + c.totalCost, 0);
    console.log(`\n  ${it.budgetVersion.version} (${it.budgetVersion.status})  "${it.name}"`);
    console.log(`    P.U. guardado = ${r2(it.unitPrice ?? 0)} | total = ${r2(it.total ?? 0)} | suma desglose = ${r2(sum)} ${Math.abs((it.unitPrice ?? 0) - sum) > 1 ? "  ⚠ DESCUADRE" : "✓"}`);
    for (const c of comps) console.log(`      - ${c.type} "${c.description}" ${c.quantity}${c.unit} = ${r2(c.totalCost)}`);
  }
}
main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
