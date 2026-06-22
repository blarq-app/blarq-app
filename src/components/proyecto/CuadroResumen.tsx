/**
 * Cuadro Resumen del proyecto — réplica del cuadro Excel que MJ lleva
 * a mano. Por cada concepto (OBRA / ART. COCINA / ART. SANITARIOS /
 * ART. ILUMINACIÓN / MUEBLES) muestra el monto firmado en la versión
 * vigente del presupuesto y, debajo, cada pago (transferencia bancaria
 * conciliada con factura emitida) con su fecha y N° de folio. Cierra con
 * TOTAL PAGOS, AVANCE y SALDO PENDIENTE.
 *
 * El CÁLCULO (acordado/pagos/avance/saldo por concepto, columnas dinámicas,
 * split de artefactos) vive en `src/lib/projects/cuadroResumen.ts`
 * (`computeCuadroResumen`) — fuente única que comparte con la calculadora
 * "Armar avance + Me paso a Sueldos". Este componente solo renderiza.
 */

import { Fragment } from "react";
import { formatCLP } from "@/lib/utils";
import type { CuadroResumenData } from "@/lib/projects/cuadroResumen";

function fmtDate(d: Date): string {
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yy = String(d.getFullYear()).slice(2);
  return `${dd}-${mm}-${yy}`;
}

export default function CuadroResumen({ data }: { data: CuadroResumenData }) {
  const { conceptos, pagos, totalAcordado, totalPagado, saldoTotal, avanceTotal, versionLabel } =
    data;

  // Si no hay nada que mostrar, no rendereamos el bloque.
  if (conceptos.length === 0 && pagos.length === 0) return null;

  const cellMonto = (v: number) =>
    v > 0 ? (
      <span className="tabular-nums">{formatCLP(v)}</span>
    ) : (
      <span className="text-gray-300">—</span>
    );

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-6 mb-8">
      <h2 className="text-lg font-semibold text-gray-900 mb-1">Cuadro Resumen</h2>
      <p className="text-xs text-gray-500 mb-4">
        Acordado por concepto y transferencias conciliadas con facturas emitidas.
        Las columnas son las del presupuesto entregado al cliente. Para artefactos
        el monto se reparte cocina/sanitarios/iluminación proporcional al
        presupuesto vigente.
      </p>
      <div className="overflow-x-auto">
        <table className="w-full text-xs border-collapse">
          <thead>
            <tr className="text-[10px] uppercase tracking-wider text-gray-500">
              <th className="pb-1 pr-2 text-left"></th>
              {conceptos.map((c) => (
                <th
                  key={c.key}
                  colSpan={3}
                  className="pb-1 px-2 text-center border-l border-gray-200 font-semibold text-gray-700"
                >
                  {c.label}
                </th>
              ))}
              <th className="pb-1 pl-2 text-right border-l border-gray-200 font-semibold text-gray-700">
                Total
              </th>
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
            {/* Fila versión: monto firmado por concepto */}
            <tr className="bg-gray-50 border-b border-gray-200 font-semibold text-gray-900">
              <td className="py-2 pr-2 text-left">{versionLabel}</td>
              {conceptos.map((c) => (
                <Fragment key={c.key}>
                  <td className="py-2 px-2 border-l border-gray-200 text-left text-gray-600 font-normal">
                    {c.fecha}
                  </td>
                  <td className="py-2 px-2 text-right tabular-nums">{cellMonto(c.acordado)}</td>
                  <td className="py-2 px-2"></td>
                </Fragment>
              ))}
              <td className="py-2 pl-2 border-l border-gray-200 text-right tabular-nums">
                {formatCLP(totalAcordado)}
              </td>
            </tr>

            {/* Filas de pagos */}
            {pagos.map((r, i) => (
              <tr key={i} className="border-b border-gray-50 text-gray-700">
                <td className="py-1.5 pr-2"></td>
                {conceptos.map((c) => {
                  const v = r.porConcepto[c.key];
                  return (
                    <Fragment key={c.key}>
                      <td className="py-1.5 px-2 border-l border-gray-100 text-left">
                        {v ? fmtDate(r.date) : ""}
                      </td>
                      <td className="py-1.5 px-2 text-right">{cellMonto(v)}</td>
                      <td className="py-1.5 px-2 text-right text-gray-500">
                        {v && r.folioNumber ? r.folioNumber : ""}
                      </td>
                    </Fragment>
                  );
                })}
                <td className="py-1.5 pl-2 border-l border-gray-200"></td>
              </tr>
            ))}

            {/* TOTAL PAGOS */}
            <tr className="border-t-2 border-gray-300 bg-gray-50 font-semibold text-gray-900">
              <td className="py-2 pr-2 text-left uppercase text-[10px] tracking-wider">
                Total pagos
              </td>
              {conceptos.map((c) => (
                <Fragment key={c.key}>
                  <td className="py-2 px-2 border-l border-gray-200 text-left text-gray-500 font-normal">
                    {(c.avancePct * 100).toFixed(0)}%
                  </td>
                  <td colSpan={2} className="py-2 px-2 text-right tabular-nums">
                    {cellMonto(c.pagado)}
                  </td>
                </Fragment>
              ))}
              <td className="py-2 pl-2 border-l border-gray-200 text-right tabular-nums">
                {formatCLP(totalPagado)}
              </td>
            </tr>
            {/* AVANCE total monetario (lo cobrado sobre el acordado) */}
            <tr className="text-gray-600">
              <td className="py-1.5 pr-2 text-left uppercase text-[10px] tracking-wider">
                Avance total
              </td>
              <td
                colSpan={conceptos.length * 3}
                className="py-1.5 px-2 border-l border-gray-200 text-right text-gray-500 tabular-nums"
              >
                {(avanceTotal * 100).toFixed(0)}% del acordado
              </td>
              <td className="py-1.5 pl-2 border-l border-gray-200 text-right tabular-nums">
                {formatCLP(totalPagado)}
              </td>
            </tr>
            {/* SALDO PENDIENTE */}
            <tr className="border-t border-gray-200 text-gray-900 font-medium">
              <td className="py-2 pr-2 text-left uppercase text-[10px] tracking-wider">
                Saldo pendiente
              </td>
              {conceptos.map((c) => (
                <td
                  key={c.key}
                  colSpan={3}
                  className="py-2 px-2 border-l border-gray-200 text-right tabular-nums"
                >
                  {cellMonto(c.saldo)}
                </td>
              ))}
              <td className="py-2 pl-2 border-l border-gray-200 text-right tabular-nums">
                {formatCLP(saldoTotal)}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
