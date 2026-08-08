// Diagnóstico SOLO LECTURA: el costo de cada partida de herrajes tiene que ser
// igual a la suma de costo × cantidad de sus líneas. El reorder NO recalcula
// (el orden no cambia la suma), así que esto confirma que no se movió nada.
// Uso: npx tsx scripts/diag-140-total-partida-cuadra.ts [ruta-env]
import { PrismaClient } from "@prisma/client";
import { readFileSync } from "fs";

const envPath = process.argv[2] ?? ".env";
const url = readFileSync(envPath, "utf8").match(
  /DATABASE_URL\s*=\s*"?([^"\n]+)"?/,
)![1].trim();
const host = url.match(/@([^/.]+)/)?.[1] ?? "?";
const prisma = new PrismaClient({ datasources: { db: { url } } });

const clp = (n: number) =>
  "$" + Math.round(n).toLocaleString("es-CL").replace(/,/g, ".");

async function main() {
  console.log("=== ENV:", envPath, "| HOST:", host, "===\n");

  const items = await prisma.muebleItem.findMany({
    where: { kind: "herrajes" },
    include: {
      herrajes: { orderBy: { sortOrder: "asc" } },
      chapter: { include: { budgetVersion: { include: { project: true } } } },
    },
  });

  let malas = 0;
  for (const it of items) {
    if (it.herrajes.length === 0) continue;
    const bv = it.chapter.budgetVersion;
    const suma = it.herrajes.reduce((s, h) => s + h.costNet * h.quantity, 0);
    const dif = Math.abs(suma - it.costDistributor);
    const cuadra = dif < 1; // tolerancia de $1 por redondeo
    if (!cuadra) malas++;
    console.log(
      `${cuadra ? "✓" : "✗"} ${bv.project.name} ${bv.version} · "${it.name}" · ${it.herrajes.length} líneas`,
    );
    console.log(
      `    suma de líneas ${clp(suma)}  ·  costo de la partida ${clp(it.costDistributor)}  ·  al cliente c/IVA ${clp(it.clientPriceIva)}`,
    );
    for (const h of it.herrajes) {
      console.log(
        `      ${String(h.quantity).padStart(3)} × ${clp(h.costNet).padStart(11)} = ${clp(h.costNet * h.quantity).padStart(11)}   ${h.name}`,
      );
    }
    console.log("");
  }
  console.log(malas === 0 ? "TODAS CUADRAN" : `${malas} NO cuadran`);
}

main()
  .catch((e) => console.error("ERROR:", e.message))
  .finally(() => prisma.$disconnect());
