// Tests de regresión para computeUtilidadPorCobro (utilidad por cobro).
// Sin framework — tira error si algo no cuadra. Correr:
//   npx tsx scripts/test-utilidad-por-cobro.ts
//
// No toca la base. Arma proyectos sintéticos en memoria.

import {
  computeUtilidadPorCobro,
  type ProjectWithUtilidad,
} from "../src/lib/banco/utilidadPorCobro";

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error("  ✗ " + msg);
    failures++;
  } else {
    console.log("  ✓ " + msg);
  }
}
function approx(a: number, b: number, tol = 1) {
  return Math.abs(a - b) <= tol;
}

// Helpers para armar el shape que espera el cálculo (subset del include).
function obraVersion(opts: {
  status?: string;
  cd: number;
  gg: number;
  util: number;
}) {
  return {
    type: "obra",
    status: opts.status ?? "aprobado",
    createdAt: new Date("2026-01-01"),
    ggPercentage: opts.gg,
    utilityPercentage: opts.util,
    obraItems: [{ total: opts.cd }],
    muebleChapters: [],
  };
}
function mueblesVersion(items: { qty: number; cost: number; net: number; iva: number }[]) {
  return {
    type: "muebles",
    status: "aprobado",
    createdAt: new Date("2026-01-01"),
    ggPercentage: null,
    utilityPercentage: null,
    obraItems: [],
    muebleChapters: [
      {
        items: items.map((i) => ({
          quantity: i.qty,
          costDistributor: i.cost,
          clientPriceNet: i.net,
          clientPriceIva: i.iva,
        })),
      },
    ],
  };
}
function emitida(opts: {
  id: string;
  concepto: string | null;
  cobrado: number; // c/IVA, vía un payment
  tipoDoc?: number;
  fecha?: string;
}) {
  return {
    id: opts.id,
    type: "emitida",
    tipoDoc: opts.tipoDoc ?? 33,
    issueDate: new Date(opts.fecha ?? "2026-02-01"),
    folioNumber: opts.id,
    netAmount: opts.cobrado / 1.19,
    totalAmount: opts.cobrado,
    conceptoCobro: opts.concepto,
    status: "pagada",
    payments: [{ amountApplied: opts.cobrado }],
    category: null,
  };
}
function recibidaMueble(opts: { id: string; neto: number; cat: string; tipoDoc?: number }) {
  return {
    id: opts.id,
    type: "recibida",
    tipoDoc: opts.tipoDoc ?? 33,
    issueDate: new Date("2026-02-01"),
    folioNumber: opts.id,
    netAmount: opts.neto,
    totalAmount: opts.neto * 1.19,
    conceptoCobro: null,
    status: "pagada",
    payments: [],
    category: { name: opts.cat, parent: null },
  };
}
function proj(status: string, budgetVersions: unknown[], invoices: unknown[]): ProjectWithUtilidad {
  return { status, budgetVersions, invoices } as unknown as ProjectWithUtilidad;
}

console.log("\nTEST 1 — Obra: GG × % cobrado, por cobro");
{
  // CD = 10.000.000, GG 20%, Util 5%.
  // GG = 2.000.000. Acordado = 10M × 1.20 × 1.05 × 1.19 = 14.994.000.
  // Tasa utilidad obra = 2.000.000 / 14.994.000 = 0.133387...
  const r = computeUtilidadPorCobro(
    proj(
      "ejecucion",
      [obraVersion({ cd: 10_000_000, gg: 20, util: 5 })],
      [
        emitida({ id: "F1", concepto: "obra", cobrado: 5_997_600 }), // 40% del acordado
      ]
    )
  );
  assert(approx(r.obraGGTotal, 2_000_000), `GG total = 2.000.000 (got ${Math.round(r.obraGGTotal)})`);
  assert(approx(r.obraTotalAcordado, 14_994_000), `acordado = 14.994.000 (got ${Math.round(r.obraTotalAcordado)})`);
  // Cobrado 40% del acordado → utilidad de ese cobro = 40% del GG = 800.000.
  assert(r.cobros.length === 1, "1 cobro");
  assert(approx(r.cobros[0].utilidad, 800_000), `utilidad del cobro 40% = 800.000 (got ${Math.round(r.cobros[0].utilidad)})`);
  assert(approx(r.cobros[0].sugerenciaTraspaso, 800_000), "sugerencia = utilidad");
  assert(approx(r.utilidadObraReconocida, 800_000), "obra reconocida = 800.000");
}

console.log("\nTEST 2 — Obra: anexos (varias versiones aprobadas) suman");
{
  // Principal: CD 10M GG 20% util 5%. Anexo: CD 2M GG 23% util 5%.
  // GG total = 2.000.000 + 460.000 = 2.460.000.
  const r = computeUtilidadPorCobro(
    proj(
      "ejecucion",
      [
        obraVersion({ cd: 10_000_000, gg: 20, util: 5 }),
        obraVersion({ cd: 2_000_000, gg: 23, util: 5 }),
      ],
      []
    )
  );
  assert(approx(r.obraGGTotal, 2_460_000), `GG con anexo = 2.460.000 (got ${Math.round(r.obraGGTotal)})`);
}

