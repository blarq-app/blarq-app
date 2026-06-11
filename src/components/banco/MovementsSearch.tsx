"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

// Input de búsqueda libre para /banco/movimientos. Filtra server-side via
// query param ?q= (descripción + nombre contraparte + RUT contraparte).
// Live: debounced a 300ms para no bombardear navegaciones.
export default function MovementsSearch({
  defaultQ,
  sp,
}: {
  defaultQ: string;
  sp: Record<string, string | undefined>;
}) {
  const router = useRouter();
  const [value, setValue] = useState(defaultQ);

  useEffect(() => {
    // Solo navegamos cuando MJ realmente cambió el texto. Sin este guard, el
    // efecto disparaba un router.replace en el primer render (al montar) que
    // borraba el `id` del drill-down (link "ver" de un pago) y "rebotaba" a la
    // lista completa a los 300ms. Comparar contra el valor inicial (defaultQ,
    // que viene del ?q= de la URL) es no-op cuando no hubo cambio y aguanta el
    // doble montaje de React en dev (a diferencia de un flag de "primer render").
    if (value === defaultQ) return;
    const t = setTimeout(() => {
      const params = new URLSearchParams();
      for (const [k, v] of Object.entries(sp)) {
        // `id` es un drill-down efímero (ver un movimiento puntual): al buscar
        // se vuelve a la navegación normal, no se arrastra.
        if (k !== "q" && k !== "id" && v) params.set(k, v);
      }
      const trimmed = value.trim();
      if (trimmed) params.set("q", trimmed);
      const qs = params.toString();
      router.replace(`/banco/movimientos${qs ? `?${qs}` : ""}`);
    }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  return (
    <div className="flex-1 min-w-[240px] max-w-[420px] relative">
      <input
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Buscar descripción, nombre o RUT…"
        className="w-full px-3 py-1.5 pl-8 border border-gray-200 rounded-lg text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-gray-300"
      />
      <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 text-xs">
        ⌕
      </span>
      {value && (
        <button
          onClick={() => setValue("")}
          className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-700 text-sm"
          aria-label="Limpiar búsqueda"
        >
          ×
        </button>
      )}
    </div>
  );
}
