// Reclasificación one-shot de los 5 proyectos auto-creados durante los
// imports de Maxxa (28-29 abr 2026). MJ confirmó que en realidad eran:
//
//   - Martín de Zamora (51) → terminado
//   - Cerro San Luis (55) → terminado
//   - Vitacura 81 (56) → terminado
//   - Arquitectura Guanay (61) → terminado (era solo arquitectura, ya entregado)
//   - CASA → ya quedó isInternal=true (no requiere cambio adicional)
//
// El script no borra ni modifica facturas/EPs/presupuestos — solo cambia
// status. Idempotente: si ya está terminado, no hace nada.
//
// Uso: npx tsx scripts/reclasify-imported-projects.ts [--apply]

import { prisma } from "../src/lib/prisma";

const APPLY = process.argv.includes("--apply");

const RECLASIFICATIONS: Array<{
  matchName: string;
  newStatus: "terminado";
}> = [
  { matchName: "Martin de Zamora", newStatus: "terminado" },
  { matchName: "Cerro San Luis", newStatus: "terminado" },
  { matchName: "Vitacura 81", newStatus: "terminado" },
  { matchName: "Arquitectura Guanay", newStatus: "terminado" },
];

async function main() {
  console.log(APPLY ? "🚀 APPLY mode\n" : "🔍 DRY RUN\n");

  // Verificar CASA: debería estar como interno
  const casa = await prisma.project.findFirst({ where: { name: "CASA" } });
  if (casa) {
    if (casa.isInternal) {
      console.log(`✓ CASA ya está como isInternal=true`);
    } else {
      console.log(`⚠ CASA NO está como interno — corrigiendo`);
      if (APPLY) {
        await prisma.project.update({
          where: { id: casa.id },
          data: { isInternal: true, numeroProyecto: null },
        });
      }
    }
  } else {
    console.log(`· CASA no existe en DB`);
  }

  // Reclasificar los 4 a terminado
  for (const r of RECLASIFICATIONS) {
    const p = await prisma.project.findFirst({ where: { name: r.matchName } });
    if (!p) {
      console.log(`  ⚠ ${r.matchName} no encontrado`);
      continue;
    }
    if (p.status === r.newStatus) {
      console.log(`  · ${r.matchName} ya está en "${r.newStatus}", skip`);
      continue;
    }
    // Contar facturas asociadas para auditar (no se borran, solo verificamos
    // que la info queda intacta)
    const invCount = await prisma.invoice.count({ where: { projectId: p.id } });
    console.log(
      `  ${APPLY ? "✓" : "+"} ${r.matchName} (Nº ${p.numeroProyecto ?? "—"})  ${p.status} → ${r.newStatus}  ${invCount} factura(s) intactas`
    );

    if (APPLY) {
      await prisma.project.update({
        where: { id: p.id },
        data: {
          status: r.newStatus,
          // Si querés podemos setear actualEndDate también para que aparezca
          // bien en /proyectos > Terminados. La dejo en null ya que no
          // sabemos la fecha real de cierre — MJ puede editarla después.
        },
      });
    }
  }

  console.log(`\n${APPLY ? "✓ Listo" : "(dry-run, nada modificado)"}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
