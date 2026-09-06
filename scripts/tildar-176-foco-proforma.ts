// Marca UN material del catálogo como provisión: FOCO VALOR PROFORMA $25.000
// IVA INCL (pendiente 176). Es un artefacto que BLARQ instala pero NO provee
// — va en la cotización de artefactos, aparte — así que su línea en cantidad 0
// está bien puesta y no tiene que dispararle el aviso de "material sin cobrar".
//
// Autorizado por MJ el 2026-09-05. Toca UN registro y UN campo: no mueve
// ningún total (el `unitCost` guardado sigue siendo el neto; `isProvision`
// solo cambia cómo se muestra y a quién se le avisa).
//
// Dry-run por defecto. Para escribir: --apply
// Uso: npx tsx scripts/tildar-176-foco-proforma.ts <ruta-env-prod> [--apply]
import { PrismaClient } from "@prisma/client";
import { readFileSync } from "fs";

const MATERIAL_ID = "cmnxwn612007qrtw2osej539i";
const NOMBRE_ESPERADO = "FOCO VALOR PROFORMA $25.000 IVA INCL";

const raw = readFileSync(process.argv[2], "utf8");
const url = raw.match(/DATABASE_URL\s*=\s*"?([^"\n]+)"?/)![1].trim();
const host = url.match(/@([^/.]+)/)?.[1] ?? "?";
const apply = process.argv.includes("--apply");
const prisma = new PrismaClient({ datasources: { db: { url } } });

async function main() {
  console.log(`HOST: ${host} · modo: ${apply ? "APPLY (escribe)" : "dry-run"}\n`);

  const mat = await prisma.materialCatalog.findUnique({ where: { id: MATERIAL_ID } });
  if (!mat) throw new Error("no existe el material " + MATERIAL_ID);

  // Guarda: si el nombre no es el que MJ aprobó, no se toca nada. El id se
  // sacó de un diagnóstico y un id equivocado escribiría en otro material.
  if (mat.name !== NOMBRE_ESPERADO) {
    throw new Error(
      `el material ${MATERIAL_ID} se llama "${mat.name}", no "${NOMBRE_ESPERADO}" — no toco nada`
    );
  }

  console.log(`material: ${mat.name}`);
  console.log(`  categoría: ${mat.category} · neto $${Math.round(mat.netPrice).toLocaleString("es-CL")}`);
  console.log(`  isProvision: ${mat.isProvision} → true\n`);

  const usos = await prisma.obraItemComponent.count({ where: { materialId: MATERIAL_ID } });
  const enCatalogo = await prisma.partidaComponent.count({ where: { materialId: MATERIAL_ID } });
  console.log(`líneas que lo usan: ${usos} en obras · ${enCatalogo} en el catálogo de partidas`);

  if (mat.isProvision) {
    console.log("\nya estaba tildado — nada que hacer.");
    return;
  }
  if (!apply) {
    console.log("\ndry-run: no se escribió nada. Correr con --apply para aplicar.");
    return;
  }

  await prisma.materialCatalog.update({
    where: { id: MATERIAL_ID },
    data: { isProvision: true },
  });
  const post = await prisma.materialCatalog.findUniqueOrThrow({ where: { id: MATERIAL_ID } });
  console.log(`\nAPLICADO. isProvision quedó en ${post.isProvision}.`);
}
main()
  .catch((e) => {
    console.error(String(e));
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
