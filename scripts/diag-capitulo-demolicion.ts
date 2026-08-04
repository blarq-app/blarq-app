// SOLO LECTURA sobre la viva.
import { readFileSync } from "fs";
import { PrismaClient } from "@prisma/client";
const URL_VIVA = readFileSync("/Users/mjblanco/Desktop/blarq-app/.env.prod", "utf8")
  .match(/DATABASE_URL\s*=\s*"?([^"\n]+)"?/)![1].trim();
const prisma = new PrismaClient({ datasources: { db: { url: URL_VIVA } } });

async function main() {
  if (!URL_VIVA.includes("shy-morning")) throw new Error("no es la viva");
  const raros = await prisma.obraChapter.findMany({
    where: { name: { in: ["DEMOLICION", "INSTALACIONES SANITARIAS (GASFITERIA, SANITARIO Y GAS)"] } },
    include: {
      _count: { select: { items: true } },
      budgetVersion: {
        select: {
          id: true, version: true, status: true, type: true,
          project: { select: { numeroProyecto: true, name: true, status: true } },
          obraChapters: { select: { id: true, name: true, sortOrder: true, _count: { select: { items: true } } }, orderBy: { sortOrder: "asc" } },
        },
      },
    },
  });
  for (const c of raros) {
    const bv = c.budgetVersion;
    console.log(`\n=== "${c.name}" (${c._count.items} partidas) ===`);
    console.log(`Obra #${bv.project?.numeroProyecto} ${bv.project?.name} (proyecto: ${bv.project?.status})`);
    console.log(`Presupuesto ${bv.type} ${bv.version} — estado: ${bv.status.toUpperCase()}`);
    console.log("Capítulos de ESA versión:");
    for (const o of bv.obraChapters) {
      const marca = o.id === c.id ? "  <<< este" : "";
      console.log(`   ${String(o.sortOrder).padStart(2)}. ${o.name.padEnd(48)} ${String(o._count.items).padStart(3)} partidas${marca}`);
    }
  }
}
main().catch(console.error).finally(() => prisma.$disconnect());
