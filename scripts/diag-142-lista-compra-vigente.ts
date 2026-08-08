// Diagnóstico SOLO LECTURA (pendiente 142).
//
// Compara, para cada proyecto con presupuesto de obra, qué versión tomaba la
// Lista de compra ANTES (la aprobada más reciente; si no hay, la más reciente
// de cualquier estado) contra la que toma DESPUÉS (selectVigente: la más
// reciente entre enviada y aprobada). Para los proyectos que cambian, imprime
// además el antes/después de la lista de materiales.
//
// No escribe nada. Uso:
//   npx tsx scripts/diag-142-lista-compra-vigente.ts <ruta-env>
// (§4.9: se le pasa el env a mano, NO usa dotenv, para no leer la base vieja.)
import { PrismaClient } from "@prisma/client";
import { readFileSync } from "fs";
import { selectVigente } from "../src/lib/projects/selectVersion";
import { aggregateShoppingItems } from "../src/lib/listaCompra/perdidaCantidad";

const envPath = process.argv[2];
if (!envPath) {
  console.error("uso: npx tsx scripts/diag-142-lista-compra-vigente.ts <ruta-env>");
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

// Criterio VIEJO de la lista de compra (los tres caminos hacían lo mismo).
type V = { id: string; version: string; status: string; createdAt: Date };
function seleccionVieja(versions: V[]): V | null {
  const desc = [...versions].sort(
    (a, b) => b.createdAt.getTime() - a.createdAt.getTime()
  );
  return desc.find((b) => b.status === "aprobado") ?? desc[0] ?? null;
}

async function materialesDe(budgetVersionId: string) {
  const items = await prisma.obraItem.findMany({
    where: { budgetVersionId },
    include: { components: { include: { material: true } } },
  });
  const agg = aggregateShoppingItems(items, true);
  return [...agg.values()]
    .map((a) => ({ name: a.name, unit: a.unit, qty: a.qtyNeeded }))
    .sort((x, y) => x.name.localeCompare(y.name));
}

async function main() {
  console.log(`=== BASE: ${host} (${envPath}) ===`);
  // Marcador §4.9 para confirmar que es la viva.
  const p64 = await prisma.project.findFirst({
    where: { numeroProyecto: 64 },
    select: { name: true },
  });
  console.log(`Marcador: proyecto #64 = ${p64?.name ?? "(no existe)"}`);
  console.log(`${host === "ep-shy-morning-anuapn5q-pooler" ? "→ es la VIVA" : "→ OJO: NO es la viva"}\n`);

  const projects = await prisma.project.findMany({
    select: {
      id: true,
      name: true,
      numeroProyecto: true,
      budgetVersions: {
        where: { type: "obra" },
        select: { id: true, version: true, status: true, createdAt: true },
      },
    },
    orderBy: { numeroProyecto: "asc" },
  });

  const cambian: {
    proyecto: string;
    versiones: string;
    antes: V;
    despues: V;
  }[] = [];

  for (const p of projects) {
    if (p.budgetVersions.length === 0) continue;
    const antes = seleccionVieja(p.budgetVersions);
    const despues = selectVigente(p.budgetVersions) ?? null;
    if (!antes || !despues) continue;
    if (antes.id === despues.id) continue;

    cambian.push({
      proyecto: `#${p.numeroProyecto ?? "-"} ${p.name}`,
      versiones: [...p.budgetVersions]
        .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
        .map((v) => `${v.version} ${v.status}`)
        .join(" · "),
      antes,
      despues,
    });
  }

  console.log(
    `Proyectos con presupuesto de obra: ${projects.filter((p) => p.budgetVersions.length > 0).length}`
  );
  console.log(`Proyectos donde la Lista de compra CAMBIA de versión: ${cambian.length}\n`);

  for (const c of cambian) {
    console.log("─".repeat(70));
    console.log(`${c.proyecto}`);
    console.log(`  versiones: ${c.versiones}`);
    console.log(`  ANTES  → ${c.antes.version} (${c.antes.status})`);
    console.log(`  DESPUÉS→ ${c.despues.version} (${c.despues.status})`);

    const [ma, md] = await Promise.all([
      materialesDe(c.antes.id),
      materialesDe(c.despues.id),
    ]);
    console.log(`  materiales: ${ma.length} → ${md.length}`);

    const keyOf = (r: { name: string; unit: string }) =>
      `${r.name.trim().toLowerCase()}|${r.unit.trim().toLowerCase()}`;
    const mapA = new Map(ma.map((r) => [keyOf(r), r]));
    const mapD = new Map(md.map((r) => [keyOf(r), r]));

    const salen = ma.filter((r) => !mapD.has(keyOf(r)));
    const entran = md.filter((r) => !mapA.has(keyOf(r)));
    const cambianQty = ma
      .filter((r) => mapD.has(keyOf(r)))
      .map((r) => ({ r, d: mapD.get(keyOf(r))! }))
      .filter(({ r, d }) => Math.abs(r.qty - d.qty) > 0.001);

    if (salen.length)
      console.log(
        `  SALEN (${salen.length}): ${salen.map((r) => `${r.name} [${r.qty} ${r.unit}]`).join(" | ")}`
      );
    if (entran.length)
      console.log(
        `  ENTRAN (${entran.length}): ${entran.map((r) => `${r.name} [${r.qty} ${r.unit}]`).join(" | ")}`
      );
    if (cambianQty.length)
      console.log(
        `  CAMBIA CANTIDAD (${cambianQty.length}): ${cambianQty
          .map(({ r, d }) => `${r.name}: ${r.qty} → ${d.qty} ${r.unit}`)
          .join(" | ")}`
      );
    if (!salen.length && !entran.length && !cambianQty.length)
      console.log("  (la lista de materiales queda IGUAL)");
  }
  console.log("─".repeat(70));
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
