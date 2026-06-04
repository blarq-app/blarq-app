/**
 * SOLO LECTURA (prod). Trae del catálogo las partidas relevantes para
 * restaurar la sección de gas de Depto Colon V1, y el detalle de las 2
 * partidas que driftearon (módulo, porcelanato), para ver qué tan lejos
 * está el catálogo del P.U. del PDF. NO escribe nada.
 */
import { config } from "dotenv";
config({ path: ".env.prod", override: true });
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const host = (process.env.DATABASE_URL || "").match(/@([^/]+)/)?.[1] ?? "??";
  if (!host.includes("ep-shy-morning")) {
    console.error("ABORTO: no es prod. host=" + host);
    process.exit(1);
  }
  console.log(">>> prod host:", host);

  const NEEDLES = [
    "encimera",
    "llave de paso",
    "tuber",
    "modulo",
    "porcelanato",
  ];
  const partidas = await prisma.partidaCatalog.findMany({
    where: { OR: NEEDLES.map((n) => ({ name: { contains: n, mode: "insensitive" as const } })) },
    orderBy: { name: "asc" },
    include: { components: { orderBy: { sortOrder: "asc" } } },
  });

  for (const p of partidas) {
    console.log(`\n[${p.id}] ${p.name} — ${p.unit} — PU ${Math.round(p.unitPrice)} — total cost mat=${p.costMaterial} mo=${p.costLabor} herr=${p.costTools} sub=${p.costSubcontract} margen=${p.costMargin} perdida=${p.costLoss}`);
    for (const c of p.components) {
      console.log(`    - ${c.type} | "${c.description}" | ${c.unit} | q=${c.quantity} | uc=${c.unitCost} | tc=${c.totalCost} | mat=${c.materialId ? "sí" : "—"} appliedTo=${c.appliedToComponentId ?? "—"}/${c.appliedToType ?? "—"}`);
    }
  }
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
