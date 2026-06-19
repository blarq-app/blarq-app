"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

// Búsqueda por MONTO exacto para /banco/movimientos, visible al lado del
// buscador principal (antes vivía escondida dentro de "Filtros avanzados").
// MJ la usa seguido para conciliar, así que no tiene sentido obligarla a abrir
// el panel cada vez. Filtra server-side via ?monto= (match exacto contra el
// monto absoluto, signo + o −). Live: debounced a 300ms, igual que el buscador
// de texto. Solo dígitos.
export default function MovementsMontoSearch({
  defaultMonto,
  sp,
}: {
  defaultMonto: string;
  sp: Record<string, string | undefined>;
}) {
  const router = useRouter();
  const [value, setValue] = useState(defaultMonto);

  useEffect(() => {
    // Mismo guard que MovementsSearch: solo navegamos si MJ cambió el valor,
    // para no disparar un router.replace en el montaje que borre el drill-down
    // por `id`.
    if (value === defaultMonto) return;
    const t = setTimeout(() => {
      const params = new URLSearchParams();
      for (const [k, v] of Object.entries(sp)) {
        // `monto` lo seteamos abajo; `id` es un drill-down efímero que no se
        // arrastra al buscar.
        if (k !== "monto" && k !== "id" && v) params.set(k, v);
      }
      const digits = value.replace(/\D/g, "");
      if (digits) params.set("monto", digits);
      const qs = params.toString();
      router.replace(`/banco/movimientos${qs ? `?${qs}` : ""}`);
    }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  return (
    <div className="relative w-[160px]">
      <input
        type="text"
        inputMode="numeric"
        value={value}
        onChange={(e) => setValue(e.target.value.replace(/\D/g, ""))}
        placeholder="Monto exacto…"
        className="w-full px-3 py-1.5 pl-6 border border-gray-200 rounded-lg text-sm text-gray-900 tabular-nums text-right focus:outline-none focus:ring-2 focus:ring-gray-300"
      />
      <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 text-sm">
        $
      </span>
      {value && (
        <button
          onClick={() => setValue("")}
          className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-700 text-sm"
          aria-label="Limpiar monto"
        >
          ×
        </button>
      )}
    </div>
  );
}
