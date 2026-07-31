/**
 * ¿Cuánto desglose se perdió al cargar la V7?
 *
 * La V6 traía el desglose fino de cada partida (material / mano de obra /
 * herramientas / subcontrato / margen / pérdidas), que es lo que alimenta la
 * tabla "Presupuesto vs Real — Por Categoría" de metrics.ts. La V7 se cargó con
 * solo dos categorías (mano de obra + todo el resto como material), así que esa
 * tabla quedó comparando contra categorías vacías.
 *
 * Este script pone los dos desgloses lado a lado y calcula cómo quedaría si se
 * recupera el de la V6 conservando la mano de obra correcta de la V7.
 *
 * NO usa dotenv — datasource explícito desde `.env.prod` (§4.9). Solo LEE.
 */
import { readFileSync } from "fs";
import { PrismaClient } from "@prisma/client";

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

type Item = {
  name: string;
  unit: string;
  quantity: number;
  unitPrice: number;
  total: number;
  noCobrado: boolean;
  costMaterial: number | null;
  costLabor: number | null;
  costTools: number | null;
  costSubcontract: number | null;
  costLoss: number | null;
  costMargin: number | null;
};

// Espejo de metrics.ts: suma cost{X} × cantidad sobre las partidas COBRABLES.
function desglose(items: Item[]) {
  const acc: Record<string, number> = {};
  for (const t of TIPOS) acc[t] = 0;
  for (const i of items) {
    if (i.noCobrado) continue;
    for (const t of TIPOS) acc[t] += (i[t] ?? 0) * i.quantity;
  }
  return acc;
}

async function main() {
  console.log("HOST:", host);
  const sel = {
    name: true, unit: true, quantity: true, unitPrice: true, total: true, noCobrado: true,
    costMaterial: true, costLabor: true, costTools: true,
    costSubcontract: true, costLoss: true, costMargin: true,
  };
  const v6 = await prisma.budgetVersion.findFirst({
    where: { project: { numeroProyecto: 60 }, type: "obra", version: "V6" },
    include: { obraItems: { select: sel } },
  });
  const v7 = await prisma.budgetVersion.findFirst({
    where: { project: { numeroProyecto: 60 }, type: "obra", version: "V7" },
    include: { obraItems: { select: sel } },
  });
  if (!v6 || !v7) throw new Error("faltan versiones");

  const d6 = desglose(v6.obraItems as Item[]);
  const d7 = desglose(v7.obraItems as Item[]);

  console.log("\n=== DESGLOSE PRESUPUESTADO (neto, solo partidas cobrables) ===");
  console.log("categoría | V6 (como estaba) | V7 (como quedó hoy)");
  for (const t of TIPOS) {
    console.log(`${ROTULO[t].padEnd(14)} | ${clp(d6[t]).padStart(15)} | ${clp(d7[t]).padStart(15)}`);
  }
  console.log(
    `${"SUBTOTAL".padEnd(14)} | ${clp(Object.values(d6).reduce((a, b) => a + b, 0)).padStart(15)} | ${clp(
      Object.values(d7).reduce((a, b) => a + b, 0)
    ).padStart(15)}`
  );

  // ── Cómo quedaría al recuperar el desglose de la V6 ──────────────────────
  //
  // Regla: la MANO DE OBRA queda la de la V7 (la de RESUMENES, la correcta).
  // Herramientas, subcontrato, margen y pérdidas se recuperan tal cual de la
  // V6, y MATERIAL absorbe el resto para que el total de la partida no se
  // mueva. Si ese resto diera negativo (pasa cuando el precio de la partida
  // bajó, como el calefont), se reparte todo lo que no es mano de obra en
  // PROPORCIÓN a como estaba en la V6.
  const key = (n: string, u: string) => `${n.trim().toUpperCase()}|${u.trim().toUpperCase()}`;
  const porClave = new Map<string, Item[]>();
  for (const i of v6.obraItems as Item[]) {
    if (i.quantity === 0 && i.total === 0) continue;
    const k = key(i.name, i.unit);
    if (!porClave.has(k)) porClave.set(k, []);
    porClave.get(k)!.push(i);
  }

  const propuesto: Record<string, number> = {};
  for (const t of TIPOS) propuesto[t] = 0;
  const sinMatch: string[] = [];
  const proporcional: string[] = [];

  for (const i of v7.obraItems as Item[]) {
    if (i.noCobrado) continue;
    // La partida de descuento se queda con material y mano de obra en 0 a
    // propósito: no es un costo, no va en el presupuesto por categoría. Por eso
    // el desglose suma el costo directo MÁS el descuento, y la app la muestra
    // aparte como "(sin desglose)".
    if (i.name === "DESCUENTO SEGÚN ACUERDO") continue;
    const cola = porClave.get(key(i.name, i.unit));
    const m = cola?.shift();
    const labor = i.costLabor ?? 0;
    if (!m) {
      sinMatch.push(i.name);
      propuesto.costLabor += labor * i.quantity;
      propuesto.costMaterial += (i.unitPrice - labor) * i.quantity;
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
      // El precio bajó: repartir proporcional entre TODO lo que no es MO.
      const baseV6 = (m.costMaterial ?? 0) + sumaOtros;
      escala = baseV6 > 0 ? restoNoMO / baseV6 : 0;
      material = (m.costMaterial ?? 0) * escala;
      proporcional.push(i.name);
    }
    propuesto.costLabor += labor * i.quantity;
    propuesto.costMaterial += material * i.quantity;
    for (const t of ["costTools", "costSubcontract", "costLoss", "costMargin"] as const) {
      propuesto[t] += otros[t] * escala * i.quantity;
    }
  }

  console.log("\n=== SI SE RECUPERA EL DESGLOSE DE LA V6 (con la MO correcta de la V7) ===");
  console.log("categoría | V7 hoy | V7 propuesta | V6 de referencia");
  for (const t of TIPOS) {
    console.log(
      `${ROTULO[t].padEnd(14)} | ${clp(d7[t]).padStart(15)} | ${clp(propuesto[t]).padStart(15)} | ${clp(d6[t]).padStart(15)}`
    );
  }
  const sumaProp = Object.values(propuesto).reduce((a, b) => a + b, 0);
  const cdV7 = (v7.obraItems as Item[])
    .filter((i) => !i.noCobrado && i.name !== "DESCUENTO SEGÚN ACUERDO")
    .reduce((s, i) => s + i.total, 0);
  console.log(`${"SUBTOTAL".padEnd(14)} | ${clp(Object.values(d7).reduce((a, b) => a + b, 0)).padStart(15)} | ${clp(sumaProp).padStart(15)} | ${clp(Object.values(d6).reduce((a, b) => a + b, 0)).padStart(15)}`);
  console.log(`\nCosto directo de la V7 sin la línea de descuento (no se mueve): ${clp(cdV7)}`);
  console.log(`Diferencia entre el desglose propuesto y ese costo directo: ${clp(sumaProp - cdV7)}`);
  console.log(`\nPartidas sin equivalente en la V6 (todo a material): ${sinMatch.length ? sinMatch.join(", ") : "(ninguna)"}`);
  console.log(`Partidas repartidas en proporción porque el precio bajó: ${proporcional.length ? proporcional.join(", ") : "(ninguna)"}`);
}

main()
  .catch((e) => {
    console.error("ERROR:", e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
