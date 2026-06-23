import "dotenv/config";
import { prisma } from "../src/lib/prisma";
async function main() {
  const p = await prisma.project.findFirst({
    where: { name: { contains: "Paseo del Sena", mode: "insensitive" } },
    select: { id: true, name: true },
  });
  if (!p) return;
  const bvs = await prisma.budgetVersion.findMany({
    where: { projectId: p.id, type: "muebles" },
    select: { id: true, version: true, status: true },
  });
  for (const bv of bvs) {
    const items = await prisma.muebleItem.findMany({
      where: { chapter: { budgetVersionId: bv.id } },
      select: {
        id: true, name: true,
        chapter: { select: { name: true } },
        details: { select: { id: true, name: true, material: true, sortOrder: true }, orderBy: { sortOrder: "asc" } },
      },
    });
    console.log(`\n=== muebles ${bv.version} (${bv.status}) ===`);
    for (const it of items) {
      console.log(`  [${it.chapter.name}] ${it.name} (item ${it.id}) — ${it.details.length} comp`);
      for (const d of it.details) {
        console.log(`      comp ${d.id}  name="${d.name}"  material="${d.material}"  sort=${d.sortOrder}`);
      }
    }
  }
}
main().catch(e => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
