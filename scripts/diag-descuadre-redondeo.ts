// Diagnóstico SOLO LECTURA del "punto rojo" de descuadre en el editor de obra.
//
// Por qué existe: la marca roja se prendía en partidas sanas por diferencias de
// centavos. La causa es que la regla vieja comparaba TOTALES (porUnidad x
// cantidad), así que un redondeo de centavos en el precio unitario se
// MULTIPLICABA por la cantidad (8,4 m2 -> se pasaba del umbral de $1).
//
// Este script corre las dos reglas sobre los datos reales y lista en qué
// partidas difieren, para poder afirmar con evidencia que (a) los falsos
// positivos se apagan y (b) los descuadres de verdad siguen prendiéndose.
//
// Uso: npx tsx scripts/diag-descuadre-redondeo.ts <ruta-env>
import { PrismaClient } from "@prisma/client";
import type { ObraItemComponent } from "@prisma/client";
import { readFileSync } from "fs";

const envPath = process.argv[2];
if (!envPath) {
  console.error("uso: npx tsx scripts/diag-descuadre-redondeo.ts <ruta-env>");
  process.exit(1);
}
const raw = readFileSync(envPath, "utf8");
const m = raw.match(/DATABASE_URL\s*=\s*"?([^"\n]+)"?/);
if (!m) {
  console.error("no DATABASE_URL en", envPath);
  process.exit(1);
}
const url = m[1].trim();
const host = url.match(/@([^/.]+)/)?.[1] ?? "?";

// Datasource explícito: si dependemos de dotenv, el DATABASE_URL que ya está en
// el shell gana y terminamos leyendo la base equivocada (CLAUDE.md 4.9).
const prisma = new PrismaClient({ datasources: { db: { url } } });

// Espejo exacto de componentEffectiveTotal en ObraEditor.tsx / effectiveTotal
// en recalcObraItem.ts.
function effectiveTotal(
  c: ObraItemComponent,
  all: ObraItemComponent[]
): number {
  const pct = c.quantity || 0;
  if (c.unit !== "%") return (c.quantity || 0) * (c.unitCost || 0);
  if (c.type === "perdida") {
    if (c.appliedToComponentId) {
      const t = all.find((x) => x.id === c.appliedToComponentId);
      return t ? effectiveTotal(t, all) * (pct / 100) : 0;
    }
    if (c.appliedToType === "material") {
      const base = all
        .filter((x) => x.type === "material" && x.id !== c.id)
        .reduce((s, x) => s + effectiveTotal(x, all), 0);
      return base * (pct / 100);
    }
    return 0;
  }
  if (c.type === "mano_obra" && c.appliedToType === "mano_obra") {
    const base = all
      .filter((x) => x.type === "mano_obra" && x.unit !== "%" && x.id !== c.id)
      .reduce((s, x) => s + effectiveTotal(x, all), 0);
    return base * (pct / 100);
  }
  if (c.type === "margen") {
    const base = all
      .filter((x) => x.id !== c.id && x.type !== "margen" && x.type !== "perdida")
      .reduce((s, x) => s + effectiveTotal(x, all), 0);
    return base * (pct / 100);
  }
  return (c.quantity || 0) * (c.unitCost || 0);
}

const clp = (n: number) =>
  "$" + Math.round(n).toLocaleString("es-CL");

