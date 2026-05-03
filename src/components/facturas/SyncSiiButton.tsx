"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// Botón "Sincronizar SII" que dispara POST /api/sii/sync.
// Trae las facturas nuevas desde el SII y las guarda en la app.
// Las que vienen del SII llegan sin proyecto asignado — el usuario las
// asigna después en la lista filtrada.
//
// El input fecha permite ajustar el `from` en runtime — útil para re-traer
// un mes específico o ampliar/acotar la ventana sin tocar código.
export default function SyncSiiButton({ defaultFrom }: { defaultFrom: string }) {
  const router = useRouter();
  const [syncing, setSyncing] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [from, setFrom] = useState(defaultFrom);

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
      <label className="flex items-center gap-1.5 text-xs text-gray-500">
        Desde
        <input
          type="date"
          value={from}
          onChange={(e) => setFrom(e.target.value)}
          disabled={syncing}
          className="border border-gray-300 rounded-lg px-2 py-1.5 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-gray-400 disabled:opacity-50"
        />
      </label>
      <button
        onClick={handleSync}
        disabled={syncing}
        className="bg-gray-900 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-gray-800 disabled:opacity-50"
        title={`Trae las facturas del SII desde ${from}`}
      >
        {syncing ? "Sincronizando…" : "↓ Sincronizar SII"}
      </button>
    </div>
  );
}
