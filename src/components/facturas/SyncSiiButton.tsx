"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// Botón "Sincronizar SII" que dispara POST /api/sii/sync.
// Trae las facturas nuevas desde el SII y las guarda en la app.
// Las que vienen del SII llegan sin proyecto asignado — el usuario las
// asigna después en la lista filtrada.
//
// No hay que elegir fecha: la app calcula sola desde cuándo traer, mirando
// la factura del SII más reciente que ya tiene (ver getDefaultSyncFrom en
// runSiiSync). El servidor decide la ventana y la devuelve en `fromDate`,
// que mostramos en el mensaje de resultado. El sync es idempotente, así que
// re-traer meses ya vistos no duplica nada.
export default function SyncSiiButton() {
  const router = useRouter();
  const [syncing, setSyncing] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; msg: string } | null>(
    null
  );

  async function handleSync() {
    setSyncing(true);
    setResult(null);
    try {
      const res = await fetch("/api/sii/sync", { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setResult({ ok: false, msg: data.error || "Error al sincronizar" });
        return;
      }
      const parts: string[] = [];
      if (data.created > 0) parts.push(`+${data.created} nuevas`);
      if (data.updated > 0) parts.push(`${data.updated} actualizadas`);
      if (data.unchanged > 0) parts.push(`${data.unchanged} sin cambios`);
      const movs = parts.length > 0 ? parts.join(" · ") : "sin movimientos";
      const desde = data.fromDate ? ` · desde ${formatMes(data.fromDate)}` : "";
      const mock = data.mockMode ? " (modo mock — sin SII real)" : "";
      setResult({ ok: true, msg: `${movs}${desde}${mock}` });
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
        <span
          className={`text-xs whitespace-nowrap ${
            result.ok ? "text-gray-600" : "text-red-600"
          }`}
        >
          {result.msg}
        </span>
      )}
      <button
        onClick={handleSync}
        disabled={syncing}
        className="bg-gray-900 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-gray-800 disabled:opacity-50"
        title="Trae las facturas nuevas del SII. La app calcula sola desde cuándo."
      >
        {syncing ? "Sincronizando…" : "↓ Sincronizar SII"}
      </button>
    </div>
  );
}

// "2026-04-01" → "abril 2026". Para mostrar la ventana de sync en lenguaje
// natural, sin que MJ tenga que leer un formato de fecha técnico.
function formatMes(isoDate: string): string {
  const [y, m] = isoDate.split("-");
  const meses = [
    "enero",
    "febrero",
    "marzo",
    "abril",
    "mayo",
    "junio",
    "julio",
    "agosto",
    "septiembre",
    "octubre",
    "noviembre",
    "diciembre",
  ];
  const idx = Number(m) - 1;
  return `${meses[idx] ?? m} ${y}`;
}
