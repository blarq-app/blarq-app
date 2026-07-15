"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export type EPBudgetVersion = {
  id: string;
  version: string;
  status: string;
};

export default function NuevoEPButton({
  projectId,
  maestroId,
  label = "+ Nuevo EP",
  disabled,
  versions,
  defaultVersionId,
}: {
  projectId: string;
  // Si viene, el EP se crea para ese maestro (solo sus partidas, numeración
  // propia). Si no, es un EP de obra completa (legacy).
  maestroId?: string;
  label?: string;
  disabled?: boolean;
  // Versiones de obra disponibles. Si hay más de una, MJ elige a mano sobre
  // cuál armar el EP; si no se pasan (o hay una sola), se usa la vigente.
  versions?: EPBudgetVersion[];
  defaultVersionId?: string;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [versionId, setVersionId] = useState(defaultVersionId ?? "");

  const showPicker = (versions?.length ?? 0) > 1;

  async function handleCreate() {
    if (disabled || loading) return;
    setLoading(true);
    try {
      const body: Record<string, string> = {};
      if (maestroId) body.maestroId = maestroId;
      // Solo mandamos versión si hay selector; si no, el backend usa la vigente.
      if (showPicker && versionId) body.budgetVersionId = versionId;
      const res = await fetch(`/api/proyectos/${projectId}/estados-pago`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const e = await res.json();
        alert(e.error || "Error al crear EP");
        return;
      }
      const ep = await res.json();
      router.push(`/proyectos/${projectId}/estados-pago/${ep.id}`);
      router.refresh();
    } finally {
      setLoading(false);
    }
  }

  // Etiqueta legible de cada versión en el selector.
  const optionLabel = (v: EPBudgetVersion) => {
    const estado =
      v.status === "aprobado"
        ? "aprobada"
        : v.status === "enviado"
          ? "enviada"
          : v.status === "borrador"
            ? "borrador"
            : v.status;
    return `${v.version} · ${estado}`;
  };

  if (!showPicker) {
    return (
      <button
        onClick={handleCreate}
        disabled={disabled || loading}
        className="bg-gray-900 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-gray-800 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {loading ? "Creando..." : label}
      </button>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <label className="flex items-center gap-1.5 text-xs text-gray-500">
        <span className="uppercase tracking-wider">Versión</span>
        <select
          value={versionId}
          onChange={(e) => setVersionId(e.target.value)}
          disabled={disabled || loading}
          className="rounded border border-gray-300 bg-white px-2 py-1.5 text-xs text-gray-900 focus:border-gray-900 focus:outline-none disabled:opacity-50"
        >
          {versions!.map((v) => (
            <option key={v.id} value={v.id}>
              {optionLabel(v)}
            </option>
          ))}
        </select>
      </label>
      <button
        onClick={handleCreate}
        disabled={disabled || loading}
        className="bg-gray-900 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-gray-800 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {loading ? "Creando..." : label}
      </button>
    </div>
  );
}
