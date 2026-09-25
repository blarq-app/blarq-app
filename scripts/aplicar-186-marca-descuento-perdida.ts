/**
 * Pendiente 186 — devuelve la marca de "el descuento lo puso MJ"
 * (`discountOverridden`) a las líneas que la perdieron al duplicar la versión.
 * Solo cambia esa MARCA, nunca un precio ni la marca de "no sigue al
 * catálogo": ningún total se mueve.
 *
 * Por qué: hasta el 2026-09-25 "Duplicar" copiaba el porcentaje pero no la
 * marca (arreglado en el mismo PR). El caso real son los 10% de Teka en Casa
 * Los Algarrobos V3→V4: el horno, el microondas, la campana, la encimera y el
 * freezer siguen protegidos porque además están despegados, pero el grifo
 * lavadero quedó sin ninguna protección. Si alguien cambia el precio de ese
 * producto en el catálogo, su 10% pasaría al descuento del catálogo. OK de MJ
 * el 2026-09-25 ("Sí, a los 6").
 *
 * Se busca, en cada versión en BORRADOR con versión madre, la línea
 * equivalente (mismo nombre, ambiente y producto) cuya madre tenía la marca,
 * con el MISMO porcentaje (si MJ lo cambió después, no es una pérdida).
 *
 * Antes de escribir guarda un respaldo con el estado previo. En la base viva
 * exige además --si-la-viva.
 *
 *   npx tsx scripts/aplicar-186-marca-descuento-perdida.ts <ruta-env>                          (prueba)
 *   npx tsx scripts/aplicar-186-marca-descuento-perdida.ts <ruta-env> --aplicar --si-la-viva   (escribe)
 */
import { PrismaClient } from "@prisma/client";
import { readFileSync, writeFileSync, mkdirSync } from "fs";

const envPath = process.argv[2];
if (!envPath) throw new Error("Falta la ruta del .env como argumento.");
const APLICAR = process.argv.includes("--aplicar");
const SI_LA_VIVA = process.argv.includes("--si-la-viva");
const url = readFileSync(envPath, "utf8")
  .match(/DATABASE_URL\s*=\s*"?([^"\n]+)"?/)?.[1]
  ?.trim();
if (!url) throw new Error(`No hay DATABASE_URL en ${envPath}`);
const host = url.match(/@([^/:]+)/)?.[1] ?? "?";
const esLaViva = /shy-morning/.test(host);
if (APLICAR && esLaViva && !SI_LA_VIVA)
  throw new Error("Es la base VIVA: para escribir agregá --si-la-viva (con el OK de MJ).");
const prisma = new PrismaClient({ datasources: { db: { url } } });

const clp = (n: number) => "$" + Math.round(n).toLocaleString("es-CL");
const pct = (d: number | null) => `${Math.round((d ?? 0) * 1000) / 10}%`;

async function main() {
  console.log(`Base: ${host}${esLaViva ? " (LA VIVA)" : ""} · ${APLICAR ? "APLICANDO" : "prueba, sin escribir"}\n`);

  const borradores = await prisma.budgetVersion.findMany({
    where: { type: "artefactos", status: "borrador", parentVersionId: { not: null } },
    select: {
      id: true,
      version: true,
      parentVersionId: true,
      project: { select: { numeroProyecto: true, name: true } },
      artefactoItems: true,
    },
  });

  const aMarcar: { id: string; donde: string; nombre: string }[] = [];
  for (const v of borradores) {
    const madre = await prisma.artefactoItem.findMany({
      where: { budgetVersionId: v.parentVersionId!, discountOverridden: true },
      select: { name: true, room: true, catalogId: true, discountPercent: true },
    });
    for (const m of madre) {
      const l = v.artefactoItems.find(
        (x) =>
          x.name === m.name &&
          x.room === m.room &&
          x.catalogId === m.catalogId &&
          !x.discountOverridden &&
          Math.abs((x.discountPercent ?? 0) - (m.discountPercent ?? 0)) < 0.0005
      );
      if (!l) continue;
      aMarcar.push({
        id: l.id,
        donde: `#${v.project.numeroProyecto ?? "-"} ${v.project.name} ${v.version}`,
        nombre: `${l.name} (${l.room}) ${pct(l.discountPercent)}${l.priceOverridden ? "" : "  ← hoy sin ninguna protección"}`,
      });
    }
  }

  console.log(`Líneas a las que se les devuelve la marca de descuento de MJ: ${aMarcar.length}`);
  for (const c of aMarcar) console.log(`   ${c.donde.padEnd(32)} ${c.nombre}`);
  console.log("");

  if (!APLICAR) {
    console.log("Prueba: no se escribió nada.");
    return;
  }
  if (aMarcar.length === 0) {
    console.log("Nada que aplicar.");
    return;
  }

  // Respaldo del estado previo de cada línea tocada, y total de control.
  const ids = aMarcar.map((c) => c.id);
  const antes = await prisma.artefactoItem.findMany({ where: { id: { in: ids } } });
  mkdirSync("backups", { recursive: true });
  const respaldo = `backups/186-antes-de-marca-descuento-${host.split(".")[0]}-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-")}.json`;
  writeFileSync(respaldo, JSON.stringify(antes, null, 2));
  console.log(`Respaldo: ${respaldo}`);
  const total = async () =>
    (await prisma.artefactoItem.findMany({
      where: { budgetVersionId: { in: borradores.map((b) => b.id) } },
      select: { clientPrice: true, quantity: true },
    })).reduce((s, i) => s + i.clientPrice * i.quantity, 0);
  const totalAntes = await total();

  const r = await prisma.artefactoItem.updateMany({
    where: { id: { in: ids }, discountOverridden: false },
    data: { discountOverridden: true },
  });

  const totalDespues = await total();
  console.log(`Marcadas ${r.count} líneas.`);
  console.log(`Total al cliente de esos borradores: antes ${clp(totalAntes)} · después ${clp(totalDespues)}`);
  if (Math.abs(totalAntes - totalDespues) > 0.5) throw new Error("¡El total se movió! Revisar con el respaldo.");
}

main()
  .catch((e) => {
    console.error("ERROR:", e.message ?? e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
