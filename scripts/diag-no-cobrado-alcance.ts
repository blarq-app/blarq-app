/**
 * ¿A qué presupuestos les cambia algo el arreglo de "No cobrar al cliente"?
 *
 * El arreglo hace que el Cuadro Resumen y el resumen del editor dejen de contar
 * las partidas `noCobrado` dentro del total del cliente (la tarjeta Total
 * Acordado y el PDF ya las dejaban fuera). Como es un cambio de CÁLCULO y no de
 * datos, la forma de acotar el riesgo es contar dónde hay partidas marcadas:
 * un presupuesto sin ninguna marcada no puede moverse ni un peso.
 *
 * NO usa dotenv — datasource explícito desde `.env.prod` (§4.9). Solo LEE.
 */
import { readFileSync } from "fs";
import { PrismaClient } from "@prisma/client";

const url = readFileSync("/Users/mjblanco/Desktop/blarq-app/.env.prod", "utf8")
  .split("\n")
  .map((l) => l.trim())
  .find((l) => l.startsWith("DATABASE_URL="))!
  .slice("DATABASE_URL=".length)
  .replace(/^["']|["']$/g, "");
const host = url.match(/@([^/]+)\//)?.[1] ?? "???";
const prisma = new PrismaClient({ datasources: { db: { url } } });

const clp = (n: number) => `$${Math.round(n).toLocaleString("es-CL")}`;

async function main() {
  console.log("HOST:", host);

  const totalPartidas = await prisma.obraItem.count();
  const marcadas = await prisma.obraItem.findMany({
    where: { noCobrado: true },
    select: {
      name: true,
      total: true,
      budgetVersion: {
        select: {
          version: true,
          status: true,
          project: { select: { numeroProyecto: true, name: true } },
        },
      },
    },
  });

  console.log(`\nPartidas de obra en toda la base viva: ${totalPartidas}`);
  console.log(`Partidas marcadas "No cobrar": ${marcadas.length}`);

  const porVersion = new Map<string, { n: number; total: number }>();
  for (const i of marcadas) {
    const k = `#${i.budgetVersion.project.numeroProyecto} ${i.budgetVersion.project.name} — obra ${i.budgetVersion.version} (${i.budgetVersion.status})`;
    const acc = porVersion.get(k) ?? { n: 0, total: 0 };
    acc.n++;
    acc.total += i.total;
    porVersion.set(k, acc);
  }
  console.log("\nPresupuestos afectados por el arreglo:");
  if (porVersion.size === 0) console.log("  (ninguno)");
  for (const [k, v] of porVersion) {
    console.log(`  ${k}: ${v.n} partidas, ${clp(v.total)} de costo directo`);
    console.log(`     el total al cliente de esa obra baja ${clp(v.total * 1.27 * 1.19)}`);
  }

  const versiones = await prisma.budgetVersion.count({ where: { type: "obra" } });
  console.log(
    `\nVersiones de obra en la base: ${versiones}. Sin partidas marcadas: ${versiones - porVersion.size} — esas no se pueden mover.`
  );
}

main()
  .catch((e) => {
    console.error("ERROR:", e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
