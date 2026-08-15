// SOLO LECTURA / DRY-RUN — NO escribe nada en la base.
//
// Pendiente 160. Simula mover las 12 facturas recibidas que hoy están
// archivadas en el juego de categorías de COBRO al juego de COMPRA, y muestra
// el ANTES/DESPUÉS del gastado y de los avisos de cada obra afectada.
//
// Lo que hay que confirmar acá:
//   · el GASTADO de cada obra NO se mueve ni un peso (solo cambia dónde se
//     clasifica la misma plata)
//   · los avisos que SÍ cambian son los esperados (es el detalle que hoy se
//     pierde: las facturas paradas en el padre no bajan a Cocina/Baño/etc.)
//
// El destino de cada factura se decide por proveedor, con la evidencia de
// diag-160-facturas-lado-equivocado.ts. Donde el proveedor no deja clara la
// subcategoría, va al PADRE del juego de compra y MJ afina después.
//
// Uso: npx tsx scripts/diag-160-dryrun-mover.ts .env.prod
import { PrismaClient } from "@prisma/client";
import { readFileSync } from "fs";
import {
  computeProjectMetrics,
  PROJECT_METRICS_INCLUDE,
  type ProjectWithMetrics,
} from "../src/lib/projects/metrics";

const url = readFileSync(process.argv[2], "utf8").match(/DATABASE_URL\s*=\s*"?([^"\n]+)"?/)![1].trim();
const host = url.match(/@([^/.]+)/)?.[1] ?? "?";
const prisma = new PrismaClient({ datasources: { db: { url } } });
const clp = (n: number) => "$" + Math.round(n).toLocaleString("es-CL");

// Categorías del juego de COMPRA (appliesTo="recibida") — ids de la base viva.
const COMPRA = {
  MUEBLES: "cmnwgessj000brtde0h0lp8pc", // Muebles (padre)
  ARTEFACTOS: "cmnwgessl000irtde71iksgdc", // Artefactos (padre)
  ART_COCINA: "cmnwgessm000krtdedzra1shj", // Artefactos > Cocina
};

// Destino propuesto por proveedor (RUT). Ver diag-160-facturas-lado-equivocado.
const DESTINO: Record<string, { catId: string; por: string }> = {
  "77690596-8": {
    catId: COMPRA.MUEBLES,
    por: "ICPROYECTOS: sus 4 facturas son TODAS las que tiene, no hay ninguna bien catalogada de dónde copiar → al padre",
  },
  "76911036-4": {
    catId: COMPRA.MUEBLES,
    por: "Geoffroy: sus otras facturas están 3 en Herrajes (chicas: $49k–$721k) y 1 en Subcontrato ($2,9M). Estas 4 son de $1,8M–$3,6M, no calzan con herrajes → al padre",
  },
  "76159290-4": {
    catId: COMPRA.ART_COCINA,
    por: "Proyectos Ingeniería: 21 de sus 24 facturas están en Artefactos > Cocina",
  },
  "96999930-7": {
    catId: COMPRA.ART_COCINA,
    por: "Kitchen Center: 4 de sus 5 facturas están en Artefactos > Cocina",
  },
  "18478845-4": {
    catId: COMPRA.ARTEFACTOS,
    por: "Asael de la O: es su única factura, no hay con qué comparar → al padre",
  },
};

