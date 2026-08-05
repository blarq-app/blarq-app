// Verificación SOLO LECTURA del fix del pendiente 130: corre el where NUEVO
// (el helper compartido) contra la base viva y compara contra el viejo.
//
// Uso: npx tsx scripts/diag-130-verificar-fix.ts .env.prod
import { PrismaClient } from "@prisma/client";
import { readFileSync } from "fs";
import { PROYECTOS_ASIGNABLES_WHERE } from "../src/lib/projects/asignables";

const envPath = process.argv[2] ?? ".env.prod";
const url = readFileSync(envPath, "utf8")
  .match(/DATABASE_URL\s*=\s*"?([^"\n]+)"?/)?.[1]
  .trim();
if (!url) process.exit(1);
const prisma = new PrismaClient({ datasources: { db: { url } } });

const WHERE_VIEJO = { NOT: { status: "cotizacion", isInternal: false } };

async function main() {
  console.log("=== HOST:", url!.match(/@([^/.]+)/)?.[1], "===\n");

  const antes = await prisma.project.findMany({
    where: WHERE_VIEJO,
    select: { id: true, name: true },
  });
  const despues = await prisma.project.findMany({
    where: PROYECTOS_ASIGNABLES_WHERE,
    select: {
      id: true,
      name: true,
      status: true,
      isInternal: true,
      numeroProyecto: true,
      _count: { select: { invoices: true } },
    },
    orderBy: { numeroProyecto: { sort: "asc", nulls: "last" } },
  });

  const idsDespues = new Set(despues.map((p) => p.id));
  const sacados = antes.filter((p) => !idsDespues.has(p.id));

  console.log(`ANTES salían: ${antes.length} · AHORA salen: ${despues.length}`);
  console.log(`\nDEJAN DE SALIR (${sacados.length}):`);
  for (const p of sacados) console.log(`  - ${p.name}`);

  console.log("\nLOS QUE SIGUEN SALIENDO SIN NÚMERO (deben ser BLARQ y CASA):");
  for (const p of despues.filter((x) => !x.numeroProyecto))
    console.log(
      `  - ${p.name.padEnd(24)} status=${p.status} interno=${
        p.isInternal ? "sí" : "no"
      } facturas=${p._count.invoices}`
    );

  const numerados = despues.filter((p) => p.numeroProyecto);
  console.log(
    `\nPROYECTOS NUMERADOS que siguen saliendo: ${numerados.length} (#${
      numerados[0]?.numeroProyecto
    } al #${numerados[numerados.length - 1]?.numeroProyecto})`
  );

  // Chequeo duro: ninguna factura puede quedar apuntando a un proyecto que ya
  // no aparece en el desplegable (quedaría sin forma de reasignarse).
  const huerfanas = await prisma.invoice.count({
    where: { projectId: { not: null, notIn: [...idsDespues] } },
  });
  console.log(
    `\nFACTURAS apuntando a un proyecto que YA NO sale en el desplegable: ${huerfanas}` +
      (huerfanas === 0 ? "  → OK" : "  → REVISAR ANTES DE MERGEAR")
  );

  // Mismo chequeo para movimientos de banco (el desplegable de banco es el mismo).
  const movsHuerfanos = await prisma.bankMovement.count({
    where: { projectId: { not: null, notIn: [...idsDespues] } },
  });
  console.log(
    `MOVIMIENTOS de banco apuntando a un proyecto escondido: ${movsHuerfanos}` +
      (movsHuerfanos === 0 ? "  → OK" : "  → REVISAR ANTES DE MERGEAR")
  );
}

main()
  .catch((e) => console.error("ERROR:", e.message))
  .finally(() => prisma.$disconnect());
