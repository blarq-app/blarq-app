/**
 * Respaldo de `ArtefactoCatalog.clientPrice` ANTES de sacar la columna.
 *
 * El campo existe desde el rediseño de precios de junio 2026 pero ningún flujo
 * lo lee: la pantalla, el margen, el alta en cotización, la bajada a borradores
 * y "Comparar con mi catálogo" calculan todos lista × (1 − dcto). En la base
 * viva hay 53 productos con un valor guardado ahí que no hace nada (auditoría
 * 2026-07-31). MJ decidió sacarlo.
 *
 * Este script NO borra nada: solo guarda los valores en un JSON, por si alguna
 * vez se quiere recuperar lo que había. Solo lectura.
 *
 *   npx tsx scripts/backup-catalogo-clientprice.ts
 */
import { readFileSync, writeFileSync } from "fs";
import { PrismaClient } from "@prisma/client";

const envRaw = readFileSync("/Users/mjblanco/Desktop/blarq-app/.env.prod", "utf8");
const url = envRaw.match(/DATABASE_URL\s*=\s*"?([^"\n]+)"?/)![1];
console.log("HOST:", url.match(/@([^/]+)/)![1]);
const prisma = new PrismaClient({ datasources: { db: { url } } });

// Va a /backups/ de la carpeta principal, que está gitignored (§5: ningún
// backup se commitea).
const SALIDA =
  "/Users/mjblanco/Desktop/blarq-app/backups/backup-catalogo-clientprice-2026-07-31.json";

async function main() {
  const p64 = await prisma.project.findFirst({
    where: { numeroProyecto: 64 },
    select: { name: true },
  });
  console.log("Proyecto #64:", p64?.name ?? "(no está)");

  const todos = await prisma.artefactoCatalog.findMany({
    select: {
      id: true,
      name: true,
      subcategory: true,
      listPrice: true,
      discountPercent: true,
      clientPrice: true,
    },
    orderBy: { name: "asc" },
  });

  const conValor = todos.filter((c) => c.clientPrice != null);
  const distintosDelCalculado = conValor.filter(
    (c) =>
      Math.abs(
        (c.clientPrice as number) -
          Math.round(c.listPrice * (1 - (c.discountPercent ?? 0)))
      ) > 1
  );

  console.log(`\nTotal catálogo: ${todos.length}`);
  console.log(`Con clientPrice guardado: ${conValor.length}`);
  console.log(
    `De esos, DISTINTOS del calculado (lista × (1 − dcto)): ${distintosDelCalculado.length}`
  );

  writeFileSync(
    SALIDA,
    JSON.stringify(
      {
        generado: "2026-07-31",
        motivo:
          "Respaldo previo a sacar ArtefactoCatalog.clientPrice (campo que ningún flujo leía).",
        host: url.match(/@([^/]+)/)![1],
        total: todos.length,
        conValor: conValor.length,
        distintosDelCalculado: distintosDelCalculado.length,
        items: conValor.map((c) => ({
          id: c.id,
          name: c.name,
          subcategory: c.subcategory,
          listPrice: c.listPrice,
          discountPercent: c.discountPercent,
          clientPriceGuardado: c.clientPrice,
          calculado: Math.round(c.listPrice * (1 - (c.discountPercent ?? 0))),
        })),
      },
      null,
      2
    )
  );
  console.log(`\nRespaldo escrito en ${SALIDA} (gitignored, queda en tu carpeta).`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
