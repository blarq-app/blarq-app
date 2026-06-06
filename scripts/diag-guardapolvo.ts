import "dotenv/config";
import { prisma } from "../src/lib/prisma";

/**
 * SOLO LECTURA. No escribe nada. Diagnostica la partida "guardapolvo
 * porcelanato": compara los montos globales (lump cost*) contra el desglose por
 * componente, en el catálogo y en las cotizaciones que la usan. Sirve para
 * entender por qué la pérdida aparece arriba pero no en la lista del desglose.
 */

function host() {
  const u = process.env.DATABASE_URL || "";
  const m = u.match(/@([^/.]+)/);
  return m ? m[1] : "desconocido";
}

const NEEDLE = "GUARDAPOLVO PORCELANATO";

async function main() {
  console.log(`Conectado a host: ${host()} (solo lectura)\n`);

  // ── Catálogo ──
  const cats = await prisma.partidaCatalog.findMany({
    where: { name: { contains: NEEDLE, mode: "insensitive" } },
  });
  console.log(`Partidas de CATÁLOGO que matchean "${NEEDLE}": ${cats.length}`);
  for (const cat of cats) {
    console.log(`\n  [CATÁLOGO] ${cat.name}  (id ${cat.id})`);
    console.log(`    lump → Material ${cat.costMaterial} | MO ${cat.costLabor} | Herr ${cat.costTools} | Subc ${cat.costSubcontract} | Pérdida ${cat.costLoss} | Margen ${cat.costMargin} | P.U. ${cat.unitPrice}`);
    const comps = await prisma.partidaComponent.findMany({ where: { partidaId: cat.id }, orderBy: { sortOrder: "asc" } });
    console.log(`    desglose: ${comps.length} líneas`);
    for (const c of comps) {
      console.log(`      - ${c.type.padEnd(12)} "${c.description}"  ${c.quantity}${c.unit}  total ${c.totalCost}  ${c.appliedToComponentId ? "→aplica:" + c.appliedToComponentId : ""}`);
    }
    const perdComp = comps.filter((c) => c.type === "perdida").reduce((s, c) => s + c.totalCost, 0);
    console.log(`    >> costLoss lump = ${cat.costLoss} ; suma de componentes pérdida = ${perdComp} ${cat.costLoss !== perdComp ? "  ⚠ NO COINCIDEN" : "✓"}`);
  }

  // ── Cotizaciones (ObraItem) ──
  const items = await prisma.obraItem.findMany({
    where: { name: { contains: NEEDLE, mode: "insensitive" } },
    include: { budgetVersion: { include: { project: { select: { name: true } } } } },
  });
  console.log(`\n\nObraItems (en cotizaciones) que matchean: ${items.length}`);
  for (const it of items) {
    console.log(`\n  [COTIZACIÓN] ${it.budgetVersion.project?.name} / ${it.budgetVersion.version} (${it.budgetVersion.status})  item ${it.id}`);
    console.log(`    catalogPartidaId: ${it.catalogPartidaId ?? "NULL (no vinculada)"}`);
    console.log(`    lump → Material ${it.costMaterial} | MO ${it.costLabor} | Herr ${it.costTools} | Subc ${it.costSubcontract} | Pérdida ${it.costLoss} | Margen ${it.costMargin} | P.U. ${it.unitPrice}`);
    const comps = await prisma.obraItemComponent.findMany({ where: { obraItemId: it.id }, orderBy: { sortOrder: "asc" } });
    console.log(`    desglose: ${comps.length} líneas`);
    for (const c of comps) {
      console.log(`      - ${c.type.padEnd(12)} "${c.description}"  ${c.quantity}${c.unit}  total ${c.totalCost}  ${c.appliedToComponentId ? "→aplica:" + c.appliedToComponentId : ""}  ${c.isCustomized ? "[mod]" : ""}`);
    }
    const perdComp = comps.filter((c) => c.type === "perdida").reduce((s, c) => s + c.totalCost, 0);
    console.log(`    >> costLoss lump = ${it.costLoss} ; suma de componentes pérdida = ${perdComp} ${it.costLoss !== perdComp ? "  ⚠ NO COINCIDEN (la pérdida es lump huérfano, sin línea)" : "✓"}`);
  }
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(async () => { await prisma.$disconnect(); });
