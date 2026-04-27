"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";

type Project = { id: string; name: string };

export default function FacturasFilterBar({
  projects,
  initial,
}: {
  projects: Project[];
  initial: {
    type: string;
    status: string;
    origin: string;
    projectId: string;
    q: string;
  };
}) {
  const router = useRouter();
  const sp = useSearchParams();
  const [v, setV] = useState(initial);

  function applyFilter(next: typeof v) {
    setV(next);
    const params = new URLSearchParams(sp.toString());
    (["type", "status", "origin", "projectId", "q"] as const).forEach(
      (key) => {
        if (next[key]) params.set(key, next[key]);
        else params.delete(key);
      }
    );
    router.push(`/facturas?${params.toString()}`);
  }

  function set<K extends keyof typeof v>(key: K, value: (typeof v)[K]) {
    applyFilter({ ...v, [key]: value });
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-3 flex flex-wrap items-center gap-2">
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

      <Select
        value={v.projectId}
        onChange={(val) => set("projectId", val)}
        options={[
          { label: "Cualquier proyecto", value: "" },
          { label: "Sin asignar", value: "sin-asignar" },
          ...projects.map((p) => ({ label: p.name, value: p.id })),
        ]}
      />

      {(v.type || v.status || v.origin || v.projectId || v.q) && (
        <button
          onClick={() =>
            applyFilter({ type: "", status: "", origin: "", projectId: "", q: "" })
          }
          className="text-xs text-gray-500 hover:text-gray-900 underline ml-1"
        >
          Limpiar
        </button>
      )}
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
