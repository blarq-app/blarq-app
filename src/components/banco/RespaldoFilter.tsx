"use client";

import { useRouter, useSearchParams } from "next/navigation";

// Filtro por "Respaldo" (naturaleza / documento del movimiento) para la barra
// de /banco/movimientos. Reemplaza los estados "Sin factura / Transfer interna
// / Neto cero" que antes vivían en las pestañas de Estado, y agrega el filtro
// por documento (factura / boleta / internacional / pago sin respaldo). Respeta
// la URL (?respaldo=…) como el resto de los filtros.
const OPCIONES: { value: string; label: string }[] = [
  { value: "", label: "Todos" },
  { value: "factura", label: "Factura" },
  { value: "boleta", label: "Boleta" },
  { value: "internacional", label: "Internacional" },
  { value: "sin_respaldo", label: "Pago sin respaldo" },
  { value: "gasto_propio", label: "Gasto propio (sueldo, retiro…)" },
  { value: "interna", label: "Interna" },
  { value: "devolucion", label: "Devolución (neto cero)" },
];

export default function RespaldoFilter({ value }: { value: string }) {
  const router = useRouter();
  const sp = useSearchParams();

  function onChange(next: string) {
    const params = new URLSearchParams(sp.toString());
    if (next) params.set("respaldo", next);
    else params.delete("respaldo");
    // Un cambio de filtro suelta el drill-down a un movimiento puntual.
    params.delete("id");
    const qs = params.toString();
    router.push(`/banco/movimientos${qs ? "?" + qs : ""}`);
  }

  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      title="Filtrar por respaldo (factura, boleta, pago sin respaldo…)"
      className={`text-xs border rounded-lg px-2.5 py-1.5 bg-white outline-none focus:ring-1 focus:ring-gray-900 focus:border-gray-900 cursor-pointer ${
        value
          ? "border-gray-400 text-gray-900 font-medium"
          : "border-gray-200 text-gray-600"
      }`}
    >
      {OPCIONES.map((o) => (
        <option key={o.value} value={o.value}>
          {o.value === "" ? "Respaldo: todos" : o.label}
        </option>
      ))}
    </select>
  );
}
