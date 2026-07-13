// Agrega la categoría madre "Gastos extraordinarios" (parentId=null) para clasificar
// facturas RECIBIDAS. La app no tiene UI para crear categorías; se insertan por script.
//
// IDEMPOTENTE: si ya existe una categoría madre con ese nombre, no la duplica.
//
// BASE VIVA: lee DATABASE_URL directo de .env.prod y se lo pasa explícito al PrismaClient.
// NO usar `import "dotenv/config"` — @prisma/client auto-carga .env (copia VIEJA
// ep-solitary-mud) y dotenv no pisa una var ya seteada. Patrón: diag-cual-base-viva.ts (§4.9).
//
// Uso:
//   Solo mostrar host + hermana (dry-run):   npx tsx scripts/agregar-categoria-gastos-extraordinarios.ts
//   Escribir de verdad:                       npx tsx scripts/agregar-categoria-gastos-extraordinarios.ts --escribir
import { PrismaClient } from "@prisma/client";
import { readFileSync } from "fs";

const ENV_PATH = ".env.prod";
const NOMBRE_NUEVA = "Gastos extras";
const NOMBRE_HERMANA = "Gastos generales";
const ESCRIBIR = process.argv.includes("--escribir");

const raw = readFileSync(ENV_PATH, "utf8");
const m = raw.match(/DATABASE_URL\s*=\s*"?([^"\n]+)"?/);
if (!m) {
  console.error("no DATABASE_URL en", ENV_PATH);
  process.exit(1);
}
const url = m[1].trim();
const host = url.match(/@([^/.]+)/)?.[1] ?? "?";

const prisma = new PrismaClient({ datasources: { db: { url } } });

async function main() {
  console.log("=== ENV:", ENV_PATH, "| HOST:", host, "===");

  // Marcador de base viva (§4.9): proyecto #64 debe ser "Paseo del Sena".
  const p64 = await prisma.project.findFirst({
    where: { numeroProyecto: 64 },
    select: { name: true },
  });
  console.log("  Marcador #64:", p64?.name ?? "(no existe)");
  const esViva = host.startsWith("ep-shy-morning") && /paseo del sena/i.test(p64?.name ?? "");
  if (!esViva) {
    console.error(
      "\n  ABORT: no parece la base VIVA (esperado host ep-shy-morning + #64 'Paseo del Sena')."
    );
    process.exit(1);
  }
  console.log("  OK: base viva confirmada.\n");

  // Espejar la hermana "Gastos generales" (madre) para copiar type y ubicar sortOrder.
  const hermana = await prisma.costCategory.findFirst({
    where: { name: NOMBRE_HERMANA, parentId: null },
    select: { id: true, name: true, type: true, appliesTo: true, sortOrder: true },
  });
  if (!hermana) {
    console.error(`  ABORT: no encontré la categoría madre hermana "${NOMBRE_HERMANA}".`);
    process.exit(1);
  }
  console.log("  Hermana:", JSON.stringify(hermana));

  // Idempotencia: ¿ya existe la madre con este nombre?
  const yaExiste = await prisma.costCategory.findFirst({
    where: { name: NOMBRE_NUEVA, parentId: null },
    select: { id: true, name: true, type: true, appliesTo: true, sortOrder: true },
  });
  if (yaExiste) {
    console.log("\n  YA EXISTE, no se duplica:", JSON.stringify(yaExiste));
    return;
  }

  // La nueva queda al lado / justo después de la hermana.
  const nueva = {
    name: NOMBRE_NUEVA,
    parentId: null,
    type: hermana.type, // espejo de "Gastos generales"
    appliesTo: "recibida",
    sortOrder: hermana.sortOrder + 1,
  };
  console.log("\n  A CREAR:", JSON.stringify(nueva));

  if (!ESCRIBIR) {
    console.log("\n  (dry-run) — pasá --escribir para insertar de verdad.");
    return;
  }

  const creada = await prisma.costCategory.create({
    data: nueva,
    select: { id: true, name: true, type: true, appliesTo: true, sortOrder: true },
  });
  console.log("\n  CREADA:", JSON.stringify(creada));
}

main()
  .catch((e) => console.error("ERROR:", e.message))
  .finally(() => prisma.$disconnect());
