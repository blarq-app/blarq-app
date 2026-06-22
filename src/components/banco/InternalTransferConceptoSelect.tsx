"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

// Desplegable obra/muebles para una transferencia interna (traspaso de utilidad
// a Sueldos). MJ marca de qué utilidad es el traspaso, para que en "Me paso a
// Sueldos" se separe lo transferido por concepto. Etiqueta los dos lados del
// par (lo hace el endpoint). Opción vacía = sin clasificar.
export default function InternalTransferConceptoSelect({
  movimientoId,
  concepto,
}: {
  movimientoId: string;
  concepto: string | null;
}) {
  const router = useRouter();
  const [value, setValue] = useState(concepto ?? "");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setValue(concepto ?? "");
  }, [concepto]);

  async function onChange(next: string) {
    if (busy) return;
    const prev = value;
    setValue(next);
    setBusy(true);
    try {
      const res = await fetch(`/api/banco/movimientos/${movimientoId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ internalConcepto: next || null }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        alert(data.error ?? "No se pudo asignar el concepto");
        setValue(prev);
        return;
      }
      router.refresh();
    } catch {
      alert("Error de red");
      setValue(prev);
    } finally {
      setBusy(false);
    }
  }

  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={busy}
      title="De qué utilidad es este traspaso (para Me paso a Sueldos)"
      className={`w-full max-w-[120px] text-xs border rounded px-1.5 py-1 outline-none focus:ring-1 focus:ring-gray-900 focus:border-gray-900 disabled:opacity-50 ${
        value ? "border-gray-300 text-gray-700" : "border-gray-200 text-gray-400"
      }`}
    >
      <option value="">— concepto</option>
      <option value="obra">Obra</option>
      <option value="muebles">Muebles</option>
    </select>
  );
}
