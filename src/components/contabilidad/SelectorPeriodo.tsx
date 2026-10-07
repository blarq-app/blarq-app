import Link from "next/link";
import { MESES_PERIODO, periodoParam, type Periodo } from "@/lib/contabilidad/periodo";

// Selector de año + mes + "año completo" de Contabilidad → Cartola y
// Rendiciones. Mismo patrón y ancho que el del F29 y Gastos: los meses sin
// datos van en gris, pero se pueden abrir igual.
export default function SelectorPeriodo({
  ruta,
  periodo,
  años,
  mesesConDatos,
}: {
  ruta: string; // "/contabilidad/cartola"
  periodo: Periodo;
  años: number[]; // de más nuevo a más viejo
  mesesConDatos: number[]; // 1..12 del año elegido
}) {
  const { year, month } = periodo;
  const href = (p: Periodo) => `${ruta}?periodo=${periodoParam(p)}`;
  return (
    <div className="max-w-3xl">
      <div className="flex items-center gap-2 mb-3">
        <span className="text-xs uppercase tracking-wider text-gray-400">Año</span>
        {años.map((y) => (
          <Link
            key={y}
            href={href({ year: y, month })}
            className={`px-2.5 py-1 rounded text-sm font-medium tabular-nums transition-colors ${
              y === year ? "bg-gray-900 text-white" : "text-gray-600 hover:bg-gray-100"
            }`}
          >
            {y}
          </Link>
        ))}
      </div>
      <div className="grid grid-cols-6 sm:grid-cols-12 gap-1 mb-2">
        {MESES_PERIODO.map((nombre, i) => {
          const m = i + 1;
          return (
            <Link
              key={m}
              href={href({ year, month: m })}
              className={`text-center py-1.5 rounded text-xs font-medium transition-colors ${
                m === month
                  ? "bg-gray-900 text-white"
                  : mesesConDatos.includes(m)
                    ? "text-gray-700 hover:bg-gray-100"
                    : "text-gray-300 hover:bg-gray-50"
              }`}
              title={nombre}
            >
              {nombre.slice(0, 3)}
            </Link>
          );
        })}
      </div>
      {/* El año completo: el mismo documento con todo el año. */}
      <Link
        href={href({ year, month: null })}
        className={`inline-block mb-6 px-3 py-1.5 rounded text-xs font-medium transition-colors ${
          month == null ? "bg-gray-900 text-white" : "text-gray-700 hover:bg-gray-100 border border-gray-200"
        }`}
      >
        Año {year} completo
      </Link>
    </div>
  );
}
