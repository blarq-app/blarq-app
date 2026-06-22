import { formatCLP } from "@/lib/utils";
import type { FormaPagoFondo } from "@/lib/banco/formaPagoFondo";

// Tarjeta del Fondo Sueldos, vista como FORMA DE PAGO (rediseño 2026-06-22).
//   - Resumen por tipo: costo directo + "utilidad a generar" (= GG obra /
//     utilidad muebles), destacada.
//   - Desglose por la forma de pago del cliente (anticipo/avances/saldo del
//     presupuesto aprobado): monto a cobrar + utilidad que genera cada tramo,
//     marcado cobrado / parcial / pendiente según lo realmente cobrado.
//   - Pie: ya transferido a sueldos + falta transferir (vs el 100%).
//
// `transferido` = suma NETA de las transferencias internas Operativa→Sueldos
// conciliadas a esta obra (lo calcula el server; las devoluciones ya vienen
// restadas).
export default function FondoSueldosCard({
  forma,
  transferido = 0,
}: {
  forma: FormaPagoFondo;
  transferido?: number;
}) {
  const total = forma.totalUtilidadAGenerar;
  // Si no hay nada que generar (sin obra ni muebles presupuestados), no mostramos.
  if (total <= 0) return null;

  // "Falta transferir" se mide contra el máximo (100%), decisión de MJ. Clamp a 0.
  const faltaTransferir = Math.max(0, total - transferido);
  // Aviso: se transfirió más de lo generado hasta ahora (traspaso adelantado).
  const transferidoDeMas = transferido - forma.generadoHastaAhora > 1000;

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-6 mb-8">
      <div className="flex items-baseline justify-between mb-4">
        <h2 className="text-sm font-semibold text-gray-900 uppercase tracking-wider">
          Fondo Sueldos a generar
          <span className="text-[10px] text-gray-400 normal-case ml-2">
            GG obra + utilidad muebles
          </span>
        </h2>
        <span className="text-xs text-gray-500">
          al 100% del proyecto:{" "}
          <span className="font-medium text-gray-700 tabular-nums">{formatCLP(total)}</span>
        </span>
      </div>

      {/* Resumen por tipo: costo directo + utilidad a generar */}
      <table className="w-full text-sm">
        <thead className="text-[10px] uppercase tracking-wider text-gray-500 border-b border-gray-100">
          <tr>
            <th className="text-left pb-2 w-1/2">Tipo</th>
            <th className="text-right pb-2">Costo directo</th>
            <th className="text-right pb-2">Utilidad a generar</th>
          </tr>
        </thead>
        <tbody>
          <tr className="border-b border-gray-50">
            <td className="py-2">
              <div className="font-medium text-gray-900">Obra</div>
              <div className="text-[11px] text-gray-400">
                GG {forma.obraGGPercentage || ""}% del costo directo
              </div>
            </td>
            <td className="text-right tabular-nums text-gray-600">{formatCLP(forma.obraCD)}</td>
            <td className="text-right">
              <span className="inline-block tabular-nums font-medium text-emerald-800 bg-emerald-50 px-2 py-0.5 rounded">
                {formatCLP(forma.obraGGTotal)}
              </span>
            </td>
          </tr>
          {forma.mueblesUtil > 0 && (
            <tr className="border-b border-gray-50">
              <td className="py-2">
                <div className="font-medium text-gray-900">Muebles</div>
                <div className="text-[11px] text-gray-400">utilidad neta por ítem</div>
              </td>
              <td className="text-right tabular-nums text-gray-600">{formatCLP(forma.mueblesCD)}</td>
              <td className="text-right">
                <span className="inline-block tabular-nums font-medium text-emerald-800 bg-emerald-50 px-2 py-0.5 rounded">
                  {formatCLP(forma.mueblesUtil)}
                </span>
              </td>
            </tr>
          )}
          {forma.artefactosPresente && (
            <tr className="border-b border-gray-50 text-gray-400">
              <td className="py-2 text-xs">
                Artefactos
                <span className="ml-2 text-[10px]">no aporta — queda en empresa</span>
              </td>
              <td className="text-right tabular-nums">—</td>
              <td className="text-right tabular-nums">—</td>
            </tr>
          )}
          <tr className="border-t-2 border-gray-300 bg-gray-50 font-bold">
            <td className="py-2.5 pl-0 uppercase tracking-wider text-xs text-gray-700">
              Total a generar
            </td>
            <td></td>
            <td className="text-right tabular-nums text-gray-900 text-base">{formatCLP(total)}</td>
          </tr>
        </tbody>
      </table>

      {/* Desglose por forma de pago del cliente (obra) */}
      {forma.hayFormaPago && (
        <div className="mt-6">
          <div className="flex items-baseline justify-between mb-1">
            <h3 className="text-[11px] font-semibold uppercase tracking-wider text-gray-600">
              Forma de pago del cliente · Obra
            </h3>
            {!forma.tramosDesdeAprobada && (
              <span className="text-[10px] text-amber-700">
                forma de pago tomada de otra versión (la aprobada no la tiene cargada)
              </span>
            )}
          </div>
          <p className="text-[11px] text-gray-400 mb-2">
            a medida que cobrás cada tramo, generás esta utilidad
          </p>
          <table className="w-full text-sm">
            <thead className="text-[10px] uppercase tracking-wider text-gray-500 border-b border-gray-100">
              <tr>
                <th className="text-left pb-2">Tramo</th>
                <th className="text-right pb-2 w-12">%</th>
                <th className="text-right pb-2">Monto a cobrar</th>
                <th className="text-right pb-2">Utilidad que genera</th>
                <th className="text-right pb-2 w-24">Estado</th>
              </tr>
            </thead>
            <tbody>
              {forma.tramos.map((t) => (
                <tr key={t.stage} className="border-b border-gray-50">
                  <td className="py-2 text-gray-900">{t.label}</td>
                  <td className="text-right tabular-nums text-gray-500">{t.percentage}%</td>
                  <td className="text-right tabular-nums text-gray-600">
                    {formatCLP(t.montoACobrar)}
                  </td>
                  <td className="text-right tabular-nums font-medium text-emerald-800">
                    {formatCLP(t.utilidadGenera)}
                  </td>
                  <td className="text-right">
                    <EstadoTramo estado={t.estado} />
                  </td>
                </tr>
              ))}
              <tr className="border-t border-gray-200 font-bold">
                <td className="py-2 text-gray-700">Total</td>
                <td className="text-right tabular-nums text-gray-700">100%</td>
                <td className="text-right tabular-nums text-gray-700">
                  {formatCLP(forma.obraTotalAcordado)}
                </td>
                <td className="text-right tabular-nums text-gray-900">
                  {formatCLP(forma.obraGGTotal)}
                </td>
                <td></td>
              </tr>
            </tbody>
          </table>
        </div>
      )}

      {/* Pie: ya transferido / falta */}
      <div className="mt-6 pt-4 border-t border-gray-100 grid grid-cols-2 gap-4">
        <div>
          <p className="text-[10px] uppercase tracking-wider text-gray-500">
            Ya transferido a sueldos
          </p>
          <p className="text-base font-semibold tabular-nums text-gray-900 mt-0.5">
            {formatCLP(transferido)}
          </p>
          {transferidoDeMas && (
            <p className="text-[11px] text-amber-700 mt-1">
              Te transferiste más de lo que esta obra generó hasta ahora
              ({formatCLP(forma.generadoHastaAhora)}). Traspaso adelantado.
            </p>
          )}
        </div>
        <div className="text-right">
          <p className="text-[10px] uppercase tracking-wider text-gray-500">
            Falta transferir <span className="normal-case text-gray-400 ml-1">(al 100%)</span>
          </p>
          <p
            className={`text-base font-semibold tabular-nums mt-0.5 ${
              faltaTransferir > 0 ? "text-gray-900" : "text-gray-300"
            }`}
          >
            {formatCLP(faltaTransferir)}
          </p>
        </div>
      </div>
    </div>
  );
}

function EstadoTramo({ estado }: { estado: "cobrado" | "parcial" | "pendiente" }) {
  if (estado === "cobrado") {
    return (
      <span className="text-[10px] uppercase tracking-wide bg-green-100 text-green-800 px-1.5 py-0.5 rounded">
        cobrado
      </span>
    );
  }
  if (estado === "parcial") {
    return (
      <span className="text-[10px] uppercase tracking-wide bg-amber-100 text-amber-800 px-1.5 py-0.5 rounded">
        parcial
      </span>
    );
  }
  return <span className="text-[10px] uppercase tracking-wide text-gray-300">pendiente</span>;
}
