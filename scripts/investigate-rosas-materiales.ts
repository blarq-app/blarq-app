import "dotenv/config";
import { prisma } from "../src/lib/prisma";

async function main() {
  const project = await prisma.project.findFirst({
    where: { name: { contains: "rosas", mode: "insensitive" } },
  });
  if (!project) {
    console.log("No se encontró proyecto que contenga 'rosas' en el nombre.");
    return;
  }
  console.log(`Proyecto: ${project.name} (id ${project.id})\n`);

  const materiales = await prisma.costCategory.findFirst({
    where: { name: "Materiales", parentId: null },
    include: { children: true },
  });
  if (!materiales) {
    console.log("No existe la categoría top 'Materiales'.");
    return;
  }
  const catIds = [materiales.id, ...materiales.children.map((c) => c.id)];

  const facturas = await prisma.invoice.findMany({
    where: {
      projectId: project.id,
      type: "recibida",
      categoryId: { in: catIds },
    },
    include: { category: true },
    orderBy: { issueDate: "asc" },
  });

  let sumaNeto = 0;
  let sumaIva = 0;
  let sumaTotal = 0;
  console.log(
    "fecha       tipo  folio        rut            razon                         neto        iva       total      ratio  flag"
  );
  for (const f of facturas) {
    const ratio = f.netAmount > 0 ? f.totalAmount / f.netAmount : 0;
    const flag = Math.abs(ratio - 1.19) > 0.005 ? " ***" : "";
    sumaNeto += f.netAmount;
    sumaIva += f.iva ?? 0;
    sumaTotal += f.totalAmount;
    const fecha = f.issueDate?.toISOString().slice(0, 10) ?? "—".padEnd(10);
    const tipo = String(f.tipoDoc ?? "—").padEnd(4);
    console.log(
      `${fecha}  ${tipo}  ${String(f.folioNumber ?? "").padEnd(11)}  ${(f.rutIssuer ?? "").padEnd(12)}  ${(f.businessName ?? "").slice(0, 28).padEnd(28)}  ${String(f.netAmount).padStart(10)}  ${String(f.iva ?? 0).padStart(8)}  ${String(f.totalAmount).padStart(10)}  ${ratio.toFixed(3)}${flag}`
    );
  }
  console.log(
    `\nSuma: neto ${sumaNeto.toLocaleString("es-CL")} · iva ${sumaIva.toLocaleString("es-CL")} · total ${sumaTotal.toLocaleString("es-CL")}`
  );
  console.log(
    `Ratio total/neto: ${(sumaTotal / sumaNeto).toFixed(4)} (esperado 1.1900 si todas tienen IVA)`
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
