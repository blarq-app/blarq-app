/**
 * Re-empalma el lineageId de las partidas de la V2 de obra de Paseo del Sena
 * que salen marcadas "NUEVO" siendo que YA existían en V1-Separado (la versión
 * enviada que sirve de base al comparador).
 *
 * Causa: el de-duplicador de lineageId (scripts/fix-duplicate-lineage.ts) asignó
 * DNIs nuevos a las partidas separadas en zonas COCINA/BAÑO, pero versión por
 * versión sin coordinar → la misma partida quedó con DNI distinto en
 * V1-Separado y en V2. El comparador empareja por DNI y las ve como nuevas.
 *
 * Arreglo: por cada partida de V2 cuyo DNI no está en la foto de V1-Separado
 * pero existe en la foto UNA partida idéntica (mismo capítulo + zona + nombre)
 * con otro DNI, se reapunta el DNI de V2 al de la foto (el canónico). Se mueve
 * EN BLOQUE el ObraItem de V2 y los EstadoPagoItem que lo referencian, así no se
 * pierde el avance registrado en los EP (ambos en borrador). Δ plata = 0.
 *
 * Seguro: chequea que el DNI destino no colisione con otro item de V2 ni con
 * otro item del mismo EP (constraint @@unique[estadoPagoId, lineageId]).
 *
 * Uso:
 *   DOTENV_CONFIG_PATH=.env.prod npx tsx scripts/fix-sena-v2-lineage.ts            # dry-run
 *   DOTENV_CONFIG_PATH=.env.prod npx tsx scripts/fix-sena-v2-lineage.ts --apply
 */
import "dotenv/config";
import { writeFileSync, mkdirSync } from "fs";
import { prisma } from "../src/lib/prisma";

const APPLY = process.argv.includes("--apply");
const norm = (s: string | null | undefined) =>
  (s ?? "").trim().toUpperCase().replace(/\s+/g, " ");

async function main() {
  const p = await prisma.project.findFirst({
    where: { name: { contains: "Paseo del Sena", mode: "insensitive" } },
    select: { id: true, name: true },
  });
  if (!p) throw new Error("no project");

  const bvs = await prisma.budgetVersion.findMany({
    where: { projectId: p.id, type: "obra" },
    select: { id: true, version: true, sentSnapshot: true },
  });
  const sep = bvs.find((b) => b.version === "V1-Separado");
  const v2 = bvs.find((b) => b.version === "V2");
  if (!sep || !v2) throw new Error("falta V1-Separado o V2");

  const snapItems: { lineageId: string; chapter: string; subChapter?: string | null; name: string }[] =
    (sep.sentSnapshot as any)?.obraItems ?? [];
  const snapLineage = new Set(snapItems.map((i) => i.lineageId));
  const snapByKey = new Map<string, string[]>();
  for (const si of snapItems) {
    const k = `${norm(si.chapter)}|${norm(si.subChapter)}|${norm(si.name)}`;
    if (!snapByKey.has(k)) snapByKey.set(k, []);
    snapByKey.get(k)!.push(si.lineageId);
  }

  const v2Items = await prisma.obraItem.findMany({
    where: { budgetVersionId: v2.id },
    select: { id: true, lineageId: true, chapter: true, subChapter: true, name: true },
  });
  const v2Lineage = new Set(v2Items.map((i) => i.lineageId));

  // Construir el mapa de re-empalme: falso NUEVO con UN único par en la foto.
  const repairs: { id: string; name: string; oldLin: string; newLin: string }[] = [];
  for (const it of v2Items) {
    if (snapLineage.has(it.lineageId)) continue;
    const k = `${norm(it.chapter)}|${norm(it.subChapter)}|${norm(it.name)}`;
    const cands = (snapByKey.get(k) ?? []).filter((l) => !v2Lineage.has(l));
    if (cands.length === 1) {
      repairs.push({ id: it.id, name: `${it.chapter}/${it.subChapter ?? "-"} ${it.name}`, oldLin: it.lineageId, newLin: cands[0] });
    }
  }

  console.log(`Proyecto: ${p.name}`);
  console.log(`Re-empalmes detectados: ${repairs.length}\n`);
  for (const r of repairs) console.log(`  ${r.name}\n    ${r.oldLin} → ${r.newLin}`);

  // Chequeos de seguridad + recolectar EP items a mover.
  const epItemsToMove: { id: string; estadoPagoId: string; oldLin: string; newLin: string }[] = [];
  for (const r of repairs) {
    // colisión en V2: el destino no debe pertenecer ya a otro item de V2
    const clashV2 = v2Items.find((i) => i.lineageId === r.newLin && i.id !== r.id);
    if (clashV2) throw new Error(`COLISIÓN V2: ${r.newLin} ya usado por ${clashV2.name}`);

    const epItems = await prisma.estadoPagoItem.findMany({
      where: { estadoPago: { projectId: p.id }, lineageId: r.oldLin },
      select: { id: true, estadoPagoId: true },
    });
    for (const epi of epItems) {
      // colisión en EP: el mismo EP no debe tener ya un item con el DNI destino
      const clashEp = await prisma.estadoPagoItem.findFirst({
        where: { estadoPagoId: epi.estadoPagoId, lineageId: r.newLin },
        select: { id: true },
      });
      if (clashEp) throw new Error(`COLISIÓN EP ${epi.estadoPagoId}: ya tiene ${r.newLin}`);
      epItemsToMove.push({ id: epi.id, estadoPagoId: epi.estadoPagoId, oldLin: r.oldLin, newLin: r.newLin });
    }
  }
  console.log(`\nEP items a mover en bloque: ${epItemsToMove.length}`);

  // Respaldo
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  mkdirSync("backups", { recursive: true });
  const backupPath = `backups/fix-sena-v2-lineage-${stamp}.json`;
  writeFileSync(backupPath, JSON.stringify({ project: p, repairs, epItemsToMove }, null, 2));
  console.log(`Respaldo: ${backupPath}`);

  if (!APPLY) {
    console.log("\nDRY-RUN — nada escrito. Re-correr con --apply para aplicar.");
    return;
  }

  await prisma.$transaction(async (tx) => {
    for (const r of repairs) {
      await tx.obraItem.update({ where: { id: r.id }, data: { lineageId: r.newLin } });
    }
    for (const e of epItemsToMove) {
      await tx.estadoPagoItem.update({ where: { id: e.id }, data: { lineageId: e.newLin } });
    }
  });
  console.log(`\nAPLICADO — ${repairs.length} partidas + ${epItemsToMove.length} EP items re-empalmados.`);
}
main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
