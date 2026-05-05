"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import MovementReconcileModal from "./MovementReconcileModal";

type ExistingPayment = {
  id: string;
  invoiceId: string;
  amountApplied: number;
  invoice: {
    folioNumber: string | null;
    businessName: string | null;
    totalAmount: number;
  };
};

// Botón que abre el modal de asignar pagos. Diseñado para inyectar en una
// fila de tabla en /banco/movimientos. Pequeño y silencioso, no agrega
// chrome propio.
export default function MovementActionButton({
  movimientoId,
  amount,
  description,
  counterpartyName,
  counterpartyRut,
  date,
  bankAccountAlias,
  existingPayments = [],
  status,
  variant = "primary",
}: {
  movimientoId: string;
  amount: number;
  description: string;
  counterpartyName: string | null;
  counterpartyRut: string | null;
  date: string;
  bankAccountAlias: string;
  existingPayments?: ExistingPayment[];
  status: string;
  variant?: "primary" | "ghost";
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);

  async function savePayments(payments: { invoiceId: string; amountApplied: number }[]) {
    const res = await fetch(`/api/banco/movimientos/${movimientoId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ payments }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error ?? "Error al guardar");
    }
    router.refresh();
  }

  // No mostrar para internos (no hay nada que imputar)
  if (status === "interno") return null;

  // Texto del botón depende del estado
  const isPrimary = variant === "primary";
  const label = existingPayments.length > 0 ? "Editar" : "Asignar";

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className={
          isPrimary
            ? "text-[11px] bg-gray-900 text-white px-2 py-0.5 rounded hover:bg-gray-800"
            : "text-[11px] text-gray-600 hover:text-gray-900 underline"
        }
      >
        {label}
      </button>
      <MovementReconcileModal
        open={open}
        onClose={() => setOpen(false)}
        movement={{
          id: movimientoId,
          amount,
          description,
          counterpartyName,
          counterpartyRut,
          date,
          bankAccountAlias,
        }}
        existingPayments={existingPayments}
        onSave={savePayments}
      />
    </>
  );
}
