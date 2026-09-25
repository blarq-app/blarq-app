/**
 * Pendiente 186 — corrección de datos de una vez, sobre las líneas de
 * artefactos de cotizaciones en BORRADOR. Solo cambia MARCAS, nunca un precio:
 * ningún total se mueve al correrlo.
 *
 * Tres partes (se eligen con --partes; por defecto se muestran todas):
 *
 *   A · Líneas que dicen "no sigue al catálogo" pero tienen EXACTAMENTE el
 *       precio del catálogo (lista, descuento y precio al cliente). Nadie
 *       decidió nada ahí: se despegaron aplicando la tienda o por el modal viejo
 *       y después el catálogo se puso al día. → vuelven a seguir al catálogo.
 *       OK de MJ el 2026-09-25 ("Sí, las 5").
 *
 *   B · Marca de "el descuento lo puso MJ" perdida al crear la versión: hasta el
 *       2026-09-25 "Duplicar" copiaba el porcentaje pero no la marca. Se busca
 *       la línea equivalente (mismo nombre, ambiente y producto) cuya madre
 *       tenía la marca, con el MISMO porcentaje. → se devuelve la marca.
 *       Caso real: los 10% de Teka en Casa Los Algarrobos V3→V4.
 *
 *   C · De las de B, las que además dicen "no sigue al catálogo" pero con la
 *       LISTA idéntica a la del catálogo: lo único que MJ decidió es el
 *       descuento. → la lista vuelve a seguir al catálogo y el catálogo le
 *       respeta su porcentaje (como cualquier descuento suyo desde agosto).
 *
 * Antes de escribir guarda un respaldo con el estado previo de cada línea.
 * En la base viva exige además --si-la-viva.
 *
 *   npx tsx scripts/aplicar-186-reconectar.ts <ruta-env>                          (prueba)
 *   npx tsx scripts/aplicar-186-reconectar.ts <ruta-env> --partes=A --aplicar    (escribe A)
 *   npx tsx scripts/aplicar-186-reconectar.ts <ruta-env> --partes=A,B,C --aplicar --si-la-viva
 */
import { PrismaClient } from "@prisma/client";
import { readFileSync, writeFileSync, mkdirSync } from "fs";

const envPath = process.argv[2];
if (!envPath) throw new Error("Falta la ruta del .env como argumento.");
const APLICAR = process.argv.includes("--aplicar");
const SI_LA_VIVA = process.argv.includes("--si-la-viva");
const partesArg = process.argv.find((a) => a.startsWith("--partes="))?.slice(9) ?? "A,B,C";
const PARTES = new Set(partesArg.split(",").map((s) => s.trim().toUpperCase()));
const url = readFileSync(envPath, "utf8")
  .match(/DATABASE_URL\s*=\s*"?([^"\n]+)"?/)?.[1]
  ?.trim();
if (!url) throw new Error(`No hay DATABASE_URL en ${envPath}`);
const host = url.match(/@([^/:]+)/)?.[1] ?? "?";
const esLaViva = /shy-morning/.test(host);
if (APLICAR && esLaViva && !SI_LA_VIVA)
  throw new Error("Es la base VIVA: para escribir agregá --si-la-viva (con el OK de MJ).");
const prisma = new PrismaClient({ datasources: { db: { url } } });

const EPS_PESO = 1;
const EPS_DCTO = 0.005;
const clp = (n: number) => "$" + Math.round(n).toLocaleString("es-CL");
const pct = (d: number | null) => `${Math.round((d ?? 0) * 1000) / 10}%`;

interface Cambio {
  parte: "A" | "B" | "C";
  id: string;
  donde: string;
  nombre: string;
  data: { priceOverridden?: boolean; discountOverridden?: boolean };
}

