/**
 * Pendiente 186 — foto de control de las cotizaciones de artefactos. SOLO
 * LECTURA.
 *
 * El cambio no toca datos: solo cambia qué hace la app cuando MJ aplica un
 * precio desde un modal. O sea, desplegarlo no debería mover NI UN total ni
 * una marca. Esta foto se saca antes y después del deploy sobre la misma base
 * y se comparan con `diff`: cualquier diferencia es una alarma.
 *
 * Por cada versión de artefactos: total al cliente (Σ precio × cantidad),
 * total costo BLARQ, y cuántas líneas tienen cada marca. Formato estable para
 * diff.
 *
 *   npx tsx scripts/snapshot-186-artefactos.ts <ruta-env> > antes.txt
 *
 * No carga dotenv a propósito: el .env de la carpeta apunta a la base vieja.
 */
import { PrismaClient } from "@prisma/client";
import { readFileSync } from "fs";

const envPath = process.argv[2];
if (!envPath) throw new Error("Falta la ruta del .env como argumento.");
const url = readFileSync(envPath, "utf8")
  .match(/DATABASE_URL\s*=\s*"?([^"\n]+)"?/)?.[1]
  ?.trim();
if (!url) throw new Error(`No hay DATABASE_URL en ${envPath}`);
const prisma = new PrismaClient({ datasources: { db: { url } } });

async function main() {
  console.log(`Base: ${url!.match(/@([^/.]+)/)?.[1] ?? "?"}`);
  const versiones = await prisma.budgetVersion.findMany({
    where: { type: "artefactos" },
    select: {
      id: true,
      version: true,
      status: true,
      project: { select: { numeroProyecto: true, name: true } },
      artefactoItems: {
        select: {
          clientPrice: true,
          realCostBlarq: true,
          quantity: true,
          priceOverridden: true,
          discountOverridden: true,
        },
      },
    },
    orderBy: [{ projectId: "asc" }, { createdAt: "asc" }],
  });

  let granCliente = 0;
  let granCosto = 0;
  let granBorradores = 0;
  for (const v of versiones) {
    const it = v.artefactoItems;
    const cliente = it.reduce((s, i) => s + i.clientPrice * i.quantity, 0);
    const costo = it.reduce((s, i) => s + (i.realCostBlarq ?? 0) * i.quantity, 0);
    granCliente += cliente;
    granCosto += costo;
    if (v.status === "borrador") granBorradores += cliente;
    const nombre = `#${v.project.numeroProyecto ?? "-"} ${v.project.name}`;
    console.log(
      [
        nombre.padEnd(34).slice(0, 34),
        v.version.padEnd(6).slice(0, 6),
        v.status.padEnd(9).slice(0, 9),
        `lineas=${String(it.length).padStart(3)}`,
        `cliente=${Math.round(cliente).toString().padStart(11)}`,
        `costo=${Math.round(costo).toString().padStart(11)}`,
        `despegadas=${String(it.filter((i) => i.priceOverridden).length).padStart(3)}`,
        `dctoPropio=${String(it.filter((i) => i.discountOverridden).length).padStart(3)}`,
        v.id,
      ].join("  ")
    );
  }
  console.log("─".repeat(120));
  console.log(
    `TOTAL versiones=${versiones.length} cliente=${Math.round(granCliente)} ` +
      `costo=${Math.round(granCosto)} cliente-borradores=${Math.round(granBorradores)}`
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
