/**
 * Limpia el ruido decimal de las cantidades de la obra V7 de Portofino.
 *
 * El Excel guarda 95,3 como 95.30000000000001 (aritmética de punto flotante) y
 * la carga lo copió tal cual, así que en pantalla se lee "95.30000". Se redondea
 * a 4 decimales, que es más precisión de la que cualquier cubicación usa.
 *
 * El `total` de la partida NO se toca: está guardado aparte y ya es el correcto
 * (viene del Excel). Redondear la cantidad no lo mueve.
 *
 * NO usa dotenv — datasource explícito desde `.env.prod` (§4.9).
 * Dry-run por defecto. Escribe solo con --apply.
 */
import { readFileSync } from "fs";
import { PrismaClient } from "@prisma/client";

const APPLY = process.argv.includes("--apply");
const V7 = "cms7xldpz0001rtz5ch8sln3k";

const url = readFileSync("/Users/mjblanco/Desktop/blarq-app/.env.prod", "utf8")
  .split("\n")
  .map((l) => l.trim())
  .find((l) => l.startsWith("DATABASE_URL="))!
  .slice("DATABASE_URL=".length)
  .replace(/^["']|["']$/g, "");
const host = url.match(/@([^/]+)\//)?.[1] ?? "???";
const prisma = new PrismaClient({ datasources: { db: { url } } });

async function main() {
  console.log("HOST:", host, "| MODO:", APPLY ? "APLICAR" : "DRY-RUN");
  if (!host.includes("ep-shy-morning")) throw new Error("No es la base viva — PARAR");

  const items = await prisma.obraItem.findMany({
    where: { budgetVersionId: V7 },
    select: { id: true, itemNumber: true, name: true, quantity: true, total: true },
  });

  const sucias = items.filter((i) => Math.round(i.quantity * 1e4) / 1e4 !== i.quantity);
  console.log(`\n${sucias.length} de ${items.length} partidas con ruido decimal:`);
  for (const i of sucias) {
    console.log(`  ${i.itemNumber} ${i.name}: ${i.quantity} → ${Math.round(i.quantity * 1e4) / 1e4}`);
  }

  const totalAntes = items.reduce((s, i) => s + i.total, 0);
  console.log(`\nSuma de totales (no debe moverse): $${Math.round(totalAntes).toLocaleString("es-CL")}`);

  if (!APPLY) {
    console.log("\nDRY-RUN: no se escribió nada.");
    return;
  }

  for (const i of sucias) {
    await prisma.obraItem.update({
      where: { id: i.id },
      data: { quantity: Math.round(i.quantity * 1e4) / 1e4 },
    });
  }

  const despues = await prisma.obraItem.findMany({
    where: { budgetVersionId: V7 },
    select: { quantity: true, total: true },
  });
  const totalDespues = despues.reduce((s, i) => s + i.total, 0);
  console.log(`\n${sucias.length} cantidades limpiadas.`);
  console.log(`Suma de totales después: $${Math.round(totalDespues).toLocaleString("es-CL")}`);
  console.log(totalAntes === totalDespues ? "Los totales no se movieron — OK" : "LOS TOTALES SE MOVIERON — REVISAR");
}

main()
  .catch((e) => {
    console.error("ERROR:", e.message ?? e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
