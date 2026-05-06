"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";

type Project = {
  id: string;
  name: string;
  numeroProyecto: number | null;
  numeroCotizacion: number | null;
};

function projectLabel(p: Project): string {
  const n = p.numeroProyecto ?? p.numeroCotizacion;
  return n != null ? `${n} · ${p.name}` : p.name;
}
type Category = {
  id: string;
  name: string;
  parent: { id: string; name: string } | null;
};

type FilterValues = {
  type: string;
  status: string;
  origin: string;
  projectId: string;
  tipoDoc: string;
  categoryId: string;
  dateFrom: string;
  dateTo: string;
  q: string;
  /** Monto exacto en CLP (con tolerancia ±$10 server-side para redondeo IVA). */
  monto: string;
};

const FILTER_KEYS: (keyof FilterValues)[] = [
  "type",
  "status",
  "origin",
  "projectId",
  "tipoDoc",
  "categoryId",
  "dateFrom",
  "dateTo",
  "q",
  "monto",
];

export default function FacturasFilterBar({
  projects,
  categories = [],
  initial,
}: {
  projects: Project[];
  categories?: Category[];
  initial: FilterValues;
}) {
  const router = useRouter();
  const sp = useSearchParams();
  const [v, setV] = useState(initial);

  function applyFilter(next: FilterValues) {
    setV(next);
    const params = new URLSearchParams(sp.toString());
    FILTER_KEYS.forEach((key) => {
      if (next[key]) params.set(key, next[key]);
      else params.delete(key);
    });
    router.push(`/facturas?${params.toString()}`);
  }

  function set<K extends keyof FilterValues>(key: K, value: FilterValues[K]) {
    applyFilter({ ...v, [key]: value });
  }

  // Categorías agrupadas por padre, igual que en el form de factura.
  const grouped: Record<string, Category[]> = {};
  for (const c of categories) {
    const parentName = c.parent?.name ?? c.name;
    if (!grouped[parentName]) grouped[parentName] = [];
    grouped[parentName].push(c);
  }
  const parentNames = Object.keys(grouped).sort();

  const isAnyActive = FILTER_KEYS.some((k) => !!v[k]);

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-3 space-y-2">
      {/* Fila 1: búsqueda libre + tipo + estado + origen */}
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="text"
          placeholder="Buscar folio, proveedor, RUT, notas…"
          value={v.q}
          onChange={(e) => setV({ ...v, q: e.target.value })}
          onBlur={() => applyFilter(v)}
          onKeyDown={(e) => {
            if (e.key === "Enter") applyFilter(v);
          }}
          className="flex-1 min-w-[200px] px-3 py-1.5 border border-gray-300 rounded text-sm bg-white focus:ring-1 focus:ring-gray-900 focus:border-gray-900 outline-none"
        />

        <Select
          value={v.type}
          onChange={(val) => set("type", val)}
          options={[
            { label: "Todos los tipos", value: "" },
            { label: "Emitida", value: "emitida" },
            { label: "Recibida", value: "recibida" },
          ]}
        />

        <Select
          value={v.status}
          onChange={(val) => set("status", val)}
          options={[
            { label: "Cualquier estado", value: "" },
            { label: "Pendiente", value: "pendiente" },
            { label: "Parcial", value: "parcial" },
            { label: "Pagada", value: "pagada" },
            { label: "Anulada", value: "anulada" },
          ]}
        />

        <Select
          value={v.origin}
          onChange={(val) => set("origin", val)}
          options={[
            { label: "Cualquier origen", value: "" },
            { label: "Manual", value: "manual" },
            { label: "SII", value: "sii_automatica" },
          ]}
        />
      </div>

      {/* Fila 2: documento + proyecto + categoría + fechas */}
      <div className="flex flex-wrap items-center gap-2">
        <Select
          value={v.tipoDoc}
          onChange={(val) => set("tipoDoc", val)}
          options={[
            { label: "Cualquier documento", value: "" },
            { label: "Factura (33)", value: "33" },
            { label: "Factura exenta (34)", value: "34" },
            { label: "Nota crédito (61)", value: "61" },
            { label: "Nota débito (56)", value: "56" },
            { label: "Boleta (39)", value: "39" },
          ]}
        />

        <Select
          value={v.projectId}
          onChange={(val) => set("projectId", val)}
          options={[
            { label: "Cualquier centro de costo", value: "" },
            { label: "Sin asignar", value: "sin-asignar" },
            ...projects.map((p) => ({ label: projectLabel(p), value: p.id })),
          ]}
        />

        <select
          value={v.categoryId}
          onChange={(e) => set("categoryId", e.target.value)}
          className="px-2 py-1.5 border border-gray-300 rounded text-sm bg-white text-gray-700 focus:ring-1 focus:ring-gray-900 focus:border-gray-900 outline-none max-w-[200px]"
        >
          <option value="">Cualquier categoría</option>
          {parentNames.map((parent) => (
            <optgroup key={parent} label={parent}>
              {grouped[parent].map((c) => (
                <option key={c.id} value={c.id}>
                  {c.parent ? c.name : `${c.name} (top)`}
                </option>
              ))}
            </optgroup>
          ))}
        </select>

        <div className="flex items-center gap-1">
          <span className="text-[10px] uppercase tracking-wider text-gray-500">desde</span>
          <input
            type="date"
            value={v.dateFrom}
            onChange={(e) => set("dateFrom", e.target.value)}
            className="px-2 py-1.5 border border-gray-300 rounded text-sm bg-white text-gray-700 focus:ring-1 focus:ring-gray-900 focus:border-gray-900 outline-none tabular-nums"
          />
        </div>
        <div className="flex items-center gap-1">
          <span className="text-[10px] uppercase tracking-wider text-gray-500">hasta</span>
          <input
            type="date"
            value={v.dateTo}
            onChange={(e) => set("dateTo", e.target.value)}
            className="px-2 py-1.5 border border-gray-300 rounded text-sm bg-white text-gray-700 focus:ring-1 focus:ring-gray-900 focus:border-gray-900 outline-none tabular-nums"
          />
        </div>

        <div className="flex items-center gap-1">
          <span className="text-[10px] uppercase tracking-wider text-gray-500">monto</span>
          <input
            type="text"
            inputMode="numeric"
            placeholder="exacto ±$10"
            value={v.monto}
            onChange={(e) => setV({ ...v, monto: e.target.value })}
            onBlur={() => applyFilter(v)}
            onKeyDown={(e) => {
              if (e.key === "Enter") applyFilter(v);
            }}
            className="w-[120px] px-2 py-1.5 border border-gray-300 rounded text-sm bg-white text-gray-700 text-right tabular-nums focus:ring-1 focus:ring-gray-900 focus:border-gray-900 outline-none"
            title="Busca facturas con totalAmount cercano (±$10) al monto. Acepta formato chileno con puntos."
          />
        </div>

        {isAnyActive && (
          <button
            onClick={() =>
              applyFilter({
                type: "",
                status: "",
                origin: "",
                projectId: "",
                tipoDoc: "",
                categoryId: "",
                dateFrom: "",
                dateTo: "",
                q: "",
                monto: "",
              })
            }
            className="text-xs text-gray-500 hover:text-gray-900 underline ml-auto"
          >
            Limpiar
          </button>
        )}
      </div>
    </div>
  );
}

function Select({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (value: string) => void;
  options: { label: string; value: string }[];
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="px-2 py-1.5 border border-gray-300 rounded text-sm bg-white text-gray-700 focus:ring-1 focus:ring-gray-900 focus:border-gray-900 outline-none"
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}
