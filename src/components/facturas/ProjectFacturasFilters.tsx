"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

// Filtros tipo Excel para la tabla de facturas DEL proyecto.
// Cada cambio se sincroniza a la URL como search params (el page.tsx
// es server component y vuelve a renderizar con el filtro aplicado).
//
// Para que la búsqueda libre no haga roundtrip en cada tecla, se aplica
// debounced (300ms) o al apretar Enter / blur.

export type FilterValues = {
  q: string;
  status: string;
  origin: string;
  category: string;
  dateFrom: string;
  dateTo: string;
};

export default function ProjectFacturasFilters({
  basePath,
  categories,
  initial,
}: {
  basePath: string; // ej: "/proyectos/abc/facturas"
  // Lista de categorías presentes en las facturas del proyecto, para
  // poblar el select de Categoría
  categories: string[];
  initial: FilterValues;
}) {
  const router = useRouter();
  const sp = useSearchParams();
  const [v, setV] = useState<FilterValues>(initial);

  // Sincroniza el state si cambian los searchParams desde fuera
  useEffect(() => {
    setV(initial);
  }, [initial]);

  function pushUrl(next: FilterValues) {
    const params = new URLSearchParams(sp.toString());
    (["q", "status", "origin", "category", "dateFrom", "dateTo"] as const).forEach((k) => {
      if (next[k]) params.set(k, next[k]);
      else params.delete(k);
    });
    router.push(`${basePath}${params.toString() ? "?" + params.toString() : ""}`);
  }

  function set<K extends keyof FilterValues>(key: K, value: FilterValues[K]) {
    const next = { ...v, [key]: value };
    setV(next);
    pushUrl(next);
  }

  // Búsqueda libre con debounce
  function setQ(value: string) {
    setV({ ...v, q: value });
  }
  function commitQ() {
    pushUrl(v);
  }

  const hasAnyFilter =
    v.q || v.status || v.origin || v.category || v.dateFrom || v.dateTo;

  return (
    <div className="bg-gray-50 border border-gray-200 rounded-lg p-3 mb-3 flex flex-wrap items-center gap-2 text-sm">
      {/* Búsqueda libre */}
      <input
        type="text"
        placeholder="Buscar folio, proveedor, RUT…"
        value={v.q}
        onChange={(e) => setQ(e.target.value)}
        onBlur={commitQ}
        onKeyDown={(e) => {
          if (e.key === "Enter") commitQ();
        }}
        className="flex-1 min-w-[200px] px-3 py-1.5 border border-gray-300 rounded bg-white focus:ring-1 focus:ring-gray-900 focus:border-gray-900 outline-none"
      />

      {/* Categoría */}
      <select
        value={v.category}
        onChange={(e) => set("category", e.target.value)}
        className="px-2 py-1.5 border border-gray-300 rounded bg-white text-sm"
      >
        <option value="">Todas las categorías</option>
        {categories.map((c) => (
          <option key={c} value={c}>
            {c}
          </option>
        ))}
      </select>

      {/* Estado */}
      <select
        value={v.status}
        onChange={(e) => set("status", e.target.value)}
        className="px-2 py-1.5 border border-gray-300 rounded bg-white text-sm"
      >
        <option value="">Cualquier estado</option>
        <option value="pendiente">Pendiente</option>
        <option value="pagada">Pagada</option>
        <option value="anulada">Anulada</option>
      </select>

      {/* Origen */}
      <select
        value={v.origin}
        onChange={(e) => set("origin", e.target.value)}
        className="px-2 py-1.5 border border-gray-300 rounded bg-white text-sm"
      >
        <option value="">Cualquier origen</option>
        <option value="sii_automatica">SII</option>
        <option value="manual">Manual</option>
      </select>

      {/* Rango de fechas */}
      <div className="flex items-center gap-1">
        <span className="text-xs text-gray-500">Desde</span>
        <input
          type="date"
          value={v.dateFrom}
          onChange={(e) => set("dateFrom", e.target.value)}
          className="px-2 py-1.5 border border-gray-300 rounded bg-white text-xs"
        />
        <span className="text-xs text-gray-500">hasta</span>
        <input
          type="date"
          value={v.dateTo}
          onChange={(e) => set("dateTo", e.target.value)}
          className="px-2 py-1.5 border border-gray-300 rounded bg-white text-xs"
        />
      </div>

      {hasAnyFilter && (
        <button
          type="button"
          onClick={() =>
            pushUrl({ q: "", status: "", origin: "", category: "", dateFrom: "", dateTo: "" })
          }
          className="text-xs text-gray-600 hover:text-gray-900 underline ml-auto"
        >
          Limpiar filtros
        </button>
      )}
    </div>
  );
}
