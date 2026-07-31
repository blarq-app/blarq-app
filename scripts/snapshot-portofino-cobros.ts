/**
 * Snapshot de TODO lo que puede moverse al repartir las facturas emitidas por
 * concepto (obra / muebles / artefactos) e imputar los pagos que faltaban.
 *
 * Cubre las tres cosas que dependen del concepto de un cobro:
 *   1. El Cuadro Resumen del proyecto: pagado y saldo por concepto.
 *   2. El Fondo de Sueldos (`fondoSueldos.ts`): cuánta plata se puede traspasar
 *      a sueldos, que crece con lo COBRADO de obra y de muebles.
 *   3. Los totales del proyecto (metrics.ts), que NO deberían moverse.
 *
 * Replica las fórmulas en vez de importar los módulos, para no arrastrar el
 * `prisma` global que carga `.env` (§4.9).
 *
 * Solo LEE. Uso: npx tsx scripts/snapshot-portofino-cobros.ts <etiqueta>
 */
import { readFileSync, writeFileSync, existsSync } from "fs";
import { PrismaClient } from "@prisma/client";

const ETIQUETA = process.argv[2] ?? "antes";
const DIR = "/private/tmp/claude-501/-Users-mjblanco-Desktop-blarq-app/322f2d89-4cde-4d41-9f3e-919656befb73/scratchpad";
const PROYECTOS = [60, 64, 65]; // Portofino + controles con facturación viva

