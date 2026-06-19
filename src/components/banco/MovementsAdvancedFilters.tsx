"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// Panel de filtros avanzado para /banco/movimientos. Estilo Maxxa: oculto
// por defecto, se expande al click en "Filtros". Los inputs se aplican
// recién al apretar "Buscar" (no live), para que MJ pueda armar la búsqueda
// sin que la tabla se mueva en cada tecla. "Limpiar" borra solo los
// filtros avanzados y deja intactos cuenta / status / búsqueda libre.

// Nota: el filtro por monto exacto ya NO vive acá — se subió a la barra de
// búsqueda visible (MovementsMontoSearch), porque MJ lo usa seguido para
// conciliar y no quería abrir este panel cada vez. El param ?monto= lo maneja
// ese componente; acá se conserva (preserveParams) pero no se edita.
export type AdvancedFiltersValue = {
  rut: string;
  name: string;
  desc: string;
  dateFrom: string;
  dateTo: string;
  estado: string; // "" | "sin_asignar" | "parcial" | "conciliado" | "sin_factura"
  tipo: string; // "" | "ingreso" | "egreso" | "interno"
  limit: string; // "100" | "200" | "500" | "all"
};

const EMPTY: AdvancedFiltersValue = {
  rut: "",
  name: "",
  desc: "",
  dateFrom: "",
  dateTo: "",
  estado: "",
  tipo: "",
  limit: "",
};

export default function MovementsAdvancedFilters({
  initial,
  preserveParams,
}: {
  initial: AdvancedFiltersValue;
  // Params a conservar al navegar (cuenta, status, búsqueda libre, etc).
  preserveParams: Record<string, string | undefined>;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(
    // Auto-abre si ya hay algún filtro avanzado activo, así MJ ve qué
    // está aplicado y no se le esconde la respuesta de la URL.
    Object.values(initial).some((v) => v && v !== "")
  );
  const [v, setV] = useState<AdvancedFiltersValue>(initial);

  function buildHref(values: AdvancedFiltersValue) {
    const params = new URLSearchParams();
    // Conservar params no-avanzados.
    for (const [k, val] of Object.entries(preserveParams)) {
      if (val) params.set(k, val);
    }
    // Aplicar avanzados.
    if (values.rut) params.set("rut", values.rut);
    if (values.name) params.set("name", values.name);
    if (values.desc) params.set("desc", values.desc);
    if (values.dateFrom) params.set("dateFrom", values.dateFrom);
    if (values.dateTo) params.set("dateTo", values.dateTo);
    if (values.estado) params.set("estado", values.estado);
    if (values.tipo) params.set("tipo", values.tipo);
    if (values.limit) params.set("limit", values.limit);
    const qs = params.toString();
    return `/banco/movimientos${qs ? `?${qs}` : ""}`;
  }

  function handleApply() {
    router.push(buildHref(v));
  }

  function handleClear() {
    setV(EMPTY);
    router.push(buildHref(EMPTY));
  }

  const activeCount = [
    v.rut,
    v.name,
    v.desc,
    v.dateFrom,
    v.dateTo,
    v.estado,
    v.tipo,
    v.limit,
  ].filter(Boolean).length;

  return (
    <div className="bg-white border border-gray-200 rounded-lg mb-4 overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((x) => !x)}
        className="w-full flex items-center justify-between px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 transition-colors"
      >
        <span className="flex items-center gap-2">
          <span className="text-xs uppercase tracking-wider text-gray-500">
            Filtros avanzados
          </span>
          {activeCount > 0 && (
            <span className="text-[10px] bg-gray-900 text-white px-1.5 py-0.5 rounded-full tabular-nums">
              {activeCount}
            </span>
          )}
        </span>
        <span className="text-gray-400 text-xs">{open ? "▲" : "▼"}</span>
      </button>

      {open && (
        <div className="border-t border-gray-100 px-4 py-3 space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <Field label="RUT contraparte">
              <input
                type="text"
                value={v.rut}
                onChange={(e) => setV({ ...v, rut: e.target.value })}
                onKeyDown={(e) => e.key === "Enter" && handleApply()}
                placeholder="12345678-9"
                className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm focus:ring-1 focus:ring-gray-900 focus:border-gray-900 outline-none"
              />
            </Field>
            <Field label="Nombre contraparte">
              <input
                type="text"
                value={v.name}
                onChange={(e) => setV({ ...v, name: e.target.value })}
                onKeyDown={(e) => e.key === "Enter" && handleApply()}
                placeholder="Brune SpA"
                className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm focus:ring-1 focus:ring-gray-900 focus:border-gray-900 outline-none"
              />
            </Field>
            <Field label="Descripción">
              <input
                type="text"
                value={v.desc}
                onChange={(e) => setV({ ...v, desc: e.target.value })}
                onKeyDown={(e) => e.key === "Enter" && handleApply()}
                placeholder="transferencia"
                className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm focus:ring-1 focus:ring-gray-900 focus:border-gray-900 outline-none"
              />
            </Field>

            <Field label="Fecha desde">
              <input
                type="date"
                value={v.dateFrom}
                onChange={(e) => setV({ ...v, dateFrom: e.target.value })}
                className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm focus:ring-1 focus:ring-gray-900 focus:border-gray-900 outline-none"
              />
            </Field>
            <Field label="Fecha hasta">
              <input
                type="date"
                value={v.dateTo}
                onChange={(e) => setV({ ...v, dateTo: e.target.value })}
                className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm focus:ring-1 focus:ring-gray-900 focus:border-gray-900 outline-none"
              />
            </Field>
            <Field label="Estado asignación">
              <select
                value={v.estado}
                onChange={(e) => setV({ ...v, estado: e.target.value })}
                className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm bg-white text-gray-700 focus:ring-1 focus:ring-gray-900 focus:border-gray-900 outline-none"
              >
                <option value="">Todos</option>
                <option value="sin_asignar">Pendiente</option>
                <option value="parcial">Parcial</option>
                <option value="conciliado">Conciliado</option>
                <option value="sin_factura">Sin factura</option>
              </select>
            </Field>
            <Field label="Tipo movimiento">
              <select
                value={v.tipo}
                onChange={(e) => setV({ ...v, tipo: e.target.value })}
                className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm bg-white text-gray-700 focus:ring-1 focus:ring-gray-900 focus:border-gray-900 outline-none"
              >
                <option value="">Todos</option>
                <option value="ingreso">Ingreso</option>
                <option value="egreso">Egreso</option>
                <option value="interno">Transfer interna</option>
              </select>
            </Field>

            <Field label="Cantidad registros">
              <select
                value={v.limit}
                onChange={(e) => setV({ ...v, limit: e.target.value })}
                className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm bg-white text-gray-700 focus:ring-1 focus:ring-gray-900 focus:border-gray-900 outline-none"
              >
                <option value="">500 (default)</option>
                <option value="100">100</option>
                <option value="200">200</option>
                <option value="500">500</option>
                <option value="all">Todos</option>
              </select>
            </Field>
          </div>

          <div className="flex items-center justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={handleClear}
              className="text-xs text-gray-600 hover:text-gray-900 px-3 py-1.5"
            >
              Limpiar campos
            </button>
            <button
              type="button"
              onClick={handleApply}
              className="text-xs bg-gray-900 text-white px-4 py-1.5 rounded hover:bg-gray-800"
            >
              Buscar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-[10px] uppercase tracking-wider text-gray-500 block mb-1">
        {label}
      </span>
      {children}
    </label>
  );
}
