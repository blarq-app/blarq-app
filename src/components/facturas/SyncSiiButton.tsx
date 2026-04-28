"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// Botón "Sincronizar SII" que dispara POST /api/sii/sync.
// Trae las facturas nuevas desde el SII y las guarda en la app.
// Las que vienen del SII llegan sin proyecto asignado — el usuario las
// asigna después en la lista filtrada.
export default function SyncSiiButton({ from }: { from: string }) {
  const router = useRouter();
  const [syncing, setSyncing] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  async function handleSync() {
    setSyncing(true);
    setResult(null);
    try {
      const res = await fetch(`/api/sii/sync?from=${from}`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setResult(`❌ ${data.error || "Error al sincronizar"}`);
        return;
      }
      const parts: string[] = [];
      if (data.created > 0) parts.push(`+${data.created} nuevas`);
      if (data.updated > 0) parts.push(`${data.updated} actualizadas`);
      if (data.unchanged > 0) parts.push(`${data.unchanged} sin cambios`);
      const msg = parts.length > 0 ? parts.join(" · ") : "sin movimientos";
      setResult(
        `✓ ${msg}${data.mockMode ? " (modo mock — sin SII real)" : ""}`
      );
      router.refresh();
    } finally {
      setSyncing(false);
      // Limpiar el mensaje a los 8s
      setTimeout(() => setResult(null), 8000);
    }
  }

  return (
    <div className="flex items-center gap-3">
      {result && (
        <span className="text-xs text-gray-600 whitespace-nowrap">
          {result}
        </span>
      )}
      <button
        onClick={handleSync}
        disabled={syncing}
        className="bg-purple-700 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-purple-800 disabled:opacity-50"
        title={`Trae las facturas del SII desde ${from}`}
      >
        {syncing ? "Sincronizando…" : "↓ Sincronizar SII"}
      </button>
    </div>
  );
}
