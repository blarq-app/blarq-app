/**
 * Snapshot de la plata de un puñado de proyectos, para correr ANTES y DESPUÉS
 * de cargar la obra V7 de Portofino y comparar (§4.1: acá se toca plata y no
 * hay tests sobre los cálculos).
 *
 * Replica la fórmula de `src/lib/projects/metrics.ts`: manda UNA sola versión
 * por tipo — la más reciente enviada o aprobada (selectVigente) — y las
 * partidas `noCobrado` quedan fuera del total al cliente.
 *
 * Además de Portofino van dos proyectos de control que esta carga NO debería
 * tocar: si se mueven, algo se rompió.
 *
 * NO usa dotenv — datasource explícito desde `.env.prod` (§4.9). Solo LEE.
 *
 *   npx tsx scripts/snapshot-portofino-metricas.ts antes
 *   npx tsx scripts/snapshot-portofino-metricas.ts despues
 */
import { readFileSync, writeFileSync, existsSync } from "fs";
import { PrismaClient } from "@prisma/client";

const ENV_PROD = "/Users/mjblanco/Desktop/blarq-app/.env.prod";
const DIR = "/private/tmp/claude-501/-Users-mjblanco-Desktop-blarq-app/322f2d89-4cde-4d41-9f3e-919656befb73/scratchpad";
const ETIQUETA = process.argv[2] ?? "antes";
const PROYECTOS = [60, 61, 64]; // Portofino + dos de control

const url = readFileSync(ENV_PROD, "utf8")
  .split("\n")
  .map((l) => l.trim())
  .find((l) => l.startsWith("DATABASE_URL="))!
  .slice("DATABASE_URL=".length)
  .replace(/^["']|["']$/g, "");
const host = url.match(/@([^/]+)\//)?.[1] ?? "???";
const prisma = new PrismaClient({ datasources: { db: { url } } });

const clp = (n: number) => Math.round(n).toLocaleString("es-CL");

// Espejo de selectVigentes: la más reciente aprobada/enviada; si no hay,
// la más reciente de todas.
function vigente<T extends { status: string; createdAt: Date }>(arr: T[]): T | undefined {
  const orden = (a: T, b: T) => b.createdAt.getTime() - a.createdAt.getTime();
  const ok = arr.filter((b) => b.status === "enviado" || b.status === "aprobado").sort(orden);
  return ok[0] ?? [...arr].sort(orden)[0];
}

async function main() {
  console.log("HOST:", host, "| etiqueta:", ETIQUETA);
  const salida: Record<string, any> = {};

  for (const numero of PROYECTOS) {
    const p = await prisma.project.findFirst({
      where: { numeroProyecto: numero },
      include: {
        budgetVersions: {
          include: {
            obraItems: true,
            muebleItems: true,
            artefactoItems: true,
          },
        },
        invoices: { select: { type: true, tipoDoc: true, netAmount: true, totalAmount: true } },
      },
    });
    if (!p) continue;

    const obra = vigente(p.budgetVersions.filter((b) => b.type === "obra"));
    const muebles = vigente(p.budgetVersions.filter((b) => b.type === "muebles"));
    const artefactos = vigente(p.budgetVersions.filter((b) => b.type === "artefactos"));

    const cobrables = obra ? obra.obraItems.filter((i) => !i.noCobrado) : [];
    const cd = cobrables.reduce((s, i) => s + i.total, 0);
    const obraNeto = cd * (1 + (obra?.ggPercentage ?? 0) / 100 + (obra?.utilityPercentage ?? 0) / 100);
    const obraTotal = obraNeto * 1.19;
    const moPresupuestada = cobrables.reduce((s, i) => s + (i.costLabor ?? 0) * i.quantity, 0);
    const noCobradas = obra ? obra.obraItems.filter((i) => i.noCobrado) : [];
    const moNoCobrada = noCobradas.reduce((s, i) => s + (i.costLabor ?? 0) * i.quantity, 0);

    const dctoM = muebles?.discountPercentage ?? 0;
    const mueblesTotal =
      (muebles?.muebleItems.reduce((s, i) => s + i.clientPriceIva * i.quantity, 0) ?? 0) * (1 - dctoM);
    const artefactosTotal =
      artefactos?.artefactoItems.reduce((s, i) => s + i.clientPrice * i.quantity, 0) ?? 0;

    const signo = (i: { tipoDoc: number | null }) => (i.tipoDoc === 61 ? -1 : 1);
    const cobradoNeto = p.invoices
      .filter((i) => i.type === "emitida")
      .reduce((s, i) => s + signo(i) * i.netAmount, 0);
    const gastado = p.invoices
      .filter((i) => i.type === "recibida")
      .reduce((s, i) => s + signo(i) * i.netAmount, 0);

    salida[`#${numero}`] = {
      nombre: p.name,
      currentVersion: p.currentVersion,
      obraVigente: obra ? `${obra.version} (${obra.status})` : null,
      obraPartidas: obra?.obraItems.length ?? 0,
      obraNoCobradas: noCobradas.length,
      costoDirecto: Math.round(cd),
      obraNeto: Math.round(obraNeto),
      obraTotal: Math.round(obraTotal),
      moPresupuestada: Math.round(moPresupuestada),
      moNoCobrada: Math.round(moNoCobrada),
      mueblesTotal: Math.round(mueblesTotal),
      artefactosTotal: Math.round(artefactosTotal),
      totalAcordado: Math.round(obraTotal + mueblesTotal + artefactosTotal),
      cobradoNeto: Math.round(cobradoNeto),
      gastado: Math.round(gastado),
      utilidadReal: Math.round(cobradoNeto - gastado),
    };
  }

  const archivo = `${DIR}/snapshot-metricas-${ETIQUETA}.json`;
  writeFileSync(archivo, JSON.stringify(salida, null, 2));

  for (const [k, v] of Object.entries(salida)) {
    console.log(`\n${k} ${v.nombre} — obra vigente ${v.obraVigente} · currentVersion ${v.currentVersion}`);
    console.log(`   costo directo ${clp(v.costoDirecto)} · obra c/IVA ${clp(v.obraTotal)}`);
    console.log(`   muebles ${clp(v.mueblesTotal)} · artefactos ${clp(v.artefactosTotal)}`);
    console.log(`   TOTAL ACORDADO ${clp(v.totalAcordado)}`);
    console.log(`   MO presupuestada ${clp(v.moPresupuestada)} · MO no cobrada ${clp(v.moNoCobrada)}`);
    console.log(`   cobrado neto ${clp(v.cobradoNeto)} · gastado ${clp(v.gastado)} · utilidad real ${clp(v.utilidadReal)}`);
  }

  // Si existe el "antes", mostrar el diff.
  const antes = `${DIR}/snapshot-metricas-antes.json`;
  if (ETIQUETA !== "antes" && existsSync(antes)) {
    const a = JSON.parse(readFileSync(antes, "utf8"));
    console.log("\n=== DIFERENCIAS ANTES → DESPUÉS ===");
    let cambios = 0;
    for (const k of Object.keys(salida)) {
      for (const campo of Object.keys(salida[k])) {
        const va = a[k]?.[campo];
        const vd = salida[k][campo];
        if (va !== vd) {
          cambios++;
          console.log(`  ${k} ${campo}: ${va} → ${vd}`);
        }
      }
    }
    if (cambios === 0) console.log("  (ninguna)");
  }
}

main()
  .catch((e) => {
    console.error("ERROR:", e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
