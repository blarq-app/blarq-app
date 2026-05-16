// Reporte detallado de facturas potencialmente arrastradas por reglas con
// projectId que ya fueron borradas.
//
// HEURÍSTICA para distinguir arrastre vs asignación manual:
//   - "Δ tiempo" = tiempo entre createdAt (cuando entró del sync) y
//     updatedAt (última modificación).
//   - Δ < 5 segundos → casi seguro arrastrada por regla al momento de crearse.
//   - Δ minutos/horas/días → probablemente asignación manual posterior.
//   - Δ ~ varios días pero consistente entre facturas → arrastre retroactivo
//     cuando la regla se creó después.
//
// Correr: DATABASE_URL=<url prod> npx tsx scripts/audit-rules-impact.ts

import "dotenv/config";
import { prisma } from "../src/lib/prisma";

// (RUT, nombre, proyecto sospechoso al que apuntaba la regla mala antes de borrarla)
const CASOS = [
  { rut: "76568660-1", nombre: "EASY RETAIL", proyectoSospechoso: "Cocina Farellones" },
  { rut: "76568660-1", nombre: "EASY RETAIL", proyectoSospechoso: "Portofino" }, // también vimos arrastre acá
  { rut: "79831880-2", nombre: "Scanavini", proyectoSospechoso: "Portofino" },
  { rut: "88669200-5", nombre: "HABITAT", proyectoSospechoso: "Cocina Farellones" },
  { rut: "78137094-0", nombre: "MST GROUP", proyectoSospechoso: "Portofino" },
  { rut: "77331410-1", nombre: "TEMPORA", proyectoSospechoso: "Cocina Farellones" },
  { rut: "94668000-1", nombre: "CODELPA", proyectoSospechoso: "Cocina Farellones" },
  { rut: "96803460-K", nombre: "SHERWIN WILLIAMS", proyectoSospechoso: "Portofino" },
];

function deltaTime(created: Date, updated: Date): string {
  const ms = updated.getTime() - created.getTime();
  if (ms < 5000) return `${ms}ms`;
  if (ms < 60000) return `${Math.round(ms / 1000)}s`;
  if (ms < 3600000) return `${Math.round(ms / 60000)}min`;
  if (ms < 86400000) return `${Math.round(ms / 3600000)}h`;
  return `${Math.round(ms / 86400000)}d`;
}

function diagnostico(created: Date, updated: Date): string {
  const ms = updated.getTime() - created.getTime();
  if (ms < 5000) return "ARRASTRE";       // creada y "actualizada" en el mismo flow → regla
  if (ms < 60000) return "arrastre?";     // < 1min, sospechoso
  if (ms < 3600000) return "manual?";     // 1min-1h, probable manual
  return "manual";                          // > 1h, manual claro
}

async function main() {
  for (const c of CASOS) {
    const proyecto = await prisma.project.findFirst({
      where: { name: c.proyectoSospechoso },
      select: { id: true, name: true },
    });
    if (!proyecto) {
      console.log(`(no encontré proyecto "${c.proyectoSospechoso}")`);
      continue;
    }

    const facts = await prisma.invoice.findMany({
      where: { rutIssuer: c.rut, projectId: proyecto.id },
      select: {
        id: true,
        folioNumber: true,
        issueDate: true,
        totalAmount: true,
        categoryId: true,
        category: { select: { name: true } },
        createdAt: true,
        updatedAt: true,
        origin: true,
      },
      orderBy: { issueDate: "desc" },
    });

    if (facts.length === 0) continue;

    console.log(`\n═══ ${c.nombre} (${c.rut}) en "${c.proyectoSospechoso}" — ${facts.length} factura(s) ═══`);
    console.log(
      `${"Folio".padEnd(11)} ${"Fecha".padEnd(11)} ${"Monto".padStart(12)}  ${"Categoría".padEnd(15)} ${"Origen".padEnd(7)} ${"Δ tiempo".padEnd(9)} Diagnóstico`
    );
    console.log("─".repeat(95));
    for (const f of facts) {
      const delta = deltaTime(f.createdAt, f.updatedAt);
      const diag = diagnostico(f.createdAt, f.updatedAt);
      console.log(
        `${f.folioNumber.padEnd(11)} ${f.issueDate.toISOString().slice(0, 10)} $${f.totalAmount.toLocaleString("es-CL").padStart(11)}  ${(f.category?.name ?? "—").padEnd(15)} ${(f.origin ?? "—").padEnd(7)} ${delta.padEnd(9)} ${diag}`
      );
    }
  }

  console.log(
    `\n${"═".repeat(95)}\n` +
      `Diagnóstico:\n` +
      `  ARRASTRE  = factura creada y "actualizada" en el mismo flow (< 5 seg) — la regla\n` +
      `              la asignó al momento de crearse. Sospechosa de arrastre por regla.\n` +
      `  arrastre? = < 1 min, sospechoso.\n` +
      `  manual?   = 1 min a 1 hora, probable edición manual.\n` +
      `  manual    = > 1 hora, claramente manual.\n` +
      `\n` +
      `OJO: las marcadas "ARRASTRE" pueden seguir siendo legítimas si efectivamente\n` +
      `eran compras para ese proyecto. Revisalas vos abriendo el detalle.\n`
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
