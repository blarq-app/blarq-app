/**
 * Recupera el desglose fino de la obra V7 de Portofino.
 *
 * La carga original metió en MATERIAL todo lo que no era mano de obra, así que
 * la tabla "Presupuesto vs Real — Por Categoría" quedó con Herramientas,
 * Subcontrato, Margen y Pérdidas en cero y Materiales inflado en ~$11,8M. La V6
 * sí tiene el desglose (y los mismos costos), así que se recupera de ahí.
 *
 * Regla, partida por partida:
 *   - MANO DE OBRA: se queda la de la V7 (la de la hoja RESUMENES, la que se le
 *     paga al maestro). Es el motivo por el que se cargó la V7 y no se toca.
 *   - Herramientas, subcontrato, margen y pérdidas: tal cual de la V6.
 *   - MATERIAL: absorbe el resto, para que el total de la partida NO se mueva.
 *   - Si ese resto diera negativo (el precio de la partida bajó respecto de la
 *     V6 — solo pasa con el calefont, que va con el precio del PDF), se reparte
 *     TODO lo que no es mano de obra en proporción a como estaba en la V6.
 *
 * Quedan fuera: las 13 partidas "No cobrar" (no entran en el presupuesto por
 * categoría), la partida de descuento (no es un costo, se queda en 0/0) y las
 * dos partidas nuevas que no existen en la V6 (TOPE DE PUERTA e INSTALACION
 * CUBREJUNTA), que se quedan enteras como material.
 *
 * NO mueve plata: ni `unitPrice`, ni `total`, ni el costo directo, ni el total
 * al cliente. Solo reparte el mismo monto entre las seis categorías.
 *
 * NO usa dotenv — datasource explícito desde `.env.prod` (§4.9).
 * Dry-run por defecto. Escribe solo con --apply.
 */
import { readFileSync } from "fs";
import { PrismaClient } from "@prisma/client";

const APPLY = process.argv.includes("--apply");
const DESCUENTO = "DESCUENTO SEGÚN ACUERDO";

