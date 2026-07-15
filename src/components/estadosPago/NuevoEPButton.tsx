"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function NuevoEPButton({
  projectId,
  maestroId,
  label = "+ Nuevo EP",
  disabled,
}: {
  projectId: string;
  // Si viene, el EP se crea para ese maestro (solo sus partidas, numeración
  // propia). Si no, es un EP de obra completa (legacy).
  maestroId?: string;
  label?: string;
  disabled?: boolean;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function handleCreate() {
    if (disabled || loading) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/proyectos/${projectId}/estados-pago`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(maestroId ? { maestroId } : {}),
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
