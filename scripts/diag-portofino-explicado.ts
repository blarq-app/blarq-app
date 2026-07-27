// Diagnóstico SOLO LECTURA sobre la base viva: el antes y el después del
// cuadro de capítulos de Portofino V6, para explicarle a MJ qué se ve hoy y
// qué se vería después de la migración.
// Uso: npx tsx scripts/diag-portofino-explicado.ts <ruta-env>
import { PrismaClient } from "@prisma/client";
import { readFileSync } from "fs";

const envPath = process.argv[2] ?? ".env.prod";
const url = readFileSync(envPath, "utf8").match(
  /DATABASE_URL\s*=\s*"?([^"\n]+)"?/
)![1].trim();
const prisma = new PrismaClient({ datasources: { db: { url } } });

const OFICIALES: Record<string, { pdf: string; i: number }> = {
  demoliciones: { pdf: "DEMOLICIONES", i: 1 },
  obra_gruesa: { pdf: "OBRA GRUESA", i: 2 },
  reparaciones: { pdf: "REPARACIONES", i: 3 },
  sanitarias: { pdf: "INSTALACIONES SANITARIAS Y GASFITERIA", i: 4 },
  electricas: { pdf: "INSTALACIONES ELECTRICAS", i: 5 },
  terminaciones: { pdf: "TERMINACIONES", i: 6 },
  limpieza: { pdf: "LIMPIEZA Y ASEO", i: 7 },
  adicionales: { pdf: "ADICIONALES", i: 8 },
};

const f = (n: number) => "$" + Math.round(n).toLocaleString("es-CL");

async function main() {
  const bv = await prisma.budgetVersion.findFirst({
    where: { type: "obra", version: "V6", project: { numeroProyecto: 60 } },
    include: {
      obraItems: {
        orderBy: { sortOrder: "asc" },
        select: { chapter: true, name: true, total: true, noCobrado: true },
      },
    },
  });
  if (!bv) return console.log("no encontrada");

  const items = bv.obraItems.filter((i) => !i.noCobrado);
  const porCap = new Map<string, { n: number; t: number; nombres: string[] }>();
  for (const i of items) {
    const g = porCap.get(i.chapter) ?? { n: 0, t: 0, nombres: [] };
    g.n++;
    g.t += i.total;
    g.nombres.push(i.name);
    porCap.set(i.chapter, g);
  }
  const total = items.reduce((s, i) => s + i.total, 0);

  const ordenadas = [...porCap.entries()].sort(
    (a, b) => (OFICIALES[a[0]]?.i ?? 90) - (OFICIALES[b[0]]?.i ?? 90)
  );

  console.log(`\nPORTOFINO V6 (${bv.status}) — ${items.length} partidas\n`);

  console.log("LO QUE IMPRIME EL PDF HOY");
  let n = 0;
  let sumaVisible = 0;
  for (const [clave, g] of ordenadas) {
    if (!OFICIALES[clave]) continue;
    n++;
    sumaVisible += g.t;
    console.log(`  ${n}  ${OFICIALES[clave].pdf.padEnd(40)} ${f(g.t).padStart(14)}`);
  }
  console.log(`     ${"".padEnd(40)} ${"".padStart(14)}`);
  console.log(`     ${"Suma de los capítulos".padEnd(40)} ${f(sumaVisible).padStart(14)}`);
  console.log(`     ${"Costo directo que imprime abajo".padEnd(40)} ${f(total).padStart(14)}`);
  console.log(`     ${"NO CUADRA por".padEnd(40)} ${f(total - sumaVisible).padStart(14)}\n`);

  console.log("LO QUE IMPRIMIRIA DESPUES DE LA MIGRACION");
  n = 0;
  let sumaNueva = 0;
  for (const [clave, g] of ordenadas) {
    n++;
    sumaNueva += g.t;
    const nombre =
      OFICIALES[clave]?.pdf ?? clave.replace(/_/g, " ").toUpperCase().trim();
    const marca = OFICIALES[clave] ? "  " : "<-";
    console.log(`  ${n}  ${nombre.padEnd(40)} ${f(g.t).padStart(14)} ${marca}`);
  }
  console.log(`     ${"".padEnd(40)} ${"".padStart(14)}`);
  console.log(`     ${"Suma de los capítulos".padEnd(40)} ${f(sumaNueva).padStart(14)}`);
  console.log(`     ${"Costo directo que imprime abajo".padEnd(40)} ${f(total).padStart(14)}`);
  console.log(`     ${"Diferencia".padEnd(40)} ${f(total - sumaNueva).padStart(14)}\n`);

  const huerfanas = ordenadas.find(([c]) => !OFICIALES[c]);
  if (huerfanas) {
    console.log(`LAS ${huerfanas[1].n} PARTIDAS QUE HOY NO SE VEN`);
    console.log(`  (guardadas como "${huerfanas[0]}")\n`);
    for (const nombre of huerfanas[1].nombres) console.log(`   · ${nombre}`);
  }
  console.log(
    `\nEl TOTAL de la cotización NO cambia: esas partidas ya estaban sumadas.`
  );
}

main()
  .catch((e) => console.error("ERROR:", e.message))
  .finally(() => prisma.$disconnect());
