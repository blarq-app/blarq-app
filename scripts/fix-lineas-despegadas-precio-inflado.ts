/**
 * Corrige las líneas de cotización que el botón roto "Comparar con la tienda
 * web" dejó con el precio INFLADO (ver H0 del informe de auditoría
 * docs/auditoria-artefactos-precios-2026-07.md).
 *
 * El daño: al aplicar, el botón guardaba la lista nueva de la tienda y
 * recalculaba lo que paga el cliente con el descuento VIEJO de la línea. Con 0%
 * guardado, el cliente terminaba pagando la LISTA COMPLETA — más caro que antes
 * de apretar el botón — y la línea quedaba despegada, así que el catálogo ya no
 * la corregía.
 *
 * Qué deja: lista + descuento + precio de la tienda de HOY. O sea, exactamente
 * el estado en que habría quedado la línea si el botón hubiera funcionado bien.
 * `priceOverridden` se deja en true a propósito: el precio pasa a venir de la
 * tienda y no del catálogo (que además, en varios de estos productos, todavía
 * tiene datos peores). Es el mismo criterio del botón ya arreglado.
 *
 * Detección: NO se corrigen ids escritos a mano — se busca la firma del daño
 * (despegada + 0% guardado + precio al cliente igual a la lista de la web +
 * la web sí tiene descuento), así que el script es re-corrible y no toca
 * ninguna línea que MJ haya editado de verdad.
 *
 *   npx tsx scripts/fix-lineas-despegadas-precio-inflado.ts                  # dry-run
 *   npx tsx scripts/fix-lineas-despegadas-precio-inflado.ts --aplicar --si-la-viva
 */
import { readFileSync, writeFileSync } from "fs";
import { PrismaClient } from "@prisma/client";
import { leerPrecioWeb } from "../src/lib/catalog/leerPrecioWeb";

const APLICAR = process.argv.includes("--aplicar");
const OK_VIVA = process.argv.includes("--si-la-viva");

const envRaw = readFileSync("/Users/mjblanco/Desktop/blarq-app/.env.prod", "utf8");
const url = envRaw.match(/DATABASE_URL\s*=\s*"?([^"\n]+)"?/)![1];
const HOST = url.match(/@([^/]+)/)![1];
const prisma = new PrismaClient({ datasources: { db: { url } } });

const CLP = (n: number) => "$" + Math.round(n).toLocaleString("es-CL");
const BACKUP =
  "/Users/mjblanco/Desktop/blarq-app/backups/backup-lineas-precio-inflado-2026-07-31.json";

