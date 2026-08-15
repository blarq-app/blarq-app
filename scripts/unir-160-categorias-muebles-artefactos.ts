// Une los dos juegos de categorías "Muebles" y "Artefactos" en uno solo
// (pendiente 160). Aprobado por MJ el 2026-08-14.
//
// ── Por qué se puede unir ──────────────────────────────────────────────────
// La factura YA dice sola si es una compra o un cobro (campo `type`). La
// categoría estaba repitiendo ese dato con dos nodos de igual nombre, y en los
// desplegables quedaban indistinguibles. Cada consumidor mira un solo lado:
//   · el gasto por obra (metrics.ts) recorre SOLO las recibidas
//   · el concepto del cobro (conceptoCobro.ts → Cuadro Resumen, Me paso a
//     Sueldos) recorre SOLO las emitidas, y matchea por NOMBRE de categoría
// Como el nombre no cambia ("Muebles" sigue siendo "Muebles"), ningún cálculo
// se entera de la unión.
//
// ── Qué hace ───────────────────────────────────────────────────────────────
//  1. Marca los padres del juego de COMPRA como appliesTo="both".
//  2. Muda las facturas emitidas de los nodos de COBRO a esos padres.
//  3. Borra los dos nodos de COBRO que quedan vacíos.
// Las 6 subcategorías (Mueble, Cubiertas, Herrajes, Cocina, Baño, Iluminación)
// quedan como están, appliesTo="recibida": así al catalogar un COBRO se siguen
// ofreciendo solo Obra / Muebles / Artefactos, sin llenarse de opciones que no
// aplican. "Obra" no se toca — existe solo del lado del cobro y nunca estuvo
// duplicada.
//
// OJO ORDEN: esto va DESPUÉS de mover las facturas recibidas que estaban en el
// juego de cobro (scripts/mover-160-facturas-al-juego-de-compra.ts). El script
// se niega a correr si todavía queda alguna.
//
// Por default NO escribe: hay que pasar --apply. Deja respaldo para volver atrás.
//
// Uso:
//   npx tsx scripts/unir-160-categorias-muebles-artefactos.ts .env.prod
//   npx tsx scripts/unir-160-categorias-muebles-artefactos.ts .env.prod --apply
import { PrismaClient } from "@prisma/client";
import { readFileSync, writeFileSync } from "fs";

const envPath = process.argv[2];
const APPLY = process.argv.includes("--apply");
const url = readFileSync(envPath, "utf8").match(/DATABASE_URL\s*=\s*"?([^"\n]+)"?/)![1].trim();
const host = url.match(/@([^/.]+)/)?.[1] ?? "?";
const prisma = new PrismaClient({ datasources: { db: { url } } });
const clp = (n: number) => "$" + Math.round(n).toLocaleString("es-CL");

// ids de la base viva (ep-shy-morning).
const PARES = [
  { nombre: "Muebles", cobro: "cmp1ouk060001rt6ehqpdrkfx", compra: "cmnwgessj000brtde0h0lp8pc" },
  { nombre: "Artefactos", cobro: "cmp1ouk800002rt6e9icz7ibj", compra: "cmnwgessl000irtde71iksgdc" },
];

