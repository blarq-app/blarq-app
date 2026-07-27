// Diagnóstico SOLO LECTURA: en Portofino V6, ¿la suma de los capítulos que SÍ
// se imprimen cuadra con el costo directo total del PDF?
// Uso: npx tsx scripts/diag-portofino-v6-descuadre.ts <ruta-env>
import { PrismaClient } from "@prisma/client";
import { readFileSync } from "fs";

const envPath = process.argv[2];
const raw = readFileSync(envPath, "utf8");
const url = raw.match(/DATABASE_URL\s*=\s*"?([^"\n]+)"?/)![1].trim();
const prisma = new PrismaClient({ datasources: { db: { url } } });

const OFICIALES = [
  "demoliciones", "obra_gruesa", "reparaciones", "sanitarias",
  "electricas", "terminaciones", "limpieza", "adicionales",
];

async function main() {
  const bv = await prisma.budgetVersion.findFirst({
    where: {
      type: "obra",
      project: { numeroProyecto: 60 },
      version: "V6",
    },
    include: { obraItems: { select: { chapter: true, total: true, sortOrder: true } } },
  });
  if (!bv) return console.log("no encontrada");

  const total = bv.obraItems.reduce((s, i) => s + i.total, 0);
  const visibles = bv.obraItems.filter((i) => OFICIALES.includes(i.chapter));
  const invisibles = bv.obraItems.filter((i) => !OFICIALES.includes(i.chapter));
  const tv = visibles.reduce((s, i) => s + i.total, 0);
  const ti = invisibles.reduce((s, i) => s + i.total, 0);

  const f = (n: number) => "$" + Math.round(n).toLocaleString("es-CL");
  console.log(`Portofino V6 (${bv.status}) — ${bv.obraItems.length} partidas`);
  console.log(`  Costo directo TOTAL (el que imprime el PDF):        ${f(total)}`);
  console.log(`  Suma de los capítulos que el PDF SÍ dibuja:          ${f(tv)}`);
  console.log(`  Partidas que el PDF NO dibuja (capítulo huérfano):   ${f(ti)}  (${invisibles.length} partidas)`);
  console.log(`  Descuadre:                                           ${f(total - tv)}`);

  // ¿Ya existe un capítulo "sanitarias" en esta versión?
  const porCap = new Map<string, { n: number; t: number }>();
  for (const i of bv.obraItems) {
    const c = porCap.get(i.chapter) ?? { n: 0, t: 0 };
    c.n++; c.t += i.total;
    porCap.set(i.chapter, c);
  }
  console.log(`\n  Capítulos de esta versión:`);
  for (const [k, v] of porCap) {
    console.log(`    ${OFICIALES.includes(k) ? " " : "!"} ${k.padEnd(56)} ${String(v.n).padStart(3)} partidas  ${f(v.t)}`);
  }

  // ¿Cuántas partidas de TODA la base tienen sortOrder = 0 (nunca arrastradas)?
  const total0 = await prisma.obraItem.count({ where: { sortOrder: 0 } });
  const totalAll = await prisma.obraItem.count();
  console.log(`\n  ObraItem con sortOrder = 0 en toda la base: ${total0} de ${totalAll}`);
}

main()
  .catch((e) => console.error("ERROR:", e.message))
  .finally(() => prisma.$disconnect());
