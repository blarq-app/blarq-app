/**
 * Revierte los links que se cargaron mal el 2026-08-03.
 *
 * MJ revisó y encontró que el mezclador que le puse era de 1 vía cuando el suyo
 * es de 2. Al mirar el resto, tres de los seis no calzaban con la DESCRIPCIÓN
 * guardada (yo había comparado solo el nombre corto):
 *
 *   MEZCLADOR STELLAR BRUSHED   detalle: "Mezclador TINA Stellar empotrado
 *                               2 VÍAS" → le puse uno de DUCHA de 1 VÍA.
 *                               El correcto no existe hoy en MK.
 *   PLATO DUCHA LUXOR 25CM      detalle: "...S/Brazo CROMADA" → le puse el
 *                               BRUSHED NICKEL. El cromo existe (código 287,
 *                               no 288) pero MK lo tiene de baja.
 *   GRIFERIA COCINA BRIZO       el catálogo dice EXTRAIBLE y MK solo vende el
 *                               "Flexible" suelto; el extraíble viene en pack.
 *
 * Un link equivocado es peor que ninguno: hace que el producto tome el precio
 * de otra cosa. Se restauran los precios que tenían antes.
 */
import { readFileSync } from "fs";
import { PrismaClient } from "@prisma/client";

const APLICAR = process.argv.includes("--aplicar");
const OK_VIVA = process.argv.includes("--si-la-viva");
const url = readFileSync("/Users/mjblanco/Desktop/blarq-app/.env.prod", "utf8")
  .match(/DATABASE_URL\s*=\s*"?([^"\n]+)"?/)![1];
const HOST = url.match(/@([^/]+)/)![1];
console.log("HOST:", HOST, "· MODO:", APLICAR ? "APLICAR" : "DRY-RUN");
const prisma = new PrismaClient({ datasources: { db: { url } } });
const CLP = (n: number) => "$" + Math.round(n).toLocaleString("es-CL");

const REVERTIR = [
  {
    nombre: "MEZCLADOR STELLAR BRUSHED",
    listPrice: 92790, discountPercent: 0.15,
    // El original se perdió al sobrescribirlo y no quedó en ninguna cotización.
    link: null as string | null,
    motivo: "le puse un mezclador de DUCHA 1 vía; el suyo es de TINA 2 vías, que hoy no está en MK",
  },
  {
    nombre: "PLATO DUCHA LUXOR REDONDO 25CM",
    listPrice: 80490, discountPercent: 0.19,
    // Recuperado de una línea de Paseo del Sena V1: es el CROMO (287).
    link: "https://www.mk.cl/gkl030287-plato-ducha-luxor-redondo-25-cm-1-jet-sbrazo-cromo-griferias-de-ducha-y-tina/p",
    motivo: "le puse el BRUSHED NICKEL (288); el suyo es el CROMO (287), recuperado de la cotización",
  },
  {
    nombre: "GRIFERIA COCINA BRIZO EXTRAIBLE 1 JET CROMO",
    listPrice: 157390, discountPercent: 0.4092,
    link: null as string | null,
    motivo: "MK solo vende suelto el 'Flexible'; el extraíble viene en pack. El original se perdió",
  },
];

async function main() {
  if (APLICAR && /shy-morning/.test(HOST) && !OK_VIVA) throw new Error("Falta --si-la-viva. Abortado.");
  const p64 = await prisma.project.findFirst({ where: { numeroProyecto: 64 }, select: { name: true } });
  console.log("Proyecto #64:", p64?.name, "\n");

  for (const r of REVERTIR) {
    const cat = await prisma.artefactoCatalog.findFirst({
      where: { name: r.nombre },
      select: { id: true, listPrice: true, discountPercent: true, referenceLink: true, detail: true },
    });
    if (!cat) { console.log(`OJO  ${r.nombre} no está\n`); continue; }
    console.log(`── ${r.nombre}`);
    console.log(`   detalle guardado: ${cat.detail ?? "(vacío)"}`);
    console.log(`   ${r.motivo}`);
    console.log(`   ahora:  ${CLP(cat.listPrice)} · ${Math.round((cat.discountPercent ?? 0) * 100)}% · ${cat.referenceLink?.split("/").at(-2)?.slice(0, 42) ?? "sin link"}`);
    console.log(`   vuelve: ${CLP(r.listPrice)} · ${Math.round(r.discountPercent * 100)}% · ${r.link ? r.link.split("/").at(-2)?.slice(0, 42) : "SIN LINK"}\n`);
    if (!APLICAR) continue;
    await prisma.artefactoCatalog.update({
      where: { id: cat.id },
      data: {
        referenceLink: r.link,
        listPrice: r.listPrice,
        discountPercent: r.discountPercent,
        // Se limpia la referencia de internet: la que había era del producto
        // equivocado.
        webListPrice: null, webSalePrice: null, webCheckedAt: null,
        webUnreadableSince: r.link ? new Date() : null,
      },
    });
    console.log(`   revertido.\n`);
  }
  if (!APLICAR) console.log("DRY-RUN: no se escribió nada.");
}

main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
