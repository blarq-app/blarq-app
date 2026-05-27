"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Botón "quitar" en una fila del Historial de pagos. Borra esa imputación
 * (deja al mov con saldo libre para reasignar) y refresca la página.
 */
export default function RemovePaymentButton({
  invoiceId,
  paymentId,
  amount,
}: {
  invoiceId: string;
  paymentId: string;
  amount: number;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function handleClick() {
    const amountStr = "$" + Math.round(amount).toLocaleString("es-CL");
    if (
      !confirm(
        `¿Quitar esta imputación de ${amountStr}? El movimiento queda con su saldo libre para reasignar.`
      )
    ) {
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(
        `/api/facturas/${invoiceId}/payments/${paymentId}`,
        { method: "DELETE" }
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(data.error ?? "No se pudo eliminar la imputación");
        return;
      }
      router.refresh();
    } catch {
      alert("Error de red");
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={busy}
      className="text-xs text-gray-400 hover:text-rose-700 disabled:opacity-50"
      title="Quitar esta imputación"
    >
      {busy ? "…" : "quitar"}
    </button>
  );
}
