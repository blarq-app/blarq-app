"use client";

import { useRouter, useSearchParams } from "next/navigation";

// Filtro por tipo de imputación, EN EL ENCABEZADO de la columna "Imputación"
// (el patrón "filtro en la columna" que prefiere MJ — sin chips nuevos en la
// barra principal). Contextual: la tabla solo lo renderiza cuando la cuenta
// seleccionada es "Sueldos". Respeta la URL (querystring ?imputacion=…) como
// el resto de los filtros; al elegir una categoría la lista muestra solo esos
// movimientos.
export default function ImputacionColumnFilter({
  value,
  options,
}: {
  value: string;
  options: { value: string; label: string }[];
}) {
  const router = useRouter();
  const sp = useSearchParams();

  function onChange(next: string) {
    const params = new URLSearchParams(sp.toString());
    if (next) params.set("imputacion", next);
    else params.delete("imputacion");
    // Un cambio de filtro suelta el drill-down a un movimiento puntual.
    params.delete("id");
    const qs = params.toString();
    router.push(`/banco/movimientos${qs ? "?" + qs : ""}`);
  }

  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      title="Filtrar por tipo de imputación"
      className={`mt-1 block w-full max-w-[150px] text-[11px] normal-case tracking-normal border rounded px-1.5 py-1 bg-white outline-none focus:ring-1 focus:ring-gray-900 focus:border-gray-900 cursor-pointer ${
        value ? "border-gray-400 text-gray-800 font-medium" : "border-gray-200 text-gray-500 font-normal"
      }`}
    >
      <option value="">Todas</option>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}
