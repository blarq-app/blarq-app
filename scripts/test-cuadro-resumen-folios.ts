/**
 * Regresión del rótulo de FACTURA en las filas de pago del Cuadro Resumen.
 *
 * El cuadro agrupa los pagos por fecha y junta los folios de las facturas
 * cobradas ese día. Antes concatenaba a ciegas y una factura cobrada en DOS
 * transferencias del mismo día salía repetida: "185/185" (y "177/185/185" en
 * obra). Es el rótulo que ve la clienta en la imagen que le manda MJ.
 *
 * No hay suite general de este módulo (§4.2 de CLAUDE.md), así que este archivo
 * fija el comportamiento con casos mínimos. Los montos se chequean también:
 * el arreglo es SOLO del rótulo y no puede mover plata.
 *
 * Correr: npx tsx scripts/test-cuadro-resumen-folios.ts
 */
import {
  computeCuadroResumen,
  type CuadroResumenInput,
} from "../src/lib/projects/cuadroResumen";

let fallos = 0;
function chequear(que: string, real: unknown, esperado: unknown) {
  const ok = JSON.stringify(real) === JSON.stringify(esperado);
  if (!ok) fallos++;
  console.log(`${ok ? "OK  " : "FALLA"} ${que}`);
  if (!ok) console.log(`      esperado: ${JSON.stringify(esperado)}\n      real:     ${JSON.stringify(real)}`);
}

// Presupuesto mínimo: una obra de $1.000.000 netos. Con GG y utilidad en 0,
// el acordado es CD × 1.19 = $1.190.000. Alcanza para que el concepto "obra"
// exista y las facturas tengan dónde imputarse.
const budgets = [
  {
    version: "V1",
    status: "aprobado",
    type: "obra",
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
    ggPercentage: 0,
    utilityPercentage: 0,
    obraItems: [{ total: 1_000_000 }],
    muebleChapters: [],
    artefactoItems: [],
  },
];

const pago = (fecha: string, monto: number) => ({
  amountApplied: monto,
  bankMovement: { date: new Date(fecha) },
});

const facturaObra = (folio: string, total: number, pagos: ReturnType<typeof pago>[]) => ({
  type: "emitida",
  category: { name: "Obra" },
  conceptoCobro: null,
  folioNumber: folio,
  totalAmount: total,
  artefactoCocina: null,
  artefactoSanitario: null,
  artefactoIluminacion: null,
  payments: pagos,
});

function correr(nombre: string, invoices: unknown[]) {
  const data = computeCuadroResumen({ invoices, budgets } as unknown as CuadroResumenInput);
  console.log(`\n— ${nombre}`);
  return data;
}

// ── Caso 1: UNA factura cobrada en DOS transferencias el MISMO día ─────────
// Es el caso que rompía: el folio se pegaba dos veces ("185/185").
{
  const d = correr("una factura, dos pagos el mismo día", [
    facturaObra("185", 200_000, [pago("2026-08-12", 120_000), pago("2026-08-12", 80_000)]),
  ]);
  chequear("una sola fila de pago", d.pagos.length, 1);
  chequear("el folio NO se repite", d.pagos[0].porConcepto.obra.folio, "185");
  chequear("el monto es la suma de los dos pagos", d.pagos[0].porConcepto.obra.monto, 200_000);
}

// ── Caso 2: DOS facturas distintas cobradas el mismo día ──────────────────
// Acá SÍ se juntan: son dos facturas de verdad y la clienta tiene que ver las dos.
{
  const d = correr("dos facturas distintas, mismo día", [
    facturaObra("177", 100_000, [pago("2026-08-12", 100_000)]),
    facturaObra("185", 200_000, [pago("2026-08-12", 200_000)]),
  ]);
  chequear("una sola fila (mismo día)", d.pagos.length, 1);
  chequear("se listan las dos facturas", d.pagos[0].porConcepto.obra.folio, "177/185");
  chequear("el monto suma las dos", d.pagos[0].porConcepto.obra.monto, 300_000);
}

// ── Caso 3: el caso real de Paseo del Sena en obra ────────────────────────
// La 177 saldada + la 185 cobrada en dos transferencias, todo el mismo día:
// antes daba "177/185/185", ahora "177/185".
{
  const d = correr("mezcla: una factura entera + otra en dos pagos", [
    facturaObra("177", 50_000, [pago("2026-08-12", 50_000)]),
    facturaObra("185", 200_000, [pago("2026-08-12", 120_000), pago("2026-08-12", 80_000)]),
  ]);
  chequear("cada factura una sola vez", d.pagos[0].porConcepto.obra.folio, "177/185");
  chequear("el monto no se toca", d.pagos[0].porConcepto.obra.monto, 250_000);
}

// ── Caso 4: días distintos no se mezclan ──────────────────────────────────
{
  const d = correr("misma factura, dos días distintos", [
    facturaObra("185", 200_000, [pago("2026-08-12", 120_000), pago("2026-08-13", 80_000)]),
  ]);
  chequear("dos filas, una por día", d.pagos.length, 2);
  chequear("folio del día 1", d.pagos[0].porConcepto.obra.folio, "185");
  chequear("folio del día 2", d.pagos[1].porConcepto.obra.folio, "185");
}

console.log(`\n${fallos === 0 ? "TODO OK" : `${fallos} FALLA(S)`}`);
process.exitCode = fallos === 0 ? 0 : 1;
