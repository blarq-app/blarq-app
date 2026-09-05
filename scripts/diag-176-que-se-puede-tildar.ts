// SOLO LECTURA (pendiente 176): de las líneas que hoy quedarían marcadas en
// las versiones VIGENTES, ¿cuáles se pueden apagar tildando el material en el
// catálogo? Solo se puede tildar la línea que está enganchada a un material
// (materialId). Las escritas a mano no tienen dónde poner el tilde.
// Uso: npx tsx scripts/diag-176-que-se-puede-tildar.ts <ruta-env-prod>
import { PrismaClient } from "@prisma/client";
import { readFileSync } from "fs";

const raw = readFileSync(process.argv[2], "utf8");
const url = raw.match(/DATABASE_URL\s*=\s*"?([^"\n]+)"?/)![1].trim();
const prisma = new PrismaClient({ datasources: { db: { url } } });

const esProvision = (d: string) => /^\s*PROVISI[OÓ]N\b/i.test(d);

async function main() {
  const todas = await prisma.budgetVersion.findMany({
    where: { type: "obra" },
    select: { id: true, projectId: true, status: true, createdAt: true, version: true },
  });
  const porProyecto = new Map<string, typeof todas>();
  for (const v of todas) {
    const a = porProyecto.get(v.projectId) ?? [];
    a.push(v);
    porProyecto.set(v.projectId, a);
  }
  const desc = (a: (typeof todas)[0], b: (typeof todas)[0]) =>
    b.createdAt.getTime() - a.createdAt.getTime();
  const vigentes = [...porProyecto.values()].map((a) => {
    const pub = a.filter((v) => v.status === "enviado" || v.status === "aprobado").sort(desc);
    return pub[0] ?? [...a].sort(desc)[0];
  });

  const comps = await prisma.obraItemComponent.findMany({
    where: {
      type: "material",
      quantity: 0,
      obraItem: { budgetVersionId: { in: vigentes.map((v) => v.id) } },
    },
    include: {
      material: { select: { id: true, name: true, isProvision: true } },
      obraItem: {
        select: {
          name: true,
          budgetVersion: { select: { project: { select: { name: true } } } },
        },
      },
    },
  });

  const marcadas = comps.filter(
    (c) => !esProvision(c.description) && c.material?.isProvision !== true && (c.unitCost || 0) > 0
  );

  const conMaterial = marcadas.filter((c) => c.materialId);
  const sinMaterial = marcadas.filter((c) => !c.materialId);

  console.log(`marcadas hoy en versiones vigentes: ${marcadas.length}\n`);

  console.log("=== SE PUEDEN APAGAR con el tilde (tienen material del catálogo) ===");
  const porMaterial = new Map<string, { nombre: string; obras: string[] }>();
  for (const c of conMaterial) {
    const k = c.material!.id;
    const e = porMaterial.get(k) ?? { nombre: c.material!.name, obras: [] };
    e.obras.push(c.obraItem.budgetVersion.project.name);
    porMaterial.set(k, e);
  }
  for (const [id, e] of porMaterial) {
    console.log(`  ${e.nombre}`);
    console.log(`    id=${id} · ${e.obras.length} líneas · ${[...new Set(e.obras)].join(", ")}`);
  }

  console.log("\n=== NO tienen material del catálogo: el tilde no llega ===");
  for (const c of sinMaterial) {
    console.log(
      `  ${c.obraItem.budgetVersion.project.name.padEnd(24)} ${c.obraItem.name.slice(0, 30).padEnd(32)} ${c.description.slice(0, 44)}`
    );
  }
}
main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
