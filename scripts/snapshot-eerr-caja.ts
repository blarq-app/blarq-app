// Snapshot SOLO LECTURA del Estado de Resultado — vista CAJA, todos los años.
//
// Red de seguridad para el refactor de categorías de banco: la vista Caja es la
// que junta los dos vocabularios (categoría de factura + categoría de banco) y
// es la que muestra plata. Si el refactor mueve un peso o renombra una fila, el
// diff de este archivo lo canta.
//
// Uso:
//   npx tsx scripts/snapshot-eerr-caja.ts <ruta-env> <archivo-salida.json>
//   (correr ANTES y DESPUÉS del cambio, y comparar con `diff`)
//
// OJO (§4.9): la URL se lee del archivo que le pasás y se inyecta como
// datasource directo, sin dotenv — el `.env` del shell puede apuntar a la base
// vieja y ganarle. No escribe nada en la base.
import { PrismaClient } from "@prisma/client";
import { readFileSync, writeFileSync } from "fs";

const envPath = process.argv[2];
const outPath = process.argv[3];
if (!envPath || !outPath) {
  console.error("uso: npx tsx scripts/snapshot-eerr-caja.ts <ruta-env> <salida.json>");
  process.exit(1);
}
const raw = readFileSync(envPath, "utf8");
const m = raw.match(/DATABASE_URL\s*=\s*"?([^"\n]+)"?/);
if (!m) {
  console.error("no DATABASE_URL en", envPath);
  process.exit(1);
}
const url = m[1].trim();
const host = url.match(/@([^/.]+)/)?.[1] ?? "?";

// El módulo del EERR importa el singleton `@/lib/prisma`, que se construye con
// process.env.DATABASE_URL. Para que apunte a la base que pedimos por argumento
// hay que setearla ANTES de importarlo (import dinámico más abajo).
process.env.DATABASE_URL = url;

const prisma = new PrismaClient({ datasources: { db: { url } } });

async function main() {
  const { computeEstadoResultadoCaja, computeSaldoPrestamosSocios } = await import(
    "../src/lib/dashboard/estadoResultadoCaja"
  );
  const { getAvailableYears } = await import("../src/lib/dashboard/estadoResultado");

  // Marcador de base viva (§4.9).
  const p64 = await prisma.project.findFirst({
    where: { numeroProyecto: 64 },
    select: { name: true },
  });
  console.log(`HOST: ${host} · marcador #64: ${p64?.name ?? "(no existe)"}`);

  const years = await getAvailableYears();
  console.log("Años:", years.join(", "));

  const out: Record<string, unknown> = { host, years };
  for (const y of years) {
    out[`caja_${y}`] = await computeEstadoResultadoCaja(y);
  }
  out["saldo_prestamos_socios"] = await computeSaldoPrestamosSocios();

  writeFileSync(outPath, JSON.stringify(out, null, 2));
  console.log("Escrito:", outPath);
}

main()
  .catch((e) => {
    console.error("ERROR:", e.message);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
