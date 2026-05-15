/**
 * Snapshot retroactivo de ObraItemComponent desde el catálogo.
 *
 * Para proyectos creados DENTRO de la app (no importados desde Excel), los
 * ObraItem tienen `catalogPartidaId` apuntando a una PartidaCatalog, pero
 * pueden no tener sus `ObraItemComponent` poblados — eso pasa con
 * proyectos creados antes de que el endpoint POST partidas snapshoteara
 * automáticamente.
 *
 * Este script: para cada ObraItem con catalogPartidaId y components vacíos,
 * copia los components del catálogo al snapshot del proyecto. Replica la
 * misma lógica que `/api/presupuestos/[id]/partidas/route.ts:64-101`.
 *
 * Dry-run por defecto. Para escribir: --apply
 *
 * Uso:
 *   npx tsx -r dotenv/config scripts/snapshot-components-from-catalog.ts \
 *     --project "Constanza" [--version "V1_Sin"] [--apply]
 */
import "dotenv/config";
import { prisma } from "../src/lib/prisma";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return undefined;
  return process.argv[i + 1];
}
const PROJECT_NAME = arg("project");
const BUDGET_VERSION = arg("version");
const APPLY = process.argv.includes("--apply");

if (!PROJECT_NAME) {
  console.error("Falta --project NAME");
  process.exit(1);
}

async function main() {
  const project = await prisma.project.findFirst({
    where: { name: { contains: PROJECT_NAME!, mode: "insensitive" } },
  });
  if (!project) throw new Error(`Proyecto '${PROJECT_NAME}' no encontrado`);

  const budgets = await prisma.budgetVersion.findMany({
    where: {
      projectId: project.id,
      type: "obra",
      ...(BUDGET_VERSION ? { version: BUDGET_VERSION } : {}),
    },
    include: {
      obraItems: {
        include: { components: { select: { id: true } } },
      },
    },
  });

  console.log(`\nProyecto: ${project.name}`);
  for (const b of budgets) {
    const targets = b.obraItems.filter(
      (i) => i.catalogPartidaId && i.components.length === 0
    );
    console.log(
      `  ${b.version} (${b.status}) · ${b.obraItems.length} items · ${targets.length} a snapshotear`
    );

    if (targets.length === 0) continue;

    let created = 0;
    for (const it of targets) {
      const catalogComps = await prisma.partidaComponent.findMany({
        where: { partidaId: it.catalogPartidaId! },
        orderBy: { sortOrder: "asc" },
      });
      if (catalogComps.length === 0) {
        console.log(
          `    ${it.itemNumber} ${it.name} · catálogo sin components, skip`
        );
        continue;
      }

      if (!APPLY) {
        console.log(
          `    ${it.itemNumber} ${it.name} · ${catalogComps.length} components a copiar (dry-run)`
        );
        continue;
      }

      // Replica la lógica del endpoint POST partidas (route.ts:64-101).
      const idMap = new Map<string, string>();
      const createdLog: Array<{ source: (typeof catalogComps)[number]; newId: string }> = [];
      for (const c of catalogComps) {
        const newComp = await prisma.obraItemComponent.create({
          data: {
            obraItemId: it.id,
            type: c.type,
            description: c.description,
            unit: c.unit,
            quantity: c.quantity,
            unitCost: c.unitCost,
            totalCost: c.totalCost,
            referenceLink: c.referenceLink,
            materialId: c.materialId,
            sortOrder: c.sortOrder,
            appliedToType: c.appliedToType,
          },
        });
        idMap.set(c.id, newComp.id);
        createdLog.push({ source: c, newId: newComp.id });
      }
      // Segunda pasada: resolver appliedToComponentId
      for (const { source, newId } of createdLog) {
        if (source.appliedToComponentId) {
          const target = idMap.get(source.appliedToComponentId);
          if (target) {
            await prisma.obraItemComponent.update({
              where: { id: newId },
              data: { appliedToComponentId: target },
            });
          }
        }
      }
      created += catalogComps.length;
    }
    if (APPLY) {
      console.log(`    Total components creados: ${created}`);
    }
  }

  if (!APPLY) {
    console.log("\n(dry-run. Para escribir, correr con --apply)");
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