const url = readFileSync("/Users/mjblanco/Desktop/blarq-app/.env.prod", "utf8")
  .split("\n")
  .map((l) => l.trim())
  .find((l) => l.startsWith("DATABASE_URL="))!
  .slice("DATABASE_URL=".length)
  .replace(/^["']|["']$/g, "");
const host = url.match(/@([^/]+)\//)?.[1] ?? "???";
const prisma = new PrismaClient({ datasources: { db: { url } } });

const clp = (n: number) => `$${Math.round(n).toLocaleString("es-CL")}`;
const TIPOS = ["costMaterial", "costLabor", "costTools", "costSubcontract", "costLoss", "costMargin"] as const;
const ROTULO: Record<string, string> = {
  costMaterial: "Materiales",
  costLabor: "Mano de obra",
  costTools: "Herramientas",
  costSubcontract: "Subcontrato",
  costLoss: "Pérdidas",
  costMargin: "Margen",
};

async function main() {
  console.log("HOST:", host, "| MODO:", APPLY ? "APLICAR" : "DRY-RUN");
  if (!host.includes("ep-shy-morning")) throw new Error("No es la base viva — PARAR");

  const sel = {
    id: true, itemNumber: true, name: true, unit: true, quantity: true,
    unitPrice: true, total: true, noCobrado: true,
    costMaterial: true, costLabor: true, costTools: true,
    costSubcontract: true, costLoss: true, costMargin: true,
  };
  const v6 = await prisma.budgetVersion.findFirst({
    where: { project: { numeroProyecto: 60 }, type: "obra", version: "V6" },
    include: { obraItems: { select: sel } },
  });
  const v7 = await prisma.budgetVersion.findFirst({
    where: { project: { numeroProyecto: 60 }, type: "obra", version: "V7" },
    include: { obraItems: { select: sel, orderBy: { sortOrder: "asc" } } },
  });
  if (!v6 || !v7) throw new Error("faltan versiones");

  const key = (n: string, u: string) => `${n.trim().toUpperCase()}|${u.trim().toUpperCase()}`;
  const porClave = new Map<string, (typeof v6.obraItems)[number][]>();
  for (const i of v6.obraItems) {
    if (i.quantity === 0 && i.total === 0) continue;
    const k = key(i.name, i.unit);
    if (!porClave.has(k)) porClave.set(k, []);
    porClave.get(k)!.push(i);
  }

  const cambios: {
    id: string;
    etiqueta: string;
    antes: Record<string, number>;
    despues: Record<string, number>;
    nota: string;
  }[] = [];

  for (const i of v7.obraItems) {
    if (i.noCobrado || i.name === DESCUENTO) continue;
    const labor = i.costLabor ?? 0;
    const m = porClave.get(key(i.name, i.unit))?.shift();

    const antes = Object.fromEntries(TIPOS.map((t) => [t, i[t] ?? 0]));
    let despues: Record<string, number>;
    let nota = "";

    if (!m) {
      // Partida nueva: no hay de dónde sacar el desglose. Queda como está.
      continue;
    }

    const otros = {
      costTools: m.costTools ?? 0,
      costSubcontract: m.costSubcontract ?? 0,
      costLoss: m.costLoss ?? 0,
      costMargin: m.costMargin ?? 0,
    };
    const sumaOtros = Object.values(otros).reduce((a, b) => a + b, 0);
    const restoNoMO = i.unitPrice - labor;
    let material = restoNoMO - sumaOtros;
    let escala = 1;
    if (material < -1) {
      const baseV6 = (m.costMaterial ?? 0) + sumaOtros;
      escala = baseV6 > 0 ? restoNoMO / baseV6 : 0;
      material = (m.costMaterial ?? 0) * escala;
      nota = `repartido en proporción (escala ${escala.toFixed(4)})`;
    }
    despues = {
      costMaterial: material,
      costLabor: labor,
      costTools: otros.costTools * escala,
      costSubcontract: otros.costSubcontract * escala,
      costLoss: otros.costLoss * escala,
      costMargin: otros.costMargin * escala,
    };

    // Control por partida: el desglose tiene que sumar el precio unitario.
    const suma = Object.values(despues).reduce((a, b) => a + b, 0);
    if (Math.abs(suma - i.unitPrice) > 0.5) {
      throw new Error(
        `${i.itemNumber} ${i.name}: el desglose suma ${clp(suma)} y el P.U es ${clp(i.unitPrice)} — PARAR`
      );
    }
    if (Object.values(despues).some((v) => v < -0.5)) {
      throw new Error(`${i.itemNumber} ${i.name}: quedó una categoría negativa — PARAR`);
    }
    if (TIPOS.every((t) => Math.abs(antes[t] - despues[t]) < 0.5)) continue;

    cambios.push({ id: i.id, etiqueta: `${i.itemNumber} ${i.name}`, antes, despues, nota });
  }

  console.log(`\n${cambios.length} partidas cambian de desglose (de ${v7.obraItems.length}).`);
  for (const c of cambios.slice(0, 6)) {
    console.log(`\n  ${c.etiqueta} ${c.nota}`);
    for (const t of TIPOS) {
      if (Math.abs(c.antes[t] - c.despues[t]) < 0.5) continue;
      console.log(`     ${ROTULO[t].padEnd(13)} ${clp(c.antes[t]).padStart(12)} → ${clp(c.despues[t]).padStart(12)}`);
    }
  }
  if (cambios.length > 6) console.log(`\n  ... y ${cambios.length - 6} más.`);

  // Totales antes/después, espejo de metrics.ts.
  const totalPorTipo = (usar: "antes" | "despues") => {
    const acc: Record<string, number> = Object.fromEntries(TIPOS.map((t) => [t, 0]));
    const mapa = new Map(cambios.map((c) => [c.id, c]));
    for (const i of v7.obraItems) {
      if (i.noCobrado) continue;
      const c = mapa.get(i.id);
      for (const t of TIPOS) acc[t] += (c ? c[usar][t] : i[t] ?? 0) * i.quantity;
    }
    return acc;
  };
  const a = totalPorTipo("antes");
  const d = totalPorTipo("despues");
  console.log("\n=== PRESUPUESTO POR CATEGORÍA (neto) ===");
  console.log("categoría      |         antes |       después");
  for (const t of TIPOS) {
    console.log(`${ROTULO[t].padEnd(14)} | ${clp(a[t]).padStart(13)} | ${clp(d[t]).padStart(13)}`);
  }
  const cdCobrable = v7.obraItems
    .filter((i) => !i.noCobrado)
    .reduce((s, i) => s + i.total, 0);
  console.log(`\nCosto directo (no se mueve): ${clp(cdCobrable)}`);
  console.log(`Suma antes:   ${clp(Object.values(a).reduce((x, y) => x + y, 0))}`);
  console.log(`Suma después: ${clp(Object.values(d).reduce((x, y) => x + y, 0))}`);
  console.log(
    `(las dos suman el costo directo MÁS los ${clp(425091)} del descuento, que va sin desglose a propósito)`
  );

  if (!APPLY) {
    console.log("\nDRY-RUN: no se escribió nada. Correr con --apply.");
    return;
  }

  const cdPrevio = cdCobrable;
  await prisma.$transaction(
    async (tx) => {
      for (const c of cambios) {
        await tx.obraItem.update({
          where: { id: c.id },
          data: {
            costMaterial: c.despues.costMaterial,
            costLabor: c.despues.costLabor,
            costTools: c.despues.costTools,
            costSubcontract: c.despues.costSubcontract,
            costLoss: c.despues.costLoss,
            costMargin: c.despues.costMargin,
          },
        });
      }
    },
    { timeout: 120_000, maxWait: 20_000 }
  );

  const control = await prisma.obraItem.findMany({
    where: { budgetVersionId: v7.id, noCobrado: false },
    select: { total: true },
  });
  const cdDespues = control.reduce((s, i) => s + i.total, 0);
  console.log(`\n${cambios.length} partidas actualizadas.`);
  console.log(`Costo directo antes ${clp(cdPrevio)} · después ${clp(cdDespues)}`);
  // Con tolerancia de medio peso, no con `===`: sumar 65 decimales en distinto
  // orden da bits distintos aunque la plata sea exactamente la misma.
  console.log(
    Math.abs(cdPrevio - cdDespues) < 0.5
      ? "El costo directo NO se movió — OK"
      : `SE MOVIÓ ${clp(cdDespues - cdPrevio)} — REVISAR`
  );
}

main()
  .catch((e) => {
    console.error("ERROR:", e.message ?? e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