async function main() {
  console.log("HOST:", HOST);
  console.log("MODO:", APLICAR ? "APLICAR (escribe)" : "DRY-RUN (no escribe nada)");
  if (APLICAR && /shy-morning/.test(HOST) && !OK_VIVA) {
    throw new Error("Es la base VIVA y no se pasó --si-la-viva. Abortado.");
  }
  const p64 = await prisma.project.findFirst({
    where: { numeroProyecto: 64 },
    select: { name: true },
  });
  console.log("Proyecto #64:", p64?.name ?? "(no está)", "\n");

  const despegadas = await prisma.artefactoItem.findMany({
    where: {
      priceOverridden: true,
      referenceLink: { not: null },
      budgetVersion: { type: "artefactos", status: "borrador" },
    },
    select: {
      id: true, name: true, room: true, quantity: true, budgetVersionId: true,
      listPrice: true, discountPercent: true, clientPrice: true, referenceLink: true,
      budgetVersion: {
        select: { version: true, project: { select: { name: true } } },
      },
    },
  });

  const aCorregir: Array<{
    id: string; etiqueta: string; quantity: number; budgetVersionId: string;
    antes: { listPrice: number; discountPercent: number | null; clientPrice: number };
    despues: { listPrice: number; discountPercent: number; clientPrice: number };
    ahorro: number;
  }> = [];

  for (const it of despegadas) {
    const web = await leerPrecioWeb(it.referenceLink!);
    if (!web || !web.discountKnown || web.discount <= 0.005) continue;
    const sinDcto = (it.discountPercent ?? 0) < 0.005;
    const pagaLaLista = Math.abs(it.clientPrice - web.listPrice) <= 2;
    if (!sinDcto || !pagaLaLista) continue;
    aCorregir.push({
      id: it.id,
      etiqueta: `${it.budgetVersion?.project?.name} ${it.budgetVersion?.version} — ${it.name} (${it.room})`,
      quantity: it.quantity,
      budgetVersionId: it.budgetVersionId,
      antes: {
        listPrice: it.listPrice,
        discountPercent: it.discountPercent,
        clientPrice: it.clientPrice,
      },
      despues: {
        listPrice: web.listPrice,
        discountPercent: web.discount,
        clientPrice: web.salePrice,
      },
      ahorro: (it.clientPrice - web.salePrice) * it.quantity,
    });
  }

  if (aCorregir.length === 0) {
    console.log("No hay líneas con la firma del daño. Nada que hacer.");
    return;
  }

  console.log("═══ LÍNEAS A CORREGIR ═══");
  for (const c of aCorregir) {
    console.log(`\n  ${c.etiqueta} x${c.quantity}`);
    console.log(
      `      antes:   lista ${CLP(c.antes.listPrice)} · ${Math.round((c.antes.discountPercent ?? 0) * 100)}% · cliente ${CLP(c.antes.clientPrice)}`
    );
    console.log(
      `      después: lista ${CLP(c.despues.listPrice)} · ${(c.despues.discountPercent * 100).toFixed(1)}% · cliente ${CLP(c.despues.clientPrice)}`
    );
    console.log(`      baja ${CLP(c.ahorro)}`);
  }

  // Efecto en el total de cada cotización tocada (es plata del presupuesto).
  const versiones = [...new Set(aCorregir.map((c) => c.budgetVersionId))];
  console.log("\n═══ TOTAL DE ARTEFACTOS DE CADA COTIZACIÓN ═══");
  const totalesAntes = new Map<string, number>();
  for (const bvId of versiones) {
    const items = await prisma.artefactoItem.findMany({
      where: { budgetVersionId: bvId },
      select: { clientPrice: true, quantity: true },
    });
    const total = items.reduce((s, i) => s + i.clientPrice * i.quantity, 0);
    totalesAntes.set(bvId, total);
    const baja = aCorregir
      .filter((c) => c.budgetVersionId === bvId)
      .reduce((s, c) => s + c.ahorro, 0);
    const etiqueta = aCorregir.find((c) => c.budgetVersionId === bvId)!.etiqueta.split(" — ")[0];
    console.log(
      `  ${etiqueta}: ${CLP(total)} → ${CLP(total - baja)}  (baja ${CLP(baja)})`
    );
  }

  if (!APLICAR) {
    console.log("\nDRY-RUN: no se escribió nada.");
    return;
  }

  // Respaldo antes de tocar.
  writeFileSync(
    BACKUP,
    JSON.stringify(
      {
        generado: "2026-07-31",
        motivo:
          "Estado previo de las líneas que el botón roto dejó con el precio inflado (H0 de la auditoría de precios de artefactos).",
        host: HOST,
        lineas: aCorregir,
      },
      null,
      2
    )
  );
  console.log(`\nRespaldo en ${BACKUP}`);

  for (const c of aCorregir) {
    await prisma.artefactoItem.update({
      where: { id: c.id },
      data: {
        listPrice: c.despues.listPrice,
        discountPercent: c.despues.discountPercent,
        clientPrice: c.despues.clientPrice,
        // Queda despegada a propósito: el precio viene de la tienda, no del
        // catálogo (mismo criterio que el botón arreglado).
        priceOverridden: true,
      },
    });
    console.log(`  corregida: ${c.etiqueta}`);
  }

  console.log("\n═══ VERIFICACIÓN POST ═══");
  for (const bvId of versiones) {
    const items = await prisma.artefactoItem.findMany({
      where: { budgetVersionId: bvId },
      select: { clientPrice: true, quantity: true },
    });
    const total = items.reduce((s, i) => s + i.clientPrice * i.quantity, 0);
    const esperado =
      totalesAntes.get(bvId)! -
      aCorregir.filter((c) => c.budgetVersionId === bvId).reduce((s, c) => s + c.ahorro, 0);
    const ok = Math.abs(total - esperado) <= 2;
    console.log(
      `  ${ok ? "OK  " : "OJO "} total ahora ${CLP(total)} (esperado ${CLP(esperado)})`
    );
  }
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
