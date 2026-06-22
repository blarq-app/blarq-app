"use client";

import { useMemo, useState } from "react";
import { formatCLP } from "@/lib/utils";
import type { ConceptoCuadro } from "@/lib/projects/cuadroResumen";

// Calculadora "Armar el próximo avance + Me paso a Sueldos".
//
// Pieza 1 — Armar el avance: por concepto MJ pone el objetivo % al que quiere
// llevar el cobro; la app calcula cuánto pedirle al cliente (a pedir = objetivo%
// × acordado − ya pagado) y el nuevo saldo. Es el cuadro que le manda al cliente.
//
// Pieza 2 — Me paso a Sueldos: de los conceptos que generan sueldo (obra + muebles;
// artefactos no), generado = % alcanzado × utilidad al 100%. Se suma todo lo
// generado a la fecha y se le resta lo YA transferido a Sueldos (conciliado, del
// motor de transferencias internas) → cuánto traspasar ahora. Si ya transferiste
// de más, queda en $0 y se avisa.
//
// Calculadora en vivo: no persiste el "borrador" del avance — la verdad de la
// plata (cobros y transferencias) ya queda registrada por otro lado.
export default function AvanceSueldosCalculator({
  conceptos,
  transferido,
}: {
  conceptos: ConceptoCuadro[];
  transferido: number;
}) {
  if (conceptos.length === 0) return null;

  // Objetivo % por concepto. Arranca en el % ya cobrado (redondeado), así
  // "a pedir" empieza en 0 hasta que MJ sube la barra.
  const [targets, setTargets] = useState<Record<string, number>>(() =>
    Object.fromEntries(conceptos.map((c) => [c.key, Math.round(c.avancePct * 100)]))
  );

  const calc = useMemo(() => {
    const filas = conceptos.map((c) => {
      const target = targets[c.key] ?? Math.round(c.avancePct * 100);
      // A pedir: lo que falta para llegar al objetivo (nunca negativo).
      const objetivoMonto = (target / 100) * c.acordado;
      const aPedir = Math.max(0, objetivoMonto - c.pagado);
      const pagadoNuevo = c.pagado + aPedir;
      const saldoNuevo = c.acordado - pagadoNuevo;
      const pctNuevo = c.acordado > 0 ? pagadoNuevo / c.acordado : 0;
      const generado = c.generaSueldo ? pctNuevo * c.utilidad100 : 0;
      return { c, target, aPedir, saldoNuevo, pctNuevo, generado };
    });
    const totalAPedir = filas.reduce((s, f) => s + f.aPedir, 0);
    const totalSaldoNuevo = filas.reduce((s, f) => s + f.saldoNuevo, 0);
    const generadoTotal = filas.reduce((s, f) => s + f.generado, 0);
    const aTransferir = Math.max(0, generadoTotal - transferido);
    const transferidoDeMas = transferido - generadoTotal > 1000;
    return { filas, totalAPedir, totalSaldoNuevo, generadoTotal, aTransferir, transferidoDeMas };
  }, [conceptos, targets, transferido]);

  const sueldoFilas = calc.filas.filter((f) => f.c.generaSueldo);

  function setTarget(key: string, value: string) {
    const n = Math.max(0, Math.min(100, Math.round(Number(value) || 0)));
    setTargets((prev) => ({ ...prev, [key]: n }));
  }

  return (
    <div className="space-y-4 mb-8">
      {/* ── Pieza 1: Armar el avance ─────────────────────────────────────── */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <div className="flex items-baseline justify-between mb-1">
          <h2 className="text-sm font-semibold text-gray-900 uppercase tracking-wider">
            Armar el próximo avance
          </h2>
          <span className="text-xs text-gray-400">
            poné el objetivo %, calculo cuánto pedir
          </span>
        </div>
        <div className="overflow-x-auto mt-3">
          <table className="w-full text-sm">
            <thead className="text-[10px] uppercase tracking-wider text-gray-500 border-b border-gray-200">
              <tr>
                <th className="text-left pb-2">Concepto</th>
                <th className="text-right pb-2">Acordado</th>
                <th className="text-right pb-2">Ya pagado</th>
                <th className="text-center pb-2 w-24">Objetivo</th>
                <th className="text-right pb-2">A pedir</th>
                <th className="text-right pb-2">Saldo nuevo</th>
              </tr>
            </thead>
            <tbody>
              {calc.filas.map((f) => (
                <tr key={f.c.key} className="border-b border-gray-50">
                  <td className="py-2 text-gray-900">{f.c.label}</td>
                  <td className="py-2 text-right tabular-nums text-gray-600">
                    {formatCLP(f.c.acordado)}
                  </td>
                  <td className="py-2 text-right tabular-nums text-gray-400">
                    {(f.c.avancePct * 100).toFixed(0)}%
                  </td>
                  <td className="py-2 text-center">
                    <span className="inline-flex items-center gap-0.5">
                      <input
                        type="number"
                        min={0}
                        max={100}
                        value={f.target}
                        onChange={(e) => setTarget(f.c.key, e.target.value)}
                        className="w-14 text-right tabular-nums border border-gray-300 rounded px-1.5 py-0.5 text-sm focus:ring-1 focus:ring-gray-900 focus:border-gray-900 outline-none"
                      />
                      <span className="text-gray-400 text-xs">%</span>
                    </span>
                  </td>
                  <td className="py-2 text-right tabular-nums font-medium text-gray-900">
                    {f.aPedir > 0 ? formatCLP(f.aPedir) : <span className="text-gray-300">—</span>}
                  </td>
                  <td className="py-2 text-right tabular-nums text-gray-600">
                    {f.saldoNuevo > 0 ? formatCLP(f.saldoNuevo) : <span className="text-gray-300">$0</span>}
                  </td>
                </tr>
              ))}
              <tr className="border-t-2 border-gray-300 bg-gray-50 font-bold">
                <td className="py-2.5 uppercase tracking-wider text-xs text-gray-700" colSpan={4}>
                  Total a pedir al cliente
                </td>
                <td className="py-2.5 text-right tabular-nums text-gray-900 text-base">
                  {formatCLP(calc.totalAPedir)}
                </td>
                <td className="py-2.5 text-right tabular-nums text-gray-700">
                  {formatCLP(calc.totalSaldoNuevo)}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Pieza 2: Me paso a Sueldos ───────────────────────────────────── */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <div className="flex items-baseline justify-between mb-1">
          <h2 className="text-sm font-semibold text-gray-900 uppercase tracking-wider">
            Me paso a Sueldos
          </h2>
          <span className="text-xs text-gray-400">solo obra + muebles · artefactos no genera</span>
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
            {sueldoFilas.map((f) => (
              <tr key={f.c.key} className="border-b border-gray-50">
                <td className="py-2 text-gray-900">
                  {f.c.label}
                  {f.c.key === "obra" && <span className="text-[11px] text-gray-400 ml-1">· GG</span>}
                </td>
                <td className="py-2 text-right tabular-nums text-gray-600">
                  {formatCLP(f.c.utilidad100)}
                </td>
                <td className="py-2 text-right tabular-nums text-gray-400">
                  {(f.pctNuevo * 100).toFixed(0)}%
                </td>
                <td className="py-2 text-right tabular-nums font-medium text-emerald-800">
                  {formatCLP(f.generado)}
                </td>
              </tr>
            ))}
            <tr className="border-t border-gray-200 font-bold">
              <td className="py-2 uppercase tracking-wider text-xs text-gray-700" colSpan={3}>
                Generado total a la fecha
              </td>
              <td className="py-2 text-right tabular-nums text-gray-900">
                {formatCLP(calc.generadoTotal)}
              </td>
            </tr>
          </tbody>
        </table>

        <div className="grid grid-cols-3 gap-3 mt-4">
          <Metric label="Generado" value={calc.generadoTotal} />
          <Metric label="Ya transferido" value={transferido} />
          <Metric
            label="A transferir ahora"
            value={calc.aTransferir}
            tone="ok"
          />
        </div>
        {calc.transferidoDeMas && (
          <p className="text-[11px] text-amber-700 mt-2">
            Ya te transferiste más de lo generado a la fecha ({formatCLP(transferido)} vs{" "}
            {formatCLP(calc.generadoTotal)}). No hay nada que traspasar ahora; te adelantaste{" "}
            {formatCLP(transferido - calc.generadoTotal)}.
          </p>
        )}
      </div>
    </div>
  );
}

function Metric({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: number;
  tone?: "default" | "ok";
}) {
  return (
    <div
      className={`rounded-lg p-3 ${
        tone === "ok" ? "bg-emerald-50" : "bg-gray-50"
      }`}
    >
      <p
        className={`text-[10px] uppercase tracking-wider ${
          tone === "ok" ? "text-emerald-700" : "text-gray-500"
        }`}
      >
        {label}
      </p>
      <p
        className={`text-lg font-semibold tabular-nums mt-0.5 ${
          tone === "ok" ? "text-emerald-800" : "text-gray-900"
        }`}
      >
        {formatCLP(value)}
      </p>
    </div>
  );
}
