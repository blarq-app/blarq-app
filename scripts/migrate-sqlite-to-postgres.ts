// Migración SQLite → Postgres para el cutover a producción.
//
// Lee TODA la data de la SQLite local (prisma/dev.db) y la escribe a una
// base Postgres apuntada por POSTGRES_URL en .env. Preserva los IDs (cuids)
// y todas las relaciones. Idempotente: borra todo en destino antes de
// insertar (modo truncate-and-load).
//
// Uso:
//   npx tsx scripts/migrate-sqlite-to-postgres.ts            (dry-run)
//   npx tsx scripts/migrate-sqlite-to-postgres.ts --apply    (ejecuta)
//
// Requisitos:
//   - .env tiene DATABASE_URL apuntando a SQLite local (file:./dev.db)
//   - .env tiene POSTGRES_URL apuntando al Postgres destino (Neon)
//   - El cliente postgres ya está generado:
//     `npx prisma generate --schema=prisma/schema.postgres.prisma`
//   - El schema postgres está pusheado al destino:
//     `npx prisma db push --schema=prisma/schema.postgres.prisma`
//
// Orden de inserción: respeta las FK. Modelos con self-ref (CostCategory,
// BudgetVersion, BankMovement) se insertan en 2 pasadas: primero con la
// columna self-ref en null, luego un UPDATE para setearla.

import { PrismaClient as SqliteClient } from "@prisma/client";
// El cliente postgres se genera a node_modules/@prisma/client-postgres
// (output custom en prisma/schema.postgres.prisma). Si TypeScript se queja
// de "Cannot find module", correr primero:
//   npx prisma generate --schema=prisma/schema.postgres.prisma
import { PrismaClient as PostgresClient } from "@prisma/client-postgres";

const APPLY = process.argv.includes("--apply");

if (!process.env.POSTGRES_URL) {
  console.error("❌ Falta POSTGRES_URL en .env");
  process.exit(1);
}

const sqlite = new SqliteClient();
const pg = new PostgresClient({
  datasources: { db: { url: process.env.POSTGRES_URL } },
});

// Orden topológico de inserción. Cada modelo se inserta DESPUÉS de todos
// sus referenciados. Los self-refs (CategoryParent, VersionLineage,
// InternalTransfer) se manejan en 2 pasadas más abajo.
const MODELS_IN_ORDER = [
  // Independientes
  "user",
  "maestro",
  "bankAccount",
  "partidaCatalog",
  "materialCatalog",
  // Con parent self-ref (insertamos con parentId=null primero)
  "costCategory",
  // Dependen de Maestro
  "project",
  // Con parent self-ref
  "budgetVersion",
  // Dependen de BudgetVersion / Project / Material
  "obraItem",
  "muebleChapter",
  "muebleItem",
  "muebleQuote",
  "muebleDetail",
  "artefactoItem",
  "paymentTerm",
  "partidaComponent",
  "materialPriceOffer",
  "materialPriceHistory",
  "shoppingItem",
  "estadoPago",
  "estadoPagoItem",
  // Dependen de Project + CostCategory
  "invoice",
  // Reglas
  "invoiceCategorizationRule",
  "bankCategorizationRule",
  // Con self-ref (internal transfer)
  "bankMovement",
  // Junction
  "invoicePayment",
] as const;

type Model = (typeof MODELS_IN_ORDER)[number];

// Algunos modelos tienen self-ref. En estos hacemos insert en 2 pasadas:
// pasada 1 = todas las filas con la columna self-ref en null;
// pasada 2 = UPDATE seteando la columna con el valor real.
const SELF_REFS: Partial<Record<Model, string>> = {
  costCategory: "parentId",
  budgetVersion: "parentVersionId",
  bankMovement: "internalTransferToId",
};

// ──────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────

// Indexar por nombre de modelo dinámicamente. Prisma expone los delegados
// con métodos consistentes (count, findMany, deleteMany, createMany, update),
// así que el cast genérico funciona para todos los modelos del enum.
type AnyDelegate = {
  count: () => Promise<number>;
  findMany: () => Promise<Array<Record<string, unknown>>>;
  deleteMany: () => Promise<{ count: number }>;
  createMany: (args: {
    data: Array<Record<string, unknown>>;
    skipDuplicates: boolean;
  }) => Promise<{ count: number }>;
  update: (args: {
    where: { id: string };
    data: Record<string, unknown>;
  }) => Promise<unknown>;
};

function srcDelegate(model: Model): AnyDelegate {
  return (sqlite as unknown as Record<Model, AnyDelegate>)[model];
}

function dstDelegate(model: Model): AnyDelegate {
  return (pg as unknown as Record<Model, AnyDelegate>)[model];
}

