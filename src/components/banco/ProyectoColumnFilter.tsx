"use client";

import { useRouter, useSearchParams } from "next/navigation";

// Filtro por OBRA, EN EL ENCABEZADO de la columna "Respaldo" — el mismo patrón
// del filtro de imputación que está justo abajo (MJ prefiere el filtro en la
// columna antes que otra fila de pastillas arriba). Filtra por el proyecto
// marcado en el movimiento, que hoy solo llevan los traspasos
// Operativa→Sueldos: sirve para ver "los traspasos de tal obra" sin tener que
// leerlos uno por uno. Respeta la URL (?proyecto=…) como el resto de los
// filtros. Solo se ofrecen las obras que tienen al menos un traspaso.
export default function ProyectoColumnFilter({
  value,
  options,
}: {
  value: string;
  options: { id: string; name: string; numeroProyecto: number | null }[];
}) {
  const router = useRouter();
  const sp = useSearchParams();

  function onChange(next: string) {
    const params = new URLSearchParams(sp.toString());
    if (next) params.set("proyecto", next);
    else params.delete("proyecto");
    // Un cambio de filtro suelta el drill-down a un movimiento puntual.
    params.delete("id");
    const qs = params.toString();
    router.push(`/banco/movimientos${qs ? "?" + qs : ""}`);
  }

  if (options.length === 0) return null;

  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      title="Filtrar por obra (traspasos a Sueldos imputados a esa obra)"
      className={`mt-1 block w-full max-w-[150px] text-force-10 normal-case tracking-normal border rounded px-1 py-0.5 bg-white outline-none focus:ring-1 focus:ring-gray-900 focus:border-gray-900 cursor-pointer ${
        value ? "border-gray-400 text-gray-800 font-medium" : "border-gray-200 text-gray-500 font-normal"
      }`}
    >
      <option value="">Todas las obras</option>
      {options.map((p) => (
        <option key={p.id} value={p.id}>
          {p.numeroProyecto ? `${p.numeroProyecto} · ${p.name}` : p.name}
        </option>
      ))}
    </select>
  );
}