async function main() {
  console.log(`# BASE: ${host} — DRY RUN, no se escribe nada\n`);

  const cats = await prisma.costCategory.findMany({
    select: { id: true, name: true, parentId: true, appliesTo: true },
  });
  const byId = new Map(cats.map((c) => [c.id, c]));
  const ruta = (id: string) =>
    byId.get(id)!.parentId
      ? `${byId.get(byId.get(id)!.parentId!)!.name} > ${byId.get(id)!.name}`
      : byId.get(id)!.name;

  const raizDe = (catId: string) => {
    const c = byId.get(catId)!;
    return c.parentId ? byId.get(c.parentId)! : c;
  };

  // Las 12: recibidas cuya categoría vive en el juego "emitida".
  const malUbicadas = await prisma.invoice.findMany({
    where: { type: "recibida", categoryId: { not: null } },
    select: { id: true, rutIssuer: true, categoryId: true, projectId: true },
  });
  const aMover = malUbicadas.filter((i) => raizDe(i.categoryId!).appliesTo === "emitida");

  console.log(`Facturas a mover: ${aMover.length}`);
  const sinDestino = aMover.filter((i) => !DESTINO[i.rutIssuer ?? ""]);
  if (sinDestino.length > 0) {
    console.log(`  ATENCIÓN: ${sinDestino.length} sin destino definido:`, sinDestino);
  }
  const nuevoCatDe = new Map(
    aMover
      .filter((i) => DESTINO[i.rutIssuer ?? ""])
      .map((i) => [i.id, DESTINO[i.rutIssuer!].catId])
  );

  const obrasAfectadas = new Set(aMover.map((i) => i.projectId).filter(Boolean) as string[]);

  const projects = await prisma.project.findMany({
    where: { id: { in: [...obrasAfectadas] } },
    include: PROJECT_METRICS_INCLUDE,
    orderBy: { name: "asc" },
  });

  let algunTotalSeMovio = false;

  for (const p of projects) {
    const antes = computeProjectMetrics(p as unknown as ProjectWithMetrics);

    // Copia con las categorías ya movidas — solo en memoria.
    const pDespues = {
      ...p,
      invoices: p.invoices.map((inv) => {
        const nuevo = nuevoCatDe.get(inv.id);
        if (!nuevo) return inv;
        const c = byId.get(nuevo)!;
        return {
          ...inv,
          categoryId: nuevo,
          category: {
            ...(inv.category as object),
            id: c.id,
            name: c.name,
            parentId: c.parentId,
            parent: c.parentId
              ? { id: c.parentId, name: byId.get(c.parentId)!.name }
              : null,
          },
        };
      }),
    };
    const despues = computeProjectMetrics(pDespues as unknown as ProjectWithMetrics);

    console.log(`\n${"=".repeat(70)}`);
    console.log(`OBRA: ${p.name}`);
    const movidas = p.invoices.filter((i) => nuevoCatDe.has(i.id));
    for (const m of movidas) {
      console.log(
        `   mueve F-${m.folioNumber}  ${clp(m.netAmount)}  ${ruta(m.categoryId!)} [cobro]  →  ${ruta(nuevoCatDe.get(m.id)!)} [compra]`
      );
    }

    const igualTotales =
      Math.round(antes.totalGastado) === Math.round(despues.totalGastado) &&
      Math.round(antes.totalCobrado) === Math.round(despues.totalCobrado) &&
      Math.round(antes.utilidadReal) === Math.round(despues.utilidadReal);
    if (!igualTotales) algunTotalSeMovio = true;
    console.log(
      `   gastado  ${clp(antes.totalGastado)}  →  ${clp(despues.totalGastado)}   ${igualTotales ? "IGUAL" : "*** SE MOVIÓ ***"}`
    );
    console.log(
      `   cobrado  ${clp(antes.totalCobrado)}  →  ${clp(despues.totalCobrado)}`
    );
    console.log(
      `   utilidad ${clp(antes.utilidadReal)}  →  ${clp(despues.utilidadReal)}`
    );

    const fmt = (a: { severity: string; message: string }[]) =>
      a.map((x) => `[${x.severity}] ${x.message}`);
    const aA = fmt(antes.alerts);
    const aD = fmt(despues.alerts);
    const soloAntes = aA.filter((x) => !aD.includes(x));
    const soloDespues = aD.filter((x) => !aA.includes(x));
    if (soloAntes.length === 0 && soloDespues.length === 0) {
      console.log("   avisos: sin cambios");
    } else {
      for (const x of soloAntes) console.log(`   aviso ANTES:   ${x}`);
      for (const x of soloDespues) console.log(`   aviso DESPUÉS: ${x}`);
    }
  }

  console.log(`\n${"=".repeat(70)}`);
  console.log(
    algunTotalSeMovio
      ? "*** OJO: algún total se movió — revisar antes de escribir ***"
      : "OK — ningún total se movió. Solo cambia dónde se clasifica la misma plata."
  );
}

main()
  .catch((e) => {
    console.error("ERROR:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
