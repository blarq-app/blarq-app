// Normaliza el campo `chapter` de ObraItem a las 8 keys oficiales
// (lib/utils.ts > OBRA_CHAPTERS). Históricamente, el script
// import-budget.ts cargaba chapter con el nombre en MAYÚSCULAS del
// Excel (DEMOLICIONES, INSTALACIONES SANITARIAS, etc), pero el editor
// y el resto del front esperan las keys lowercase. Resultado: las
// partidas existían en BD pero no aparecían en los capítulos del
// editor.
//
// Idempotente. Aplicar en dev y prod.

import "dotenv/config";
import { prisma } from "../src/lib/prisma";

const MAPPING: Record<string, string> = {
  // Mapeos directos (mayúsculas → lowercase oficial)
  "DEMOLICIONES": "demoliciones",
  "DEMOLICION": "demoliciones",
  "OBRA GRUESA": "obra_gruesa",
  "REPARACIONES": "reparaciones",
  "INSTALACIONES SANITARIAS": "sanitarias",
  "INSTALACIONES ELECTRICAS": "electricas",
  "TERMINACIONES": "terminaciones",
  "ADICIONALES": "adicionales",
  "LIMPIEZA Y ASEO": "limpieza",
  "ASEO Y LIMPIEZA": "limpieza",

  // Mapeos opinados — chapters que no calzan 1:1 con los oficiales:
  "INSTALACIONES GAS": "sanitarias", // gas es plomería
  "INSTALACIONES SANITARIAS Y GASFITERIA": "sanitarias",
  "INSTALACIONES_SANITARIAS_Y_GASFITERIA": "sanitarias", // ya normalizado mal
  "AISLACION E IMPERMEABILIZACION": "obra_gruesa",
  "CLIMATIZACION Y AISLACION TERMICA": "terminaciones",
  "PAISAJISMO": "adicionales",
};

async function main() {
  const items = await prisma.obraItem.findMany({
    select: { id: true, chapter: true },
  });

  // 8 keys oficiales — las dejamos como están
  const OFFICIAL = new Set(["demoliciones", "obra_gruesa", "reparaciones", "sanitarias", "electricas", "terminaciones", "limpieza", "adicionales"]);

  const stats: Record<string, number> = {};
  let updated = 0;
  for (const it of items) {
    if (OFFICIAL.has(it.chapter)) continue; // ya OK
    // Búsqueda en MAPPING — case-insensitive y tolera underscores
    const upper = it.chapter.toUpperCase().replace(/_/g, " ");
    const target = MAPPING[upper] ?? MAPPING[it.chapter.toUpperCase()];
    if (!target) {
      console.log(`  ⚠ chapter desconocido: "${it.chapter}" (mantener)`);
      continue;
    }
    if (target === it.chapter) continue;
    await prisma.obraItem.update({
      where: { id: it.id },
      data: { chapter: target },
    });
    stats[`${it.chapter} → ${target}`] = (stats[`${it.chapter} → ${target}`] ?? 0) + 1;
    updated++;
  }

  console.log(`\nActualizados: ${updated}`);
  for (const [k, v] of Object.entries(stats).sort()) console.log(`  ${k}: ${v}`);

  // Mostrar lo que quedó (debería ser solo lowercase)
  const after = await prisma.obraItem.findMany({ select: { chapter: true } });
  const set = new Set(after.map((i) => i.chapter));
  console.log(`\nValores finales en BD:`);
  for (const v of [...set].sort()) console.log(`  "${v}"`);

  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