console.log("\nTEST 3 — Muebles en ejecución: utilidad estimada × % cobrado");
{
  // 1 item: costo 1.000.000, net 1.500.000 (util 500.000), iva 1.785.000.
  // Acordado = 1.785.000. Cobrado 60% = 1.071.000 → util = 60% × 500.000 = 300.000.
  const r = computeUtilidadPorCobro(
    proj(
      "ejecucion",
      [mueblesVersion([{ qty: 1, cost: 1_000_000, net: 1_500_000, iva: 1_785_000 }])],
      [emitida({ id: "M1", concepto: "muebles", cobrado: 1_071_000 })]
    )
  );
  assert(approx(r.utilMueblesEstimadaTotal, 500_000), "util estimada muebles = 500.000");
  assert(approx(r.cobros[0].utilidad, 300_000), `util cobro 60% = 300.000 (got ${Math.round(r.cobros[0].utilidad)})`);
  assert(r.ajusteFinalMuebles === null, "sin ajuste final (no terminado)");
}

console.log("\nTEST 4 — Muebles TERMINADO: ajuste a utilidad real");
{
  // Estimada 500.000. Cobrado total c/IVA = 1.785.000 (neto 1.500.000).
  // Gasto real muebles = 1.100.000 (subió 100k vs estimado). Util real =
  // 1.500.000 − 1.100.000 = 400.000. Reconocida estimada (100% cobrado) =
  // 500.000. Ajuste final = 400.000 − 500.000 = −100.000 (nos pasamos de más).
  const r = computeUtilidadPorCobro(
    proj(
      "terminado",
      [mueblesVersion([{ qty: 1, cost: 1_000_000, net: 1_500_000, iva: 1_785_000 }])],
      [
        emitida({ id: "M1", concepto: "muebles", cobrado: 1_785_000 }),
        recibidaMueble({ id: "C1", neto: 1_100_000, cat: "Mueble" }),
      ]
    )
  );
  assert(approx(r.mueblesCobradoNeto ?? 0, 1_500_000), `cobrado neto = 1.500.000 (got ${Math.round(r.mueblesCobradoNeto ?? 0)})`);
  assert(approx(r.mueblesGastadoNeto ?? 0, 1_100_000), `gastado neto = 1.100.000 (got ${Math.round(r.mueblesGastadoNeto ?? 0)})`);
  assert(approx(r.utilidadMueblesReal ?? 0, 400_000), `util real = 400.000 (got ${Math.round(r.utilidadMueblesReal ?? 0)})`);
  assert(approx(r.utilidadMueblesReconocida, 500_000), "reconocida estimada = 500.000");
  assert(approx(r.ajusteFinalMuebles ?? 0, -100_000), `ajuste final = −100.000 (got ${Math.round(r.ajusteFinalMuebles ?? 0)})`);
  assert(approx(r.utilidadTotalReconocida, 400_000), `total reconocido = util real = 400.000 (got ${Math.round(r.utilidadTotalReconocida)})`);
}

console.log("\nTEST 5 — Artefactos no generan utilidad; NC resta");
{
  const r = computeUtilidadPorCobro(
    proj(
      "ejecucion",
      [obraVersion({ cd: 10_000_000, gg: 20, util: 5 })],
      [
        emitida({ id: "A1", concepto: "artefactos", cobrado: 2_000_000 }),
        emitida({ id: "F1", concepto: "obra", cobrado: 5_997_600 }),
        emitida({ id: "NC1", concepto: "obra", cobrado: 2_998_800, tipoDoc: 61 }), // NC de la mitad
      ]
    )
  );
  const art = r.cobros.find((c) => c.concepto === "artefactos");
  assert(art !== undefined && art.utilidad === 0, "artefactos: utilidad 0");
  // Obra: cobró 5.997.600 y revirtió 2.998.800 → neto 2.998.800 ≈ 20% del acordado
  // → utilidad ≈ 400.000. (800.000 − 400.000).
  assert(approx(r.utilidadObraReconocida, 400_000, 5), `obra neta tras NC ≈ 400.000 (got ${Math.round(r.utilidadObraReconocida)})`);
}

console.log("\nTEST 7 — Sobre-cobro de obra: topa en GG total + alerta");
{
  // GG total 2.000.000, acordado 14.994.000. Cobramos 20.000.000 (más que el
  // acordado, p.ej. por adicionales sin cargar o cobros mal etiquetados).
  // Sin tope daría 20M × 13,3% = 2.668.000 > GG. Con tope = 2.000.000.
  const r = computeUtilidadPorCobro(
    proj(
      "ejecucion",
      [obraVersion({ cd: 10_000_000, gg: 20, util: 5 })],
      [emitida({ id: "F1", concepto: "obra", cobrado: 20_000_000 })]
    )
  );
  assert(approx(r.utilidadObraReconocida, 2_000_000), `obra reconocida topada en GG = 2.000.000 (got ${Math.round(r.utilidadObraReconocida)})`);
  assert(r.sobreCobroObra === true, "alerta sobreCobroObra = true");
}

console.log("\nTEST 6 — Proyecto vacío no explota");
{
  const r = computeUtilidadPorCobro(proj("cotizacion", [], []));
  assert(r.cobros.length === 0, "sin cobros");
  assert(r.utilidadTotalReconocida === 0, "total 0");
  assert(r.tasaUtilidadObra === 0, "tasa obra 0 (sin div por cero)");
}

console.log("\n" + (failures === 0 ? "TODOS OK ✓" : `${failures} FALLO(S) ✗`));
process.exit(failures === 0 ? 0 : 1);