async function countSource(model: Model): Promise<number> {
  return srcDelegate(model).count();
}

async function countDest(model: Model): Promise<number> {
  return dstDelegate(model).count();
}

async function readAll(model: Model): Promise<Array<Record<string, unknown>>> {
  return srcDelegate(model).findMany();
}

async function deleteAll(model: Model): Promise<number> {
  const r = await dstDelegate(model).deleteMany();
  return r.count;
}

async function insertAll(
  model: Model,
  rows: Array<Record<string, unknown>>
): Promise<number> {
  if (rows.length === 0) return 0;
  const selfRef = SELF_REFS[model];
  const dataForFirstPass = selfRef
    ? rows.map((r) => ({ ...r, [selfRef]: null }))
    : rows;

  // createMany no acepta filas con null en relations of incompatible types,
  // pero acá pasamos columnas crudas — está OK. Lo hacemos en chunks de 500
  // para no exceder query size con tablas grandes.
  const CHUNK = 500;
  let total = 0;
  for (let i = 0; i < dataForFirstPass.length; i += CHUNK) {
    const chunk = dataForFirstPass.slice(i, i + CHUNK);
    const r = await dstDelegate(model).createMany({
      data: chunk,
      skipDuplicates: true,
    });
    total += r.count;
  }
  return total;
}

async function fixSelfRefs(
  model: Model,
  rows: Array<Record<string, unknown>>
): Promise<number> {
  const selfRef = SELF_REFS[model];
  if (!selfRef) return 0;
  let updated = 0;
  for (const row of rows) {
    if (row[selfRef]) {
      await dstDelegate(model).update({
        where: { id: row.id as string },
        data: { [selfRef]: row[selfRef] },
      });
      updated++;
    }
  }
  return updated;
}

// ──────────────────────────────────────────────────────────────────────
// Main
// ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log(APPLY ? "🚀 APPLY mode — la BD destino será borrada y rellenada" : "🔍 DRY RUN — solo cuento, no escribo\n");

  // Conteo source
  console.log("Conteo en SQLite (source):");
  const sourceCounts: Record<string, number> = {};
  for (const m of MODELS_IN_ORDER) {
    const c = await countSource(m);
    sourceCounts[m] = c;
    console.log(`  ${m.padEnd(30)} ${c}`);
  }

  // Conteo destino antes
  console.log("\nConteo en Postgres (destino) ANTES:");
  for (const m of MODELS_IN_ORDER) {
    const c = await countDest(m);
    console.log(`  ${m.padEnd(30)} ${c}`);
  }

  if (!APPLY) {
    console.log("\n✓ Dry run terminado. Re-correr con --apply para ejecutar.");
    return;
  }

  // PASO 1: borrar TODO en destino, en orden inverso (children antes que parents).
  console.log("\n--- Borrando destino ---");
  for (const m of [...MODELS_IN_ORDER].reverse()) {
    const c = await deleteAll(m);
    if (c > 0) console.log(`  ✓ ${m.padEnd(30)} eliminados ${c}`);
  }

  // PASO 2: insertar en orden topológico (parents antes que children).
  console.log("\n--- Insertando ---");
  const allRows: Partial<Record<Model, Array<Record<string, unknown>>>> = {};
  for (const m of MODELS_IN_ORDER) {
    const rows = await readAll(m);
    allRows[m] = rows;
    const inserted = await insertAll(m, rows);
    console.log(`  ✓ ${m.padEnd(30)} insertados ${inserted}/${rows.length}`);
  }

  // PASO 3: fix self-refs (segunda pasada).
  console.log("\n--- Reparando self-refs ---");
  for (const m of Object.keys(SELF_REFS) as Model[]) {
    const rows = allRows[m] ?? [];
    const fixed = await fixSelfRefs(m, rows);
    console.log(`  ✓ ${m.padEnd(30)} self-refs reparadas ${fixed}`);
  }

  // PASO 4: verificación final — counts deben coincidir.
  console.log("\n--- Verificación ---");
  let allGood = true;
  for (const m of MODELS_IN_ORDER) {
    const src = sourceCounts[m];
    const dst = await countDest(m);
    const ok = src === dst;
    if (!ok) allGood = false;
    console.log(`  ${ok ? "✓" : "✗"} ${m.padEnd(30)} source=${src} dest=${dst}`);
  }

  if (allGood) {
    console.log("\n✅ Migración OK — todos los counts coinciden.");
  } else {
    console.log("\n❌ Hay diferencias en algún count. Revisar arriba.");
    process.exit(1);
  }
}

main()
  .catch((e) => {
    console.error("❌ Error en migración:", e);
    process.exit(1);
  })
  .finally(async () => {
    await sqlite.$disconnect();
    await pg.$disconnect();
  });
