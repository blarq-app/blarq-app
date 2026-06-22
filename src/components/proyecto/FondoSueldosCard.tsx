import { formatCLP } from "@/lib/utils";
import type { FondoSueldosCalculo } from "@/lib/banco/fondoSueldos";

// Card que muestra el fondo sueldos generado por este proyecto:
//   - Cuánto representa al 100% (GG obra + utilidad muebles).
//   - Cuánto se generó hasta ahora según lo cobrado.
//   - Detalle por tipo (obra / muebles / artefactos).
//   - Cuánto ya se transfirió a la cuenta Sueldos y cuánto falta.
//
// Si el proyecto no tiene cobros aún, igual se muestra el "máximo posible"
// como referencia.
//
// `transferido` = suma NETA de las transferencias internas Operativa→Sueldos
// conciliadas a esta obra (las devoluciones ya vienen restadas). Lo calcula
// el server (resumen/page.tsx); la card solo lo muestra.
export default function FondoSueldosCard({
  fondo,
  transferido = 0,
}: {
  fondo: FondoSueldosCalculo;
  transferido?: number;
}) {
  // Si no hay nada presupuestado en obra ni muebles, no tiene sentido mostrar
  // la card.
  if (fondo.totalFondoMaximo <= 0) return null;

  // "Falta transferir" se mide contra el MÁXIMO de la obra (al 100%), no
  // contra lo generado hasta ahora — decisión de MJ (muestra el techo del
  // traspaso, no solo lo disponible hoy). Se clampa a 0: si ya transfirió
  // el total, no mostramos negativo.
  const faltaTransferir = Math.max(0, fondo.totalFondoMaximo - transferido);
  // Aviso de "te pagaste de más": se transfirió MÁS de lo que la obra generó
  // hasta ahora (lo realmente cobrado). Señal de traspaso adelantado. Tolerancia
  // de $1.000 para no saltar por redondeos.
  const transferidoDeMas = transferido - fondo.fondoGenerado > 1000;

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-6 mb-8">
      <div className="flex items-baseline justify-between mb-4">
        <h2 className="text-sm font-semibold text-gray-900 uppercase tracking-wider">
          Fondo Sueldos generado
          <span className="text-[10px] text-gray-400 normal-case ml-2">
            según GG obra + utilidad muebles
          </span>
        </h2>
        <span className="text-xs text-gray-500">
          al 100% del proyecto: <span className="font-medium text-gray-700 tabular-nums">{formatCLP(fondo.totalFondoMaximo)}</span>
        </span>
      </div>

      <table className="w-full text-sm">
        <thead className="text-[10px] uppercase tracking-wider text-gray-500 border-b border-gray-100">
          <tr>
            <th className="text-left pb-2 w-1/3">Tipo</th>
            <th className="text-right pb-2">Total a generar</th>
            <th className="text-right pb-2">Cobrado</th>
            <th className="text-right pb-2 w-20">% cobrado</th>
            <th className="text-right pb-2">Generado</th>
          </tr>
        </thead>
        <tbody>
          {/* Obra */}
          <tr className="border-b border-gray-50">
            <td className="py-2">
              <div className="font-medium text-gray-900">Obra</div>
              <div className="text-[11px] text-gray-400">
                GG {fondo.obraGGPercentage || ""}% del costo directo
              </div>
            </td>
            <td className="text-right tabular-nums text-gray-900">{formatCLP(fondo.obraGGTotal)}</td>
            <td className="text-right tabular-nums text-gray-700">{formatCLP(fondo.obraCobrado)}</td>
            <td className="text-right tabular-nums text-gray-600">
              {(fondo.pctCobradoObra * 100).toFixed(0)}%
            </td>
            <td className="text-right tabular-nums font-medium text-gray-900">
              {formatCLP(fondo.fondoObraGenerado)}
            </td>
          </tr>
          {/* Muebles */}
          <tr className="border-b border-gray-50">
            <td className="py-2">
              <div className="font-medium text-gray-900">Muebles</div>
              <div className="text-[11px] text-gray-400">utilidad neta por item</div>
            </td>
            <td className="text-right tabular-nums text-gray-900">{formatCLP(fondo.utilMueblesTotal)}</td>
            <td className="text-right tabular-nums text-gray-700">{formatCLP(fondo.mueblesCobrado)}</td>
            <td className="text-right tabular-nums text-gray-600">
              {(fondo.pctCobradoMuebles * 100).toFixed(0)}%
            </td>
            <td className="text-right tabular-nums font-medium text-gray-900">
              {formatCLP(fondo.fondoMueblesGenerado)}
            </td>
          </tr>
          {/* Artefactos (no aporta) */}
          {fondo.artefactosTotalAcordado > 0 && (
            <tr className="border-b border-gray-50 text-gray-400">
              <td className="py-2 text-xs">
                Artefactos
                <span className="ml-2 text-[10px]">no aporta — queda en empresa</span>
              </td>
              <td className="text-right tabular-nums">—</td>
              <td className="text-right tabular-nums">—</td>
              <td className="text-right tabular-nums">—</td>
              <td className="text-right tabular-nums">—</td>
            </tr>
          )}
          {/* Total */}
          <tr className="border-t-2 border-gray-300 bg-gray-50 font-bold">
            <td className="py-2.5 pl-0 uppercase tracking-wider text-xs text-gray-700">
              Total generado
            </td>
            <td className="text-right tabular-nums text-gray-700">
              {formatCLP(fondo.totalFondoMaximo)}
            </td>
            <td className="text-right tabular-nums text-gray-700">
              {formatCLP(fondo.obraCobrado + fondo.mueblesCobrado)}
            </td>
            <td></td>
            <td className="text-right tabular-nums text-gray-900 text-base">
              {formatCLP(fondo.fondoGenerado)}
            </td>
          </tr>
        </tbody>
      </table>

      {/* Traspaso a la cuenta Sueldos: cuánto ya me transferí de esta obra y
          cuánto falta (contra el máximo). Es lo que MJ concilia a mano en
          /banco/movimientos sobre las transferencias internas. */}
      <div className="mt-4 pt-4 border-t border-gray-100 grid grid-cols-2 gap-4">
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
              ({formatCLP(fondo.fondoGenerado)}). Traspaso adelantado.
            </p>
          )}
        </div>
        <div className="text-right">
          <p className="text-[10px] uppercase tracking-wider text-gray-500">
            Falta transferir
            <span className="normal-case text-gray-400 ml-1">(al 100%)</span>
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

      <p className="text-[11px] text-gray-400 mt-3">
        Para que cuente como cobrado, las facturas emitidas deben estar marcadas
        como pagadas (la conciliación bancaria lo hace automático). Las
        facturas con concepto distinto a obra/muebles no aportan al fondo.
      </p>
    </div>
  );
}
