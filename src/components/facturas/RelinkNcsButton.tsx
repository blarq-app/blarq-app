"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// Botón "Re-linkear NCs" — dispara linkNcReferences() on-demand.
// Solo se renderiza cuando hay NCs sin reference (pendingCount > 0).
// Después del sync mostramos el resumen del LinkResult.
export default function RelinkNcsButton({
  pendingCount,
}: {
  pendingCount: number;
}) {
  const router = useRouter();
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  async function handleClick() {
    setRunning(true);
    setResult(null);
    try {
      const res = await fetch("/api/sii/relink-ncs", { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setResult(`❌ ${data.error || "Error al re-linkear"}`);
        return;
      }
      const parts: string[] = [];
      if (data.linked > 0) parts.push(`✓ ${data.linked} linkeadas`);
      if (data.notFoundInRcv > 0)
        parts.push(`${data.notFoundInRcv} no en RCV`);
      if (data.noRefs > 0) parts.push(`${data.noRefs} sin referencias`);
      if (data.errors > 0) parts.push(`${data.errors} errores`);
      setResult(
        parts.length > 0
          ? parts.join(" · ")
          : `sin pendientes (${data.total} revisadas)`
      );
      router.refresh();
    } finally {
      setRunning(false);
      setTimeout(() => setResult(null), 10000);
    }
  }

  return (
    <div className="flex items-center gap-3">
      {result && (
        <span className="text-xs text-gray-600 whitespace-nowrap">{result}</span>
      )}
      <button
        onClick={handleClick}
        disabled={running}
        className="border border-gray-300 text-gray-700 px-3 py-2 rounded-lg text-sm font-medium hover:bg-gray-50 disabled:opacity-50 whitespace-nowrap"
        title="Consulta el SII y linkea las NCs recibidas con sus facturas referenciadas"
      >
        {running
          ? "Re-linkeando…"
          : `↻ Re-linkear NCs (${pendingCount})`}
      </button>
    </div>
  );
}
