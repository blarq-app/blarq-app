"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

const TYPE_LABELS: Record<string, string> = {
  obra: "Obra",
  muebles: "Muebles",
  artefactos: "Artefactos",
};

export default function NuevaVersionButton({
  projectId,
  type,
  baseVersionId,
  label,
  variant = "primary",
}: {
  projectId: string;
  type: string;
  baseVersionId?: string;
  label?: string;
  variant?: "primary" | "secondary";
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function handleClick() {
    setLoading(true);
    try {
      const res = await fetch("/api/presupuestos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, type, baseVersionId }),
      });

      if (!res.ok) throw new Error("Error al crear versión");

      const budget = await res.json();
      router.push(`/proyectos/${projectId}/presupuesto/${budget.id}`);
      router.refresh();
    } catch {
      alert("Error al crear nueva versión");
      setLoading(false);
    }
  }

  const defaultLabel = baseVersionId
    ? `Duplicar`
    : `+ Nueva ${TYPE_LABELS[type] || type}`;

  if (variant === "secondary") {
    return (
      <button
        onClick={handleClick}
        disabled={loading}
        className="text-sm text-gray-500 hover:text-gray-800 border border-gray-200 hover:border-gray-400 px-3 py-1 rounded-lg transition-colors disabled:opacity-50"
      >
        {loading ? "Creando..." : (label ?? defaultLabel)}
      </button>
    );
  }

  return (
    <button
      onClick={handleClick}
      disabled={loading}
      className="bg-gray-900 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-gray-800 transition-colors disabled:opacity-50"
    >
      {loading ? "Creando..." : (label ?? defaultLabel)}
    </button>
  );
}
