// SOLO LECTURA. Complemento de diag-160-facturas-lado-equivocado.ts: para los
// 5 proveedores de las 12 facturas mal archivadas, muestra TODAS sus facturas
// con su categoría actual, para poder proponer destino con evidencia y no a ojo.
// Uso: npx tsx scripts/diag-160-proveedores-contexto.ts .env.prod
import { PrismaClient } from "@prisma/client";
import { readFileSync } from "fs";

const url = readFileSync(process.argv[2], "utf8").match(/DATABASE_URL\s*=\s*"?([^"\n]+)"?/)![1].trim();
const prisma = new PrismaClient({ datasources: { db: { url } } });
const clp = (n: number) => "$" + Math.round(n).toLocaleString("es-CL");

const RUTS = [
  ["77690596-8", "ICPROYECTOS SPA"],
  ["76911036-4", "CHRISTIAN GEOFFROY"],
  ["76159290-4", "PROYECTOS INGENIERÍA Y DISEÑO"],
  ["96999930-7", "KITCHEN CENTER"],
  ["18478845-4", "ASAEL DE LA O"],
  ["77270733-9", "GONZALO HEVIA (el de la regla)"],
];

async function main() {
  const cats = await prisma.costCategory.findMany({
    select: { id: true, name: true, parentId: true, appliesTo: true },
  });
  const byId = new Map(cats.map((c) => [c.id, c]));
  const ruta = (id: string | null) => {
    if (!id) return "(SIN CATEGORÍA)";
    const c = byId.get(id)!;
    const lado = (c.parentId ? byId.get(c.parentId)! : c).appliesTo;
    return `${c.parentId ? `${byId.get(c.parentId)!.name} > ` : ""}${c.name}${lado === "emitida" ? "  ← COBRO" : ""}`;
  };

  for (const [rut, nombre] of RUTS) {
    const invs = await prisma.invoice.findMany({
      where: { rutIssuer: rut },
      select: {
        folioNumber: true, type: true, netAmount: true, issueDate: true,
        categoryId: true, project: { select: { name: true } },
      },
      orderBy: { issueDate: "asc" },
    });
    console.log(`\n=== ${nombre} (${rut}) — ${invs.length} facturas`);
    for (const i of invs) {
      console.log(
        `   ${i.issueDate.toISOString().slice(0, 10)} F-${(i.folioNumber ?? "?").padEnd(9)} ${i.type.padEnd(8)} ${clp(i.netAmount).padStart(12)}  ${(i.project?.name ?? "sin obra").slice(0, 22).padEnd(22)} ${ruta(i.categoryId)}`
      );
    }
  }

  // La regla de Gonzalo Hevia: cuántas veces se aplicó.
  const regla = await prisma.invoiceCategorizationRule.findFirst({
    where: { rutIssuer: "77270733-9" },
    select: { businessName: true, hits: true, categoryId: true, projectId: true, createdAt: true },
  });
  console.log(`\n=== REGLA de Gonzalo Hevia:`, JSON.stringify(regla, null, 2));
}

main().catch(console.error).finally(() => prisma.$disconnect());
