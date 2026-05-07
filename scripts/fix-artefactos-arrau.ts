// Fix puntual Arrau: los realCostBlarq de los 3 artefactos venían mal
// cargados del Excel V5 (costo mayorista sin despacho). En la realidad
// no hubo margen entre costo y venta — los despachos consumieron la
// diferencia. Convención: igualar realCostBlarq a clientPrice/1.19 (neto)
// para que la card "Presupuestado" muestre el costo real esperado.
//
// Aplica en cualquier BD que apunte DATABASE_URL. Idempotente.

import "dotenv/config";
import { prisma } from "../src/lib/prisma";

async function main() {
  const arrau = await prisma.project.findFirst({ where: { name: { contains: "Arrau" } } });
  if (!arrau) { console.log("Arrau no existe"); return; }

  const items = await prisma.artefactoItem.findMany({
    where: { budgetVersion: { projectId: arrau.id, type: "artefactos" } },
  });

  console.log(`Encontrados ${items.length} artefactos en Arrau:`);
  for (const it of items) {
    const expected = it.clientPrice / 1.19;
    const change = expected - (it.realCostBlarq ?? 0);
    console.log(`  ${it.name} (${it.subcategory})`);
    console.log(`    clientPrice=$${it.clientPrice.toLocaleString("es-CL")}`);
    console.log(`    realCostBlarq actual=$${(it.realCostBlarq ?? 0).toLocaleString("es-CL")} → nuevo=$${expected.toLocaleString("es-CL")} (Δ $${change.toLocaleString("es-CL")})`);
    await prisma.artefactoItem.update({
      where: { id: it.id },
      data: { realCostBlarq: expected },
    });
  }
  console.log("Aplicado.");

  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