async function main() {
  console.log(`# BASE: ${host} — modo: ${APPLY ? "APPLY (escribe)" : "DRY RUN"}\n`);

  const cats = await prisma.costCategory.findMany({
    select: { id: true, name: true, parentId: true, appliesTo: true, sortOrder: true, type: true },
  });
  const byId = new Map(cats.map((c) => [c.id, c]));

  // ── Guardas ──────────────────────────────────────────────────────────────
  for (const par of PARES) {
    const cobro = byId.get(par.cobro);
    const compra = byId.get(par.compra);
    if (!cobro || !compra) {
      console.log(`*** No encuentro las dos "${par.nombre}" — parar. ***`);
      process.exit(1);
    }
    if (cobro.appliesTo !== "emitida") {
      console.log(`*** "${par.nombre}" de cobro no tiene appliesTo="emitida" — parar. ***`);
      process.exit(1);
    }
    // Nada más puede colgar del nodo que vamos a borrar.
    const hijas = cats.filter((c) => c.parentId === par.cobro).length;
    const reglas = await prisma.invoiceCategorizationRule.count({ where: { categoryId: par.cobro } });
    const tags = await prisma.pendingProjectTag.count({ where: { categoryId: par.cobro } });
    const recibidas = await prisma.invoice.count({ where: { categoryId: par.cobro, type: "recibida" } });
    console.log(
      `"${par.nombre}" de cobro: subcategorías=${hijas} · reglas=${reglas} · etiquetas=${tags} · facturas recibidas=${recibidas}`
    );
    if (hijas || reglas || tags) {
      console.log(`*** Cuelga algo del nodo de cobro "${par.nombre}" — parar y revisar. ***`);
      process.exit(1);
    }
    if (recibidas) {
      console.log(
        `*** Todavía hay ${recibidas} facturas de COMPRA en "${par.nombre}" de cobro. Correr primero mover-160-facturas-al-juego-de-compra.ts. ***`
      );
      process.exit(1);
    }
  }

  // ── Las emitidas a mudar ─────────────────────────────────────────────────
  const aMudar = await prisma.invoice.findMany({
    where: { categoryId: { in: PARES.map((p) => p.cobro) } },
    select: {
      id: true, folioNumber: true, type: true, totalAmount: true, categoryId: true,
      conceptoCobro: true, project: { select: { name: true, numeroProyecto: true } },
    },
    orderBy: { issueDate: "asc" },
  });
  console.log(`\nFacturas emitidas a mudar: ${aMudar.length}`);
  for (const i of aMudar) {
    const par = PARES.find((p) => p.cobro === i.categoryId)!;
    console.log(
      `  F-${(i.folioNumber ?? "?").padEnd(6)} ${clp(i.totalAmount).padStart(13)}  #${i.project?.numeroProyecto ?? "-"} ${(i.project?.name ?? "sin obra").padEnd(22)} "${par.nombre}" cobro → "${par.nombre}" compra`
    );
  }

  if (!APPLY) {
    console.log("\nDRY RUN — no se escribió nada. Correr con --apply para aplicar.");
    return;
  }

  // ── Respaldo ─────────────────────────────────────────────────────────────
  const respaldo = {
    categoriasBorradas: PARES.map((p) => {
      const c = byId.get(p.cobro)!;
      return { id: c.id, name: c.name, appliesTo: c.appliesTo, sortOrder: c.sortOrder, type: c.type };
    }),
    padresQueEranSoloCompra: PARES.map((p) => ({
      id: p.compra,
      appliesToAnterior: byId.get(p.compra)!.appliesTo,
    })),
    facturasMudadas: aMudar.map((i) => ({
      id: i.id, folio: i.folioNumber, categoryIdAnterior: i.categoryId,
      categoryIdNuevo: PARES.find((p) => p.cobro === i.categoryId)!.compra,
    })),
  };
  writeFileSync("backup-160-union-categorias.json", JSON.stringify(respaldo, null, 2));
  console.log("\nRespaldo escrito en backup-160-union-categorias.json");

  // ── 1. Los padres de compra pasan a servir para ambos lados ──────────────
  for (const par of PARES) {
    await prisma.costCategory.update({
      where: { id: par.compra },
      data: { appliesTo: "both" },
    });
    console.log(`  "${par.nombre}" de compra → appliesTo="both"`);
  }

  // ── 2. Mudar las emitidas ────────────────────────────────────────────────
  for (const par of PARES) {
    const r = await prisma.invoice.updateMany({
      where: { categoryId: par.cobro },
      data: { categoryId: par.compra },
    });
    console.log(`  "${par.nombre}": ${r.count} facturas mudadas`);
  }

  // ── 3. Borrar los nodos de cobro vacíos ──────────────────────────────────
  for (const par of PARES) {
    const quedan = await prisma.invoice.count({ where: { categoryId: par.cobro } });
    if (quedan > 0) {
      console.log(`*** "${par.nombre}" de cobro todavía tiene ${quedan} facturas — NO se borra. ***`);
      continue;
    }
    await prisma.costCategory.delete({ where: { id: par.cobro } });
    console.log(`  "${par.nombre}" de cobro borrada`);
  }

  // ── Verificación ─────────────────────────────────────────────────────────
  const raices = await prisma.costCategory.findMany({
    where: { parentId: null },
    select: { name: true, appliesTo: true },
    orderBy: { sortOrder: "asc" },
  });
  const dup = raices.filter((r, i) => raices.findIndex((o) => o.name === r.name) !== i);
  console.log(`\nCategorías raíz que quedan: ${raices.length}`);
  for (const r of raices) console.log(`   ${r.name.padEnd(22)} ${r.appliesTo}`);
  console.log(dup.length === 0 ? "\nOK — no quedan nombres repetidos." : `\n*** Quedan repetidos: ${dup.map((d) => d.name).join(", ")} ***`);
}

main()
  .catch((e) => {
    console.error("ERROR:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
