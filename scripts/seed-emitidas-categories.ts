// Seed de las categorías que se le pueden poner a una factura EMITIDA (lo que
// BLARQ le cobra al cliente): Obra, Muebles, Artefactos.
//
// OJO — cambió en 2026-08-14 (pendiente 160). Antes este script creaba las
// TRES como nodos propios con appliesTo="emitida", y eso dejaba dos "Muebles"
// y dos "Artefactos" en la base: uno para lo que BLARQ compra y otro para lo
// que cobra, con el mismo nombre y sin forma de distinguirlos en los
// desplegables. Se unieron: hoy "Muebles" y "Artefactos" son UN solo nodo
// marcado appliesTo="both", que sirve para los dos lados (la factura ya dice
// sola si es compra o cobro, con su campo `type`).
//
// Por eso acá:
//   · "Obra" se crea si falta — existe solo del lado del cobro, nunca estuvo
//     duplicada.
//   · "Muebles" y "Artefactos" NO se crean: se busca el nodo que ya existe y
//     se lo marca "both". Si se volvieran a crear, volverían los duplicados.
//
// Idempotente. Uso: npx tsx scripts/seed-emitidas-categories.ts

import "dotenv/config";
import { prisma } from "../src/lib/prisma";

async function main() {
  // "Obra": solo del lado del cobro.
  const obra = await prisma.costCategory.findFirst({
    where: { name: "Obra", parentId: null },
  });
  if (obra) {
    console.log("  · Obra: ya existe (skip)");
  } else {
    await prisma.costCategory.create({
      data: { name: "Obra", appliesTo: "emitida", sortOrder: 1, type: "directo" },
    });
    console.log("  ✓ Obra creada");
  }

  // "Muebles" y "Artefactos": un solo nodo compartido entre compra y cobro.
  for (const name of ["Muebles", "Artefactos"]) {
    const existentes = await prisma.costCategory.findMany({
      where: { name, parentId: null },
      select: { id: true, appliesTo: true },
    });
    if (existentes.length === 0) {
      console.log(`  ! ${name}: no existe ninguna. Este script NO la crea a propósito —`);
      console.log(`    es la misma categoría con la que se catalogan las COMPRAS y tiene`);
      console.log(`    subcategorías colgando. Revisar la base antes de inventarla.`);
      continue;
    }
    if (existentes.length > 1) {
      console.log(`  ! ${name}: hay ${existentes.length} categorías con ese nombre — volvieron los duplicados.`);
      console.log(`    Ver scripts/unir-160-categorias-muebles-artefactos.ts antes de seguir.`);
      continue;
    }
    const cat = existentes[0];
    if (cat.appliesTo === "both") {
      console.log(`  · ${name}: ya sirve para compras y cobros (skip)`);
      continue;
    }
    await prisma.costCategory.update({ where: { id: cat.id }, data: { appliesTo: "both" } });
    console.log(`  ✓ ${name}: marcada para compras y cobros (era "${cat.appliesTo}")`);
  }

  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
