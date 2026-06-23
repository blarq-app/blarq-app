import "dotenv/config";
import { prisma } from "../src/lib/prisma";

// Solo lectura. Mapea TODAS las partidas de la V2 de obra de Paseo del Sena que
// el comparador marca NUEVO (lineageId no está en la foto de V1-Separado) y, de
// ellas, cuáles son "falsos NUEVO" porque existe en la foto una partida idéntica
// (mismo capítulo + zona + nombre) con OTRO lineageId. Para esas propone el
// re-empalme del lineageId.
function norm(s: string | null | undefined) {
  return (s ?? "").trim().toUpperCase().replace(/\s+/g, " ");
}
async function main() {
  const p = await prisma.project.findFirst({
    where: { name: { contains: "Paseo del Sena", mode: "insensitive" } },
    select: { id: true },
  });
  if (!p) return;
  const bvs = await prisma.budgetVersion.findMany({
    where: { projectId: p.id, type: "obra" },
    select: { id: true, version: true, sentSnapshot: true },
  });
  const sep = bvs.find(b => b.version === "V1-Separado")!;
  const v2 = bvs.find(b => b.version === "V2")!;
  const snapItems: any[] = (sep.sentSnapshot as any)?.obraItems ?? [];
  const snapLineageSet = new Set(snapItems.map(i => i.lineageId));
  // índice de la foto por (capítulo|zona|nombre)
  const snapByKey = new Map<string, any[]>();
  for (const si of snapItems) {
    const k = `${norm(si.chapter)}|${norm(si.subChapter)}|${norm(si.name)}`;
    (snapByKey.get(k) ?? snapByKey.set(k, []).get(k)!).push(si);
  }

  const v2Items = await prisma.obraItem.findMany({
    where: { budgetVersionId: v2.id },
    orderBy: [{ chapter: "asc" }, { sortOrder: "asc" }],
    select: { id: true, lineageId: true, chapter: true, subChapter: true, name: true, total: true },
  });
  const v2LineageSet = new Set(v2Items.map(i => i.lineageId));

  const repairs: { id: string; name: string; chapter: string; sub: string; oldLin: string; newLin: string }[] = [];
  const trulyNew: string[] = [];

  console.log("=== Partidas V2 marcadas NUEVO (lineageId fuera de la foto) ===\n");
  for (const it of v2Items) {
    if (snapLineageSet.has(it.lineageId)) continue; // calza → no es NUEVO
    const k = `${norm(it.chapter)}|${norm(it.subChapter)}|${norm(it.name)}`;
    const matches = (snapByKey.get(k) ?? []).filter(si => !v2LineageSet.has(si.lineageId));
    if (matches.length === 1) {
      const target = matches[0].lineageId;
      repairs.push({ id: it.id, name: it.name, chapter: it.chapter, sub: it.subChapter ?? "-", oldLin: it.lineageId, newLin: target });
      console.log(`  FALSO NUEVO  [${it.chapter}/${it.subChapter ?? "-"}] ${it.name.slice(0,38).padEnd(38)}  ${it.lineageId} → ${target}`);
    } else if (matches.length === 0) {
      trulyNew.push(`[${it.chapter}/${it.subChapter ?? "-"}] ${it.name}`);
      console.log(`  NUEVO REAL   [${it.chapter}/${it.subChapter ?? "-"}] ${it.name.slice(0,38).padEnd(38)}  (sin par en la foto)`);
    } else {
      console.log(`  AMBIGUO      [${it.chapter}/${it.subChapter ?? "-"}] ${it.name.slice(0,38).padEnd(38)}  ${matches.length} candidatos en la foto`);
    }
  }

  console.log(`\nResumen: ${repairs.length} falsos NUEVO reparables · ${trulyNew.length} nuevos reales`);

  // Chequeos de seguridad para el re-empalme
  // 1) que el nuevo lineageId no colisione con otro item de V2
  for (const r of repairs) {
    if (v2LineageSet.has(r.newLin)) console.log(`  ⚠ COLISIÓN: ${r.newLin} ya existe en V2`);
  }
  // 2) ¿hay EstadoPagoItem que referencie los lineageId viejos de V2?
  const epCount = await prisma.estadoPagoItem.count({
    where: { estadoPago: { projectId: p.id }, lineageId: { in: repairs.map(r => r.oldLin) } },
  });
  console.log(`  EstadoPagoItem que usan los lineageId viejos de V2: ${epCount}`);

  // dump del plan para el fix
  console.log("\nPLAN (id → newLineage):");
  for (const r of repairs) console.log(`  ${r.id}  ${r.oldLin} → ${r.newLin}`);
}
main().catch(e => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
