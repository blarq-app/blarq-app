// Diagnóstico SOLO LECTURA: qué valores de BankMovement.category existen de verdad
// en la base, y cuántos movimientos tiene cada uno.
//
// Por qué existe: la lista de categorías de banco está copiada a mano en 4 archivos
// y el endpoint que guarda NO valida nada (acepta cualquier string). Antes de dejar
// UNA sola lista canónica hay que saber qué hay guardado realmente — si aparece un
// valor que la lista nueva no contempla, ese movimiento quedaría mostrando el texto
// crudo en la tabla.
//
// Uso: npx tsx scripts/diag-categorias-banco-uso.ts <ruta-env>
//
// OJO (§4.9 + memoria): NO usa `dotenv/config` a propósito. El shell y el `.env`
// pueden apuntar a la base VIEJA (ep-solitary-mud) y ganarle a lo que uno cargue
// después. Acá la URL se lee del archivo que le pasás y se inyecta como datasource
// directo, igual que diag-cual-base-viva.ts. No escribe nada.
import { PrismaClient } from "@prisma/client";
import { readFileSync } from "fs";

const envPath = process.argv[2];
if (!envPath) {
  console.error("uso: npx tsx scripts/diag-categorias-banco-uso.ts <ruta-env>");
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

const prisma = new PrismaClient({ datasources: { db: { url } } });

// Lo que hoy conoce el código (unión de las 4 copias + los que escribe el sistema).
const CONOCIDAS = new Set([
  "sueldo",
  "prestamo_socio",
  "retiro_personal",
  "bono_socio",
  "previred",
  "comision_bancaria",
  "impuestos",
  "deposito_efectivo",
  "otro_sin_factura",
  "compra_tarjeta",
  "transfer_interno",
  "reembolso_proveedor",
]);

async function main() {
  console.log("=== ENV:", envPath, "| HOST:", host, "===");

  // Marcador de base viva (§4.9): #64 debe ser "Paseo del Sena".
  const p64 = await prisma.project.findFirst({
    where: { numeroProyecto: 64 },
    select: { name: true },
  });
  const last = await prisma.invoice.findFirst({
    orderBy: { issueDate: "desc" },
    select: { issueDate: true },
  });
  console.log("  marcador #64:", p64?.name ?? "(no existe)");
  console.log("  última factura:", last?.issueDate?.toISOString().slice(0, 10) ?? "-");
  console.log("");

  const total = await prisma.bankMovement.count();
  const conCategoria = await prisma.bankMovement.count({
    where: { category: { not: null } },
  });
  console.log(`Movimientos totales: ${total} · con categoría: ${conCategoria}`);
  console.log("");

  const grupos = await prisma.bankMovement.groupBy({
    by: ["category"],
    _count: { _all: true },
    orderBy: { _count: { category: "desc" } },
  });

  console.log("categoría                 movs   ¿la conoce el código?");
  console.log("------------------------------------------------------");
  const desconocidas: string[] = [];
  for (const g of grupos) {
    const cat = g.category ?? "(null)";
    const known = g.category === null ? "—" : CONOCIDAS.has(g.category) ? "sí" : "NO ←";
    if (g.category && !CONOCIDAS.has(g.category)) desconocidas.push(g.category);
    console.log(
      `${cat.padEnd(24)} ${String(g._count._all).padStart(5)}   ${known}`
    );
  }
  console.log("");

  if (desconocidas.length) {
    console.log("OJO — valores guardados que NINGÚN mapa de etiquetas conoce:");
    for (const d of desconocidas) console.log("  ·", d);
  } else {
    console.log("No hay valores fuera de la lista conocida.");
  }

  // Detalle de las candidatas a limpieza / que faltan en algún mapa.
  for (const cat of ["compra_tarjeta", "reembolso_proveedor"]) {
    const n = await prisma.bankMovement.count({ where: { category: cat } });
    if (n === 0) {
      console.log(`\n"${cat}": 0 movimientos.`);
      continue;
    }
    const ejemplos = await prisma.bankMovement.findMany({
      where: { category: cat },
      orderBy: { date: "desc" },
      take: 5,
      select: { date: true, description: true, amount: true, status: true },
    });
    console.log(`\n"${cat}": ${n} movimientos. Últimos:`);
    for (const e of ejemplos) {
      console.log(
        `  ${e.date.toISOString().slice(0, 10)} ${String(e.amount).padStart(12)} [${e.status}] ${e.description.slice(0, 55)}`
      );
    }
  }
}

main()
  .catch((e) => console.error("ERROR:", e.message))
  .finally(() => prisma.$disconnect());
