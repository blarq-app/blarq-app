"use client";

import { useEffect, useState } from "react";
import { useSenalGuardado, claseSenal, SenalGuardado } from "./senalGuardado";

// Desplegable de obra para una transferencia interna (Operativa→Sueldos).
// MJ concilia cada transferencia a su proyecto, igual que concilia facturas.
// Al elegir, etiqueta los DOS lados del par linkeado (el endpoint lo hace).
// Opción vacía = desasignar. Reusa el formato "número · nombre" ordenado por
// número (mismo criterio que el resto de los desplegables de obra, PR #171).
export default function InternalTransferProjectSelect({
  movimientoId,
  projectId,
  projects,
}: {
  movimientoId: string;
  projectId: string | null;
  projects: { id: string; name: string; numeroProyecto: number | null }[];
}) {
  const [value, setValue] = useState(projectId ?? "");
  const { busy, confirmado, setSaving, refrescarYConfirmar } =
    useSenalGuardado();

  // Resincronizar con el prop cuando cambia desde el server. Necesario porque
  // una transferencia son DOS filas linkeadas: al asignar obra en una, el
  // endpoint etiqueta las dos y router.refresh() trae el nuevo projectId del
  // OTRO lado — pero useState no relee su valor inicial en cada render, así que
  // sin esto la otra fila seguiría mostrando "— sin obra".
  useEffect(() => {
    setValue(projectId ?? "");
  }, [projectId]);

  async function onChange(next: string) {
    if (busy) return;
    const prev = value;
    setValue(next);
    setSaving(true);
    try {
      const res = await fetch(`/api/banco/movimientos/${movimientoId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ internalProjectId: next || null }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        alert(data.error ?? "No se pudo asignar la obra");
        setValue(prev); // revertir si falló
        return;
      }
      refrescarYConfirmar();
    } catch {
      alert("Error de red al asignar la obra");
      setValue(prev);
    } finally {
      setSaving(false);
    }
  }

  return (
    <span className="relative flex items-center">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={busy}
        title="Conciliar esta transferencia interna a una obra"
        className={`w-full max-w-[180px] text-xs border rounded px-1.5 py-1 outline-none focus:ring-1 focus:ring-gray-900 focus:border-gray-900 disabled:opacity-50 ${claseSenal(
          confirmado,
          value
            ? "border-gray-300 text-gray-700"
            : "border-gray-200 text-gray-400"
        )}`}
      >
        <option value="">— sin obra</option>
        {projects.map((p) => (
          <option key={p.id} value={p.id}>
            {p.numeroProyecto ? `${p.numeroProyecto} · ` : ""}
            {p.name}
          </option>
        ))}
      </select>
      <SenalGuardado busy={busy} confirmado={confirmado} flotante />
    </span>
  );
}
