"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { formatCLP } from "@/lib/utils";
import type { UtilidadPorCobro } from "@/lib/banco/utilidadPorCobro";

// Card INTERNA (no para el cliente): muestra, por cada cobro al cliente,
// cuánta utilidad se reconoce para Sueldos y cuánto conviene transferir.
// En cada fila hay un desplegable para etiquetar el CONCEPTO del cobro
// (obra/muebles/artefactos), que es lo que define cómo se reparte la utilidad.
//
// Distinto del "Fondo Sueldos" (que da el acumulado) y del "Cuadro Resumen"
// (que es para el cliente). Esto es el desglose cobro a cobro, solo nuestro.

const CONCEPTOS = [
  { value: "obra", label: "Obra" },
  { value: "muebles", label: "Muebles" },
  { value: "artefactos", label: "Artefactos" },
  { value: "mixto", label: "Mixto" },
];

export default function UtilidadPorCobroCard({ data }: { data: UtilidadPorCobro }) {
  const router = useRouter();
  const [savingId, setSavingId] = React.useState<string | null>(null);

  // Si no hay nada de utilidad posible (ni obra ni muebles presupuestados),
  // no mostramos la card.
  if (data.obraGGTotal <= 0 && data.utilMueblesEstimadaTotal <= 0) return null;

  async function setConcepto(invoiceId: string, concepto: string) {
    setSavingId(invoiceId);
    try {
      const res = await fetch(`/api/facturas/${invoiceId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conceptoCobro: concepto }),
      });
      if (!res.ok) throw new Error("No se pudo guardar el concepto");
      router.refresh();
    } catch (e) {
      console.error(e);
      alert("No se pudo guardar el concepto del cobro.");
    } finally {
      setSavingId(null);
    }
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-6 mb-8">
      <div className="flex items-baseline justify-between mb-1">
        <h2 className="text-sm font-semibold text-gray-900 uppercase tracking-wider">
          Utilidad por cobro
        </h2>
        <span className="text-[10px] text-gray-400 normal-case">
          interno · no va al cliente
        </span>
      </div>
      <p className="text-[11px] text-gray-400 mb-4">
        De cada cobro, cuánto es utilidad que te corresponde traspasar a Sueldos.
        Obra = GG declarado · Muebles = utilidad estimada (real al cerrar el
        proyecto) · Artefactos = no aporta.
      </p>

      {data.cobros.length === 0 ? (
        <p className="text-sm text-gray-400 py-4">
          Todavía no hay cobros conciliados en este proyecto.
        </p>
      ) : (
        <table className="w-full text-sm">
          <thead className="text-[10px] uppercase tracking-wider text-gray-500 border-b border-gray-100">
            <tr>
              <th className="text-left pb-2">Fecha</th>
              <th className="text-left pb-2">Folio</th>
              <th className="text-left pb-2">Concepto</th>
              <th className="text-right pb-2">Cobrado</th>
              <th className="text-right pb-2">Utilidad</th>
              <th className="text-right pb-2">Transferir</th>
            </tr>
          </thead>
          <tbody>
            {data.cobros.map((c) => (
              <tr key={c.invoiceId} className="border-b border-gray-50">
                <td className="py-2 text-gray-600 tabular-nums whitespace-nowrap">
                  {c.fecha.toISOString().slice(0, 10)}
                </td>
                <td className="py-2 text-gray-500 tabular-nums">
                  {c.folio ?? "—"}
                  {c.esNotaCredito && (
                    <span className="ml-1 text-[10px] text-gray-400">NC</span>
                  )}
                </td>
                <td className="py-2">
                  <select
                    value={c.concepto}
                    disabled={savingId === c.invoiceId}
                    onChange={(e) => setConcepto(c.invoiceId, e.target.value)}
                    className="text-xs border border-gray-200 rounded px-1.5 py-0.5 bg-white text-gray-700 disabled:opacity-50"
                  >
                    {/* Si el valor actual no es uno de los conocidos (ej. null
                        guardado como "obra" por default), igual lo mostramos. */}
                    {!CONCEPTOS.some((o) => o.value === c.concepto) && (
                      <option value={c.concepto}>{c.concepto}</option>
                    )}
                    {CONCEPTOS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="text-right py-2 tabular-nums text-gray-700">
                  {formatCLP(c.cobradoCIVA)}
                </td>
                <td className="text-right py-2 tabular-nums text-gray-900">
                  {c.utilidad !== 0 ? formatCLP(c.utilidad) : <span className="text-gray-300">—</span>}
                </td>
                <td className="text-right py-2 tabular-nums font-medium text-gray-900">
                  {c.sugerenciaTraspaso !== 0 ? formatCLP(c.sugerenciaTraspaso) : <span className="text-gray-300">—</span>}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-gray-300 bg-gray-50 font-bold">
              <td colSpan={4} className="py-2.5 uppercase tracking-wider text-xs text-gray-700">
                Total a tener en Sueldos por este proyecto
              </td>
              <td></td>
              <td className="text-right py-2.5 tabular-nums text-gray-900 text-base">
                {formatCLP(data.utilidadTotalReconocida)}
              </td>
            </tr>
          </tfoot>
        </table>
      )}

      {/* Cierre de muebles: utilidad real al terminar el proyecto */}
      {data.proyectoTerminado && data.utilidadMueblesReal !== null && (
        <div className="mt-4 rounded-lg bg-gray-50 border border-gray-100 p-3 text-xs text-gray-600">
          <div className="font-semibold text-gray-700 mb-1">
            Cierre de muebles (proyecto terminado)
          </div>
          <div className="flex justify-between"><span>Cobrado neto muebles</span><span className="tabular-nums">{formatCLP(data.mueblesCobradoNeto ?? 0)}</span></div>
          <div className="flex justify-between"><span>Gastado neto muebles</span><span className="tabular-nums">{formatCLP(data.mueblesGastadoNeto ?? 0)}</span></div>
          <div className="flex justify-between font-medium text-gray-800"><span>Utilidad real</span><span className="tabular-nums">{formatCLP(data.utilidadMueblesReal)}</span></div>
          <div className="flex justify-between mt-1 pt-1 border-t border-gray-200">
            <span>Ajuste final (real − ya reconocido)</span>
            <span className="tabular-nums">{formatCLP(data.ajusteFinalMuebles ?? 0)}</span>
          </div>
        </div>
      )}

      {/* Alerta de sobre-cobro */}
      {(data.sobreCobroObra || data.sobreCobroMuebles) && (
        <p className="text-[11px] text-amber-700 mt-3">
          Atención: cobraste más {data.sobreCobroObra ? "obra" : "muebles"} que
          el presupuesto aprobado. La utilidad quedó topada al máximo. Revisá si
          faltan cargar adicionales o si hay cobros mal etiquetados arriba.
        </p>
      )}
    </div>
  );
}