const url = readFileSync("/Users/mjblanco/Desktop/blarq-app/.env.prod", "utf8")
  .split("\n")
  .map((l) => l.trim())
  .find((l) => l.startsWith("DATABASE_URL="))!
  .slice("DATABASE_URL=".length)
  .replace(/^["']|["']$/g, "");
const host = url.match(/@([^/]+)\//)?.[1] ?? "???";
const prisma = new PrismaClient({ datasources: { db: { url } } });

const clp = (n: number) => Math.round(n).toLocaleString("es-CL");
const r0 = (n: number) => Math.round(n);

function vigente<T extends { status: string; createdAt: Date }>(arr: T[]): T | undefined {
  const orden = (a: T, b: T) => b.createdAt.getTime() - a.createdAt.getTime();
  return arr.filter((b) => b.status === "enviado" || b.status === "aprobado").sort(orden)[0] ??
    [...arr].sort(orden)[0];
}

// Espejo de desgloseDeCobro: el reparto cargado a mano entre los 5 conceptos.
// Si cualquiera de los cinco campos está seteado, manda el desglose.
function desglose(inv: any) {
  const tiene =
    inv.montoObra != null || inv.montoMuebles != null ||
    inv.artefactoCocina != null || inv.artefactoSanitario != null ||
    inv.artefactoIluminacion != null;
  if (!tiene) return null;
  return {
    obra: inv.montoObra ?? 0,
    muebles: inv.montoMuebles ?? 0,
    cocina: inv.artefactoCocina ?? 0,
    sanitarios: inv.artefactoSanitario ?? 0,
    iluminacion: inv.artefactoIluminacion ?? 0,
  };
}

// Espejo de conceptoDeFactura.
function concepto(inv: { conceptoCobro: string | null; category: { name: string | null } | null }) {
  const c = inv.conceptoCobro;
  if (c === "obra" || c === "muebles" || c === "artefactos") return c;
  const cat = (inv.category?.name ?? "").toLowerCase();
  if (cat.includes("obra")) return "obra";
  if (cat.includes("mueble")) return "muebles";
  if (cat.includes("artefacto")) return "artefactos";
  return null;
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
            muebleChapters: { include: { items: true } },
            artefactoItems: true,
          },
        },
        invoices: {
          include: { category: { select: { name: true } }, payments: true },
        },
      },
    });
    if (!p) continue;

    const obra = vigente(p.budgetVersions.filter((v) => v.type === "obra"));
    const muebles = vigente(p.budgetVersions.filter((v) => v.type === "muebles"));
    const artefactos = vigente(p.budgetVersions.filter((v) => v.type === "artefactos"));

    // ── Acordado ────────────────────────────────────────────────────────
    const cdCobrable = obra ? obra.obraItems.filter((i) => !i.noCobrado).reduce((s, i) => s + i.total, 0) : 0;
    const cdTodo = obra ? obra.obraItems.reduce((s, i) => s + i.total, 0) : 0;
    const ggPct = (obra?.ggPercentage ?? 0) / 100;
    const utilPct = (obra?.utilityPercentage ?? 0) / 100;
    const obraAcordado = cdCobrable * (1 + ggPct + utilPct) * 1.19;
    const muebleItems = muebles ? muebles.muebleChapters.flatMap((c) => c.items) : [];
    const mueblesAcordado = muebleItems.reduce((s, i) => s + i.clientPriceIva * i.quantity, 0);
    const artefactosAcordado = artefactos
      ? artefactos.artefactoItems.reduce((s, i) => s + i.clientPrice * i.quantity, 0)
      : 0;

    // ── Cobrado por concepto (como lo ve el Cuadro Resumen HOY) ──────────
    const emitidas = p.invoices.filter((i) => i.type === "emitida");
    const signo = (i: { tipoDoc: number | null }) => (i.tipoDoc === 61 ? -1 : 1);
    const pagadoPorConcepto: Record<string, number> = { obra: 0, muebles: 0, artefactos: 0, sinConcepto: 0 };
    let pagadoTotal = 0;
    for (const inv of emitidas) {
      const pagos = inv.payments.reduce((s, x) => s + x.amountApplied, 0) * signo(inv);
      pagadoTotal += pagos;
      const d = desglose(inv);
      if (d && inv.totalAmount > 0) {
        const frac = pagos / inv.totalAmount;
        pagadoPorConcepto.obra += d.obra * frac;
        pagadoPorConcepto.muebles += d.muebles * frac;
        pagadoPorConcepto.artefactos += (d.cocina + d.sanitarios + d.iluminacion) * frac;
        continue;
      }
      const c = concepto(inv) ?? "sinConcepto";
      pagadoPorConcepto[c] += pagos;
    }

    // ── Fondo de sueldos (espejo de fondoSueldos.ts) ─────────────────────
    // Desde el 2026-07-30 excluye las partidas noCobrado, igual que el resto.
    const obraGGTotal = cdCobrable * ggPct;
    const obraTotalAcordadoFondo = cdCobrable * (1 + ggPct) * (1 + utilPct) * 1.19;
    const utilMueblesTotal = muebleItems.reduce(
      (s, i) => s + (i.clientPriceNet - i.costDistributor) * i.quantity, 0
    );
    let obraCobrado = 0;
    let mueblesCobrado = 0;
    for (const inv of p.invoices) {
      if (inv.type !== "emitida") continue;
      const s = signo(inv);
      const pagos = inv.payments.length
        ? inv.payments.reduce((a, x) => a + x.amountApplied, 0)
        : inv.status === "pagada" ? inv.totalAmount : 0;
      const d = desglose(inv);
      if (d && inv.totalAmount > 0) {
        const frac = (s * pagos) / inv.totalAmount;
        obraCobrado += d.obra * frac;
        mueblesCobrado += d.muebles * frac;
        continue;
      }
      const c = concepto(inv);
      if (c === "muebles") mueblesCobrado += s * pagos;
      else if (c === "obra") obraCobrado += s * pagos;
    }
    const pctObra = obraTotalAcordadoFondo > 0 ? Math.min(1, obraCobrado / obraTotalAcordadoFondo) : 0;
    const pctMuebles = mueblesAcordado > 0 ? Math.min(1, mueblesCobrado / mueblesAcordado) : 0;

    salida[`#${numero}`] = {
      nombre: p.name,
      obraVigente: obra ? `${obra.version} (${obra.status})` : null,
      obraAcordado: r0(obraAcordado),
      mueblesAcordado: r0(mueblesAcordado),
      artefactosAcordado: r0(artefactosAcordado),
      totalAcordado: r0(obraAcordado + mueblesAcordado + artefactosAcordado),
      facturasEmitidas: emitidas.length,
      facturadoConIva: r0(emitidas.reduce((s, i) => s + signo(i) * i.totalAmount, 0)),
      pagadoTotal: r0(pagadoTotal),
      pagadoObra: r0(pagadoPorConcepto.obra),
      pagadoMuebles: r0(pagadoPorConcepto.muebles),
      pagadoArtefactos: r0(pagadoPorConcepto.artefactos),
      pagadoSinConcepto: r0(pagadoPorConcepto.sinConcepto),
      fondo_obraGGTotal: r0(obraGGTotal),
      fondo_obraCobrado: r0(obraCobrado),
      fondo_pctObra: Number(pctObra.toFixed(4)),
      fondo_obraGenerado: r0(obraGGTotal * pctObra),
      fondo_utilMueblesTotal: r0(utilMueblesTotal),
      fondo_mueblesCobrado: r0(mueblesCobrado),
      fondo_pctMuebles: Number(pctMuebles.toFixed(4)),
      fondo_mueblesGenerado: r0(utilMueblesTotal * pctMuebles),
      fondo_generado: r0(obraGGTotal * pctObra + utilMueblesTotal * pctMuebles),
    };
  }

  writeFileSync(`${DIR}/snapshot-cobros-${ETIQUETA}.json`, JSON.stringify(salida, null, 2));
  for (const [k, v] of Object.entries(salida)) {
    console.log(`\n${k} ${v.nombre} — obra ${v.obraVigente}`);
    console.log(`   acordado ${clp(v.totalAcordado)} · facturado ${clp(v.facturadoConIva)} · pagado ${clp(v.pagadoTotal)}`);
    console.log(`   pagado por concepto: obra ${clp(v.pagadoObra)} · muebles ${clp(v.pagadoMuebles)} · artefactos ${clp(v.pagadoArtefactos)} · sin concepto ${clp(v.pagadoSinConcepto)}`);
    console.log(`   FONDO SUELDOS: generado ${clp(v.fondo_generado)} (obra ${clp(v.fondo_obraGenerado)} al ${(v.fondo_pctObra * 100).toFixed(1)}% · muebles ${clp(v.fondo_mueblesGenerado)} al ${(v.fondo_pctMuebles * 100).toFixed(1)}%)`);
  }

  const antes = `${DIR}/snapshot-cobros-antes.json`;
  if (ETIQUETA !== "antes" && existsSync(antes)) {
    const a = JSON.parse(readFileSync(antes, "utf8"));
    console.log("\n=== DIFERENCIAS ANTES → DESPUÉS ===");
    let n = 0;
    for (const k of Object.keys(salida))
      for (const campo of Object.keys(salida[k]))
        if (a[k]?.[campo] !== salida[k][campo]) {
          n++;
          console.log(`  ${k} ${campo}: ${a[k]?.[campo]} → ${salida[k][campo]}`);
        }
    if (!n) console.log("  (ninguna)");
  }
}

main()
  .catch((e) => {
    console.error("ERROR:", e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