async function main() {
  console.log(`=== ENV: ${envPath} | HOST: ${host} ===\n`);

  const items = await prisma.obraItem.findMany({
    where: { components: { some: {} } },
    select: {
      id: true,
      name: true,
      unit: true,
      quantity: true,
      unitPrice: true,
      total: true,
      components: true,
      budgetVersion: {
        select: {
          version: true,
          project: { select: { numeroProyecto: true, name: true } },
        },
      },
    },
  });

  let vieja = 0;
  let nueva = 0;
  const falsosPositivos: string[] = [];
  const soloNueva: string[] = [];

  for (const it of items) {
    const comps = it.components;
    const porUnidad = comps.reduce((s, c) => s + effectiveTotal(c, comps), 0);
    const realTotal = porUnidad * (it.quantity ?? 0);

    // REGLA VIEJA: compara totales, umbral $1. El redondeo del P.U. se
    // multiplica por la cantidad.
    const rojoViejo = Math.abs((it.total ?? 0) - realTotal) > 1;

    // REGLA NUEVA: compara el P.U. redondeado al peso (misma convención que
    // clientVisibleTotal en versionDiff.ts) + red de seguridad sobre el total
    // con tolerancia proporcional a la cantidad.
    const puGuardado = it.unitPrice ?? 0;
    const driftUnitario = Math.abs(porUnidad - puGuardado) > 1;
    const qty = it.quantity ?? 0;
    const totalEsperado = Math.round(puGuardado) * qty;
    const toleranciaTotal = Math.abs(qty) + 1;
    const driftTotal = Math.abs((it.total ?? 0) - totalEsperado) > toleranciaTotal;
    const rojoNuevo = driftUnitario || driftTotal;

    if (rojoViejo) vieja++;
    if (rojoNuevo) nueva++;

    const etiqueta =
      `#${it.budgetVersion?.project?.numeroProyecto ?? "?"} ` +
      `${it.budgetVersion?.project?.name ?? "?"} V${it.budgetVersion?.version ?? "?"} | ` +
      `${it.name} | ${qty} ${it.unit} | ` +
      `P.U. guardado ${clp(it.unitPrice ?? 0)} vs desglose ${porUnidad.toFixed(2)} | ` +
      `total guardado ${clp(it.total ?? 0)} vs ${realTotal.toFixed(2)} | ` +
      `dif total ${((it.total ?? 0) - realTotal).toFixed(2)}`;

    if (rojoViejo && !rojoNuevo) falsosPositivos.push(etiqueta);
    if (rojoNuevo && !rojoViejo) soloNueva.push(etiqueta);
  }

  console.log(`Partidas con desglose analizadas: ${items.length}`);
  console.log(`Punto rojo con la regla VIEJA: ${vieja}`);
  console.log(`Punto rojo con la regla NUEVA: ${nueva}`);
  console.log(`Se apagan (falsos positivos por redondeo): ${falsosPositivos.length}`);
  console.log(`Se prenden solo con la nueva: ${soloNueva.length}\n`);

  console.log("--- SE APAGAN (eran redondeo) ---");
  for (const l of falsosPositivos.slice(0, 40)) console.log("  " + l);
  if (falsosPositivos.length > 40)
    console.log(`  ... y ${falsosPositivos.length - 40} más`);

  if (soloNueva.length) {
    console.log("\n--- SE PRENDEN SOLO CON LA NUEVA ---");
    for (const l of soloNueva.slice(0, 20)) console.log("  " + l);
  }

  // Detalle del caso que reportó MJ.
  const retiro = items.filter((i) => /RETIRO PISO/i.test(i.name));
  if (retiro.length) {
    console.log("\n--- CASO REPORTADO: RETIRO PISO ---");
    for (const it of retiro) {
      const comps = it.components;
      const porUnidad = comps.reduce((s, c) => s + effectiveTotal(c, comps), 0);
      console.log(
        `  #${it.budgetVersion?.project?.numeroProyecto} ${it.budgetVersion?.project?.name} V${it.budgetVersion?.version} | ${it.name}`
      );
      console.log(
        `    cantidad ${it.quantity} ${it.unit} | P.U. guardado ${it.unitPrice} | desglose porUnidad ${porUnidad.toFixed(4)}`
      );
      console.log(
        `    total guardado ${it.total} | porUnidad x cantidad ${(porUnidad * (it.quantity ?? 0)).toFixed(4)} | dif ${((it.total ?? 0) - porUnidad * (it.quantity ?? 0)).toFixed(4)}`
      );
      console.log(
        `    VIEJA: ${Math.abs((it.total ?? 0) - porUnidad * (it.quantity ?? 0)) > 1 ? "ROJO" : "sin marca"} | NUEVA: ${
          Math.round(porUnidad) !== Math.round(it.unitPrice ?? 0) ||
          Math.abs((it.total ?? 0) - Math.round(it.unitPrice ?? 0) * (it.quantity ?? 0)) >
            Math.abs(it.quantity ?? 0) + 1
            ? "ROJO"
            : "sin marca"
        }`
      );
    }
  }
}

main()
  .catch((e) => console.error("ERROR:", e.message))
  .finally(() => prisma.$disconnect());
