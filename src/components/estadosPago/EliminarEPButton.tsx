"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// Botón para borrar un EP directo desde la lista (sin entrar a "Abrir").
// El backend bloquea borrar un EP "pagado" para no descuadrar la plata; acá
// además lo deshabilitamos para que ni se intente.
export default function EliminarEPButton({
  epId,
  epNumber,
  status,
}: {
  epId: string;
  epNumber: number;
  status: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const isPagado = status === "pagado";

  async function handleDelete() {
    if (isPagado || busy) return;
    if (
      !confirm(
        `¿Eliminar EP #${epNumber}? Esta acción no se puede deshacer.`
      )
    )
      return;
    setBusy(true);
    try {
      const res = await fetch(`/api/estados-pago/${epId}`, {
        method: "DELETE",
      });
      if (res.ok) {
        router.refresh();
      } else {
        const e = await res.json().catch(() => ({}));
        alert(e.error ?? "No se pudo eliminar el EP.");
        setBusy(false);
      }
    } catch {
      alert("No se pudo eliminar el EP.");
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      onClick={handleDelete}
      disabled={busy || isPagado}
      title={
        isPagado
          ? "No se puede eliminar un EP pagado — cambiá su estado primero"
          : "Eliminar EP"
      }
      className="text-gray-300 hover:text-red-600 text-lg leading-none disabled:opacity-40 disabled:hover:text-gray-300"
    >
      ×
    </button>
  );
}
