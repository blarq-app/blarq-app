"use client";

import { Fragment, useMemo, useState } from "react";
import { formatCLP } from "@/lib/utils";
import type { CuadroResumenData, ConceptoKey } from "@/lib/projects/cuadroResumen";

// Cuadro Resumen interactivo: réplica del cuadro Excel de MJ + la fila AVANCE
// editable. Por concepto muestra el acordado vigente, los cobros (agrupados por
// fecha = un avance), TOTAL PAGOS, una fila AVANCE donde MJ pone el % que pide
// EN ESTE avance (incremental) → calcula el monto a pedir, y SALDO PENDIENTE
// recalculado. Es el cuadro que se le entrega al cliente.
//
// Abajo, "Me paso a Sueldos" (INTERNO, no va al cliente): de obra + muebles,
// cuánto generaría el fondo con el avance puesto, menos lo ya transferido.

function fmtDate(d: Date): string {
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yy = String(d.getFullYear()).slice(2);
  return `${dd}-${mm}-${yy}`;
}

export default function CuadroResumenAvance({
  data,
  transferido,
}: {
  data: CuadroResumenData;
  transferido: number;
}) {
  const { conceptos, pagos, totalAcordado, totalPagado, saldoTotal, avanceTotal, versionLabel } =
    data;

  // % OBJETIVO al que MJ quiere llegar, por concepto. Default = el % ya cobrado
  // (redondeado), así "a pedir" arranca en 0 hasta que sube la barra. Ponés
  // 100 → te pide EXACTO el saldo que falta (sin problema de decimales).
  const [avance, setAvance] = useState<Record<string, number>>(() =>
    Object.fromEntries(conceptos.map((c) => [c.key, Math.round(c.avancePct * 100)]))
  );

  const calc = useMemo(() => {
    const porConcepto = new Map<
      ConceptoKey,
      { aPedir: number; saldoNuevo: number; pctFinal: number; generado: number }
    >();
    let totalAPedir = 0;
    let totalSaldoNuevo = 0;
    let generadoTotal = 0;
    for (const c of conceptos) {
      // El % es el OBJETIVO al que llegar. A pedir = lo que falta para llegar
      // a ese % (nunca negativo). Así 100% pide exactamente el saldo restante.
      const objetivo = (avance[c.key] ?? 0) / 100;
      const aPedir = Math.max(0, objetivo * c.acordado - c.pagado);
      const saldoNuevo = Math.max(0, c.acordado - c.pagado - aPedir);
      const pctFinal = c.acordado > 0 ? (c.pagado + aPedir) / c.acordado : 0;
      const generado = c.generaSueldo ? Math.min(1, pctFinal) * c.utilidad100 : 0;
      porConcepto.set(c.key, { aPedir, saldoNuevo, pctFinal, generado });
      totalAPedir += aPedir;
      totalSaldoNuevo += saldoNuevo;
      generadoTotal += generado;
    }
    const aTransferir = Math.max(0, generadoTotal - transferido);
    const transferidoDeMas = transferido - generadoTotal > 1000;
    return { porConcepto, totalAPedir, totalSaldoNuevo, generadoTotal, aTransferir, transferidoDeMas };
  }, [conceptos, avance, transferido]);

  if (conceptos.length === 0 && pagos.length === 0) return null;

  const cellMonto = (v: number) =>
    v > 0 ? <span className="tabular-nums">{formatCLP(v)}</span> : <span className="text-gray-300">—</span>;

  function setPct(key: string, value: string) {
    const n = Math.max(0, Math.min(100, Math.round(Number(value) || 0)));
    setAvance((prev) => ({ ...prev, [key]: n }));
  }

  const sueldoConceptos = conceptos.filter((c) => c.generaSueldo);

  return (
    <div className="space-y-4 mb-8">
      {/* ── Cuadro Resumen + AVANCE editable (esto va al cliente) ─────────── */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-1">Cuadro Resumen</h2>
        <p className="text-xs text-gray-500 mb-4">
          Acordado por concepto, lo ya cobrado, y el avance que pedís ahora.
          Completá el % AL QUE QUERÉS LLEGAR por concepto (100% = cobrar todo el
          saldo) y te calcula cuánto pedir. Las columnas son las del
          presupuesto entregado al cliente.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="text-[10px] uppercase tracking-wider text-gray-500">
                <th className="pb-1 pr-2 text-left"></th>
                {conceptos.map((c) => (
                  <th key={c.key} colSpan={3} className="pb-1 px-2 text-center border-l border-gray-200 font-semibold text-gray-700">
                    {c.label}
                  </th>
                ))}
                <th className="pb-1 pl-2 text-right border-l border-gray-200 font-semibold text-gray-700">Total</th>
              </tr>
              <tr className="text-[10px] uppercase tracking-wider text-gray-400 border-b border-gray-300">
                <th></th>
                {conceptos.map((c) => (
                  <Fragment key={c.key}>
                    <th className="pb-1 px-2 border-l border-gray-100 text-left font-medium">Fecha</th>
                    <th className="pb-1 px-2 text-right font-medium">Monto</th>
                    <th className="pb-1 px-2 text-right font-medium">Factura</th>
                  </Fragment>
                ))}
                <th className="pb-1 pl-2 border-l border-gray-200"></th>
              </tr>
            </thead>
            <tbody>
              {/* Acordado (versión vigente) */}
              <tr className="bg-gray-50 border-b border-gray-200 font-semibold text-gray-900">
                <td className="py-2 pr-2 text-left">{versionLabel}</td>
                {conceptos.map((c) => (
                  <Fragment key={c.key}>
                    <td className="py-2 px-2 border-l border-gray-200 text-left text-gray-600 font-normal">{c.fecha}</td>
                    <td className="py-2 px-2 text-right tabular-nums">{cellMonto(c.acordado)}</td>
                    <td className="py-2 px-2"></td>
                  </Fragment>
                ))}
                <td className="py-2 pl-2 border-l border-gray-200 text-right tabular-nums">{formatCLP(totalAcordado)}</td>
              </tr>

              {/* Cobros (agrupados por fecha) */}
              {pagos.map((r, i) => (
                <tr key={i} className="border-b border-gray-50 text-gray-700">
                  <td className="py-1.5 pr-2"></td>
                  {conceptos.map((c) => {
                    const cell = r.porConcepto[c.key];
                    return (
                      <Fragment key={c.key}>
                        <td className="py-1.5 px-2 border-l border-gray-100 text-left">{cell.monto ? fmtDate(r.date) : ""}</td>
                        <td className="py-1.5 px-2 text-right">{cellMonto(cell.monto)}</td>
                        <td className="py-1.5 px-2 text-right text-gray-500">{cell.monto && cell.folio ? cell.folio : ""}</td>
                      </Fragment>
                    );
                  })}
                  <td className="py-1.5 pl-2 border-l border-gray-200"></td>
                </tr>
              ))}

              {/* TOTAL PAGOS */}
              <tr className="border-t-2 border-gray-300 bg-gray-50 font-semibold text-gray-900">
                <td className="py-2 pr-2 text-left uppercase text-[10px] tracking-wider">Total pagos</td>
                {conceptos.map((c) => (
                  <Fragment key={c.key}>
                    <td className="py-2 px-2 border-l border-gray-200 text-left text-gray-500 font-normal">{(c.avancePct * 100).toFixed(0)}%</td>
                    <td colSpan={2} className="py-2 px-2 text-right tabular-nums">{cellMonto(c.pagado)}</td>
                  </Fragment>
                ))}
                <td className="py-2 pl-2 border-l border-gray-200 text-right tabular-nums">{formatCLP(totalPagado)}</td>
              </tr>

              {/* AVANCE editable */}
              <tr className="text-rose-700 font-medium bg-rose-50/40">
                <td className="py-2 pr-2 text-left uppercase text-[10px] tracking-wider">Avance (pido ahora)</td>
                {conceptos.map((c) => {
                  const cc = calc.porConcepto.get(c.key)!;
                  return (
                    <Fragment key={c.key}>
                      <td className="py-2 px-2 border-l border-gray-200 text-left">
                        <span className="inline-flex items-center gap-0.5">
                          <input
                            type="number"
                            min={0}
                            max={100}
                            value={avance[c.key] ?? 0}
                            onChange={(e) => setPct(c.key, e.target.value)}
                            className="w-12 text-right tabular-nums border border-rose-300 rounded px-1 py-0.5 text-[11px] focus:ring-1 focus:ring-rose-500 focus:border-rose-500 outline-none"
                          />
                          <span className="text-[10px]">%</span>
                        </span>
                      </td>
                      <td colSpan={2} className="py-2 px-2 text-right tabular-nums">
                        {cc.aPedir > 0 ? formatCLP(cc.aPedir) : <span className="text-rose-300">—</span>}
                      </td>
                    </Fragment>
                  );
                })}
                <td className="py-2 pl-2 border-l border-gray-200 text-right tabular-nums">{formatCLP(calc.totalAPedir)}</td>
              </tr>

              {/* SALDO PENDIENTE (recalculado con el avance) */}
              <tr className="border-t border-gray-200 text-gray-900 font-medium">
                <td className="py-2 pr-2 text-left uppercase text-[10px] tracking-wider">Saldo pendiente</td>
                {conceptos.map((c) => {
                  const cc = calc.porConcepto.get(c.key)!;
                  return (
                    <td key={c.key} colSpan={3} className="py-2 px-2 border-l border-gray-200 text-right tabular-nums">
                      {cellMonto(cc.saldoNuevo)}
                    </td>
                  );
                })}
                <td className="py-2 pl-2 border-l border-gray-200 text-right tabular-nums">{formatCLP(calc.totalSaldoNuevo)}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="text-[11px] text-gray-400 mt-3">
          Avance total cobrado: {(avanceTotal * 100).toFixed(0)}% del acordado.
          {calc.totalAPedir > 0 && (
            <> Con este avance pedís <span className="text-rose-700 font-medium tabular-nums">{formatCLP(calc.totalAPedir)}</span> y el saldo queda en {formatCLP(calc.totalSaldoNuevo)}.</>
          )}
        </p>
      </div>

      {/* ── Me paso a Sueldos (INTERNO) ──────────────────────────────────── */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <div className="flex items-baseline justify-between mb-1">
          <h2 className="text-sm font-semibold text-gray-900 uppercase tracking-wider">Me paso a Sueldos</h2>
          <span className="text-xs text-gray-400">interno · no va al cliente · solo obra + muebles</span>
        </div>
        <table className="w-full text-sm mt-3">
          <thead className="text-[10px] uppercase tracking-wider text-gray-500 border-b border-gray-200">
            <tr>
              <th className="text-left pb-2">Concepto</th>
              <th className="text-right pb-2">Utilidad al 100%</th>
              <th className="text-right pb-2 w-24">% con el avance</th>
              <th className="text-right pb-2">Generado</th>
            </tr>
          </thead>
          <tbody>
            {sueldoConceptos.map((c) => {
              const cc = calc.porConcepto.get(c.key)!;
              return (
                <tr key={c.key} className="border-b border-gray-50">
                  <td className="py-2 text-gray-900">
                    {c.label}
                    {c.key === "obra" && <span className="text-[11px] text-gray-400 ml-1">· GG</span>}
                  </td>
                  <td className="py-2 text-right tabular-nums text-gray-600">{formatCLP(c.utilidad100)}</td>
                  <td className="py-2 text-right tabular-nums text-gray-400">{(cc.pctFinal * 100).toFixed(0)}%</td>
                  <td className="py-2 text-right tabular-nums font-medium text-emerald-800">{formatCLP(cc.generado)}</td>
                </tr>
              );
            })}
            <tr className="border-t border-gray-200 font-bold">
              <td className="py-2 uppercase tracking-wider text-xs text-gray-700" colSpan={3}>Generado total</td>
              <td className="py-2 text-right tabular-nums text-gray-900">{formatCLP(calc.generadoTotal)}</td>
            </tr>
          </tbody>
        </table>
        <div className="grid grid-cols-3 gap-3 mt-4">
          <Metric label="Generado" value={calc.generadoTotal} />
          <Metric label="Ya transferido" value={transferido} />
          <Metric label="A transferir ahora" value={calc.aTransferir} tone="ok" />
        </div>
        {calc.transferidoDeMas && (
          <p className="text-[11px] text-amber-700 mt-2">
            Ya te transferiste más de lo generado ({formatCLP(transferido)} vs {formatCLP(calc.generadoTotal)}).
            Te adelantaste {formatCLP(transferido - calc.generadoTotal)}.
          </p>
        )}
      </div>
    </div>
  );
}

function Metric({ label, value, tone = "default" }: { label: string; value: number; tone?: "default" | "ok" }) {
  return (
    <div className={`rounded-lg p-3 ${tone === "ok" ? "bg-emerald-50" : "bg-gray-50"}`}>
      <p className={`text-[10px] uppercase tracking-wider ${tone === "ok" ? "text-emerald-700" : "text-gray-500"}`}>{label}</p>
      <p className={`text-lg font-semibold tabular-nums mt-0.5 ${tone === "ok" ? "text-emerald-800" : "text-gray-900"}`}>{formatCLP(value)}</p>
    </div>
  );
}