async function main() {
  console.log(`Base: ${host}${esLaViva ? " (LA VIVA)" : ""} · partes ${[...PARTES].join(",")} · ${APLICAR ? "APLICANDO" : "prueba, sin escribir"}\n`);

  const cats = await prisma.artefactoCatalog.findMany({
    select: { id: true, listPrice: true, discountPercent: true },
  });
  const catById = new Map(cats.map((c) => [c.id, c]));
  const borradores = await prisma.budgetVersion.findMany({
    where: { type: "artefactos", status: "borrador" },
    select: {
      id: true,
      version: true,
      parentVersionId: true,
      project: { select: { numeroProyecto: true, name: true } },
      artefactoItems: true,
    },
  });

  const cambios: Cambio[] = [];
  const conMarcaDevuelta = new Set<string>();
  for (const v of borradores) {
    const donde = `#${v.project.numeroProyecto ?? "-"} ${v.project.name} ${v.version}`;

    // A · despegadas idénticas al catálogo (sin descuento propio de por medio).
    for (const l of v.artefactoItems) {
      if (!l.priceOverridden || l.discountOverridden || !l.catalogId) continue;
      const cat = catById.get(l.catalogId);
      if (!cat) continue;
      const catDcto = cat.discountPercent ?? 0;
      const identica =
        Math.abs(l.listPrice - cat.listPrice) <= EPS_PESO &&
        Math.abs((l.discountPercent ?? 0) - catDcto) <= EPS_DCTO &&
        Math.abs(l.clientPrice - cat.listPrice * (1 - catDcto)) <= EPS_PESO;
      if (identica)
        cambios.push({ parte: "A", id: l.id, donde, nombre: `${l.name} (${l.room})`, data: { priceOverridden: false } });
    }

    // B · marca de descuento perdida al duplicar la versión madre.
    if (!v.parentVersionId) continue;
    const madre = await prisma.artefactoItem.findMany({
      where: { budgetVersionId: v.parentVersionId, discountOverridden: true },
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
      cambios.push({ parte: "B", id: l.id, donde, nombre: `${l.name} (${l.room}) ${pct(l.discountPercent)}`, data: { discountOverridden: true } });
      conMarcaDevuelta.add(l.id);

      // C · además despegada, pero con la lista idéntica a la del catálogo.
      const cat = l.catalogId ? catById.get(l.catalogId) : undefined;
      if (l.priceOverridden && cat && Math.abs(l.listPrice - cat.listPrice) <= EPS_PESO)
        cambios.push({ parte: "C", id: l.id, donde, nombre: `${l.name} (${l.room}) lista ${clp(l.listPrice)}`, data: { priceOverridden: false } });
    }
  }

  const elegidos = cambios.filter((c) => PARTES.has(c.parte));
  for (const parte of ["A", "B", "C"] as const) {
    const cs = cambios.filter((c) => c.parte === parte);
    const titulo = {
      A: "A · despegadas con el precio idéntico al catálogo → vuelven a seguirlo",
      B: "B · descuento de MJ que perdió la marca al duplicar → se devuelve la marca",
      C: "C · de las anteriores, lista idéntica al catálogo → la lista vuelve a seguirlo",
    }[parte];
    console.log(`${titulo}: ${cs.length}${PARTES.has(parte) ? "" : "  (no elegida)"}`);
    for (const c of cs) console.log(`   ${c.donde.padEnd(32)} ${c.nombre}`);
    console.log("");
  }
  if (conMarcaDevuelta.size > 0 && PARTES.has("C") && !PARTES.has("B"))
    throw new Error("La parte C solo tiene sentido junto con la B.");

  if (!APLICAR) {
    console.log("Prueba: no se escribió nada.");
    return;
  }
  if (elegidos.length === 0) {
    console.log("Nada que aplicar.");
    return;
  }

  // Respaldo del estado previo de cada línea tocada, y totales de control.
  const ids = [...new Set(elegidos.map((c) => c.id))];
  const antes = await prisma.artefactoItem.findMany({ where: { id: { in: ids } } });
  mkdirSync("backups", { recursive: true });
  const respaldo = `backups/186-antes-de-reconectar-${host.split(".")[0]}-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-")}.json`;
  writeFileSync(respaldo, JSON.stringify(antes, null, 2));
  console.log(`Respaldo: ${respaldo}`);
  const total = async () =>
    (await prisma.artefactoItem.findMany({
      where: { budgetVersionId: { in: borradores.map((b) => b.id) } },
      select: { clientPrice: true, quantity: true },
    })).reduce((s, i) => s + i.clientPrice * i.quantity, 0);
  const totalAntes = await total();

  await prisma.$transaction(
    elegidos.map((c) => prisma.artefactoItem.update({ where: { id: c.id }, data: c.data }))
  );

  const totalDespues = await total();
  console.log(`Aplicados ${elegidos.length} cambios en ${ids.length} líneas.`);
  console.log(`Total al cliente de los borradores: antes ${clp(totalAntes)} · después ${clp(totalDespues)}`);
  if (Math.abs(totalAntes - totalDespues) > 0.5) throw new Error("¡El total se movió! Revisar con el respaldo.");
}

main()
  .catch((e) => {
    console.error("ERROR:", e.message ?? e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
