"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { formatCLP } from "@/lib/utils";
import { validarSplit, type RepartoNC } from "@/lib/banco/ncSplit";

type Candidate = {
  id: string;
  folioNumber: string | null;
  tipoDoc: number | null;
  totalAmount: number;
  businessName: string | null;
  issueDate: string; // ISO date
};

type NCType = "emitida" | "recibida";

type BankMovementOption = {
  id: string;
  date: string; // ISO
  amount: number;
  description: string;
  bankAccountAlias: string;
  status: string;
};

type RefundMovInfo = {
  id: string;
  date: string;
  amount: number;
  bankAccountAlias: string;
};

export default function CompensacionNC({
  invoiceId,
  ncType,
  ncTotal,
  initialCompensationType,
  initialAppliedTo,
  initialRefundMov,
  candidates,
  reparto,
}: {
  invoiceId: string;
  ncType: NCType;
  ncTotal: number;
  initialCompensationType: string | null;
  initialAppliedTo: { id: string; folioNumber: string | null; totalAmount: number } | null;
  initialRefundMov: RefundMovInfo | null;
  candidates: Candidate[];
  // Cómo quedó repartida la NC entre sus destinos, calculado en el servidor.
  reparto: RepartoNC;
}) {
  // "Proveedor" cuando la NC es recibida (BLARQ recibió la NC del proveedor).
  // "Cliente" cuando la NC es emitida (BLARQ emitió la NC anulando una
  // factura propia al cliente).
  const contraparteLabel = ncType === "recibida" ? "proveedor" : "cliente";
  const router = useRouter();
  const [compensationType, setCompensationType] = useState<string | null>(
    initialCompensationType
  );
  const [appliedTo, setAppliedTo] = useState(initialAppliedTo);
  const [refundMov, setRefundMov] = useState<RefundMovInfo | null>(initialRefundMov);
  const [pickerOpen, setPickerOpen] = useState<null | "invoice" | "bank" | "split">(
    null
  );
  const [bankCandidates, setBankCandidates] = useState<BankMovementOption[]>([]);
  const [bankLoading, setBankLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ── Estado del reparto (partir la NC entre una factura y el banco) ──────
  const [splitInvoice, setSplitInvoice] = useState<Candidate | null>(null);
  const [splitMov, setSplitMov] = useState<BankMovementOption | null>(null);
  // Lo que va a la factura. El resto va al banco — se calcula, no se escribe
  // dos veces: si MJ tuviera que tipear los dos montos, cualquier typo dejaría
  // un reparto que no suma y el error aparecería recién al guardar.
  const [splitAFactura, setSplitAFactura] = useState<string>("");
  const aFacturaNum = Math.round(Number(splitAFactura.replace(/\D/g, "")) || 0);
  const alBancoNum = Math.round(ncTotal) - aFacturaNum;
  const splitProblema = validarSplit(ncTotal, aFacturaNum, alBancoNum);

  /**
   * Movimientos del banco candidatos. Para un reembolso ENTERO se filtran por
   * monto (el depósito es exactamente la NC); para un reparto NO, porque el
   * depósito casi nunca coincide con la NC: el de Comercial Hispano trae dos
   * NC de dos obras menos los retiros, así que no calza con ninguna sola.
   */
  async function loadBankCandidates(porMonto = true) {
    setBankLoading(true);
    try {
      const params = new URLSearchParams();
      params.set("status", "sin_asignar");
      params.set("type", "abono");
      if (porMonto) params.set("amount", String(Math.round(ncTotal)));
      params.set("limit", "50");
      const res = await fetch(`/api/banco/movimientos?${params.toString()}`);
      if (res.ok) {
        const data = await res.json();
        const movs = (data.movements ?? data.movimientos ?? []) as BankMovementOption[];
        setBankCandidates(movs.filter((m) => m.amount > 0));
      } else {
        setBankCandidates([]);
      }
    } catch {
      setBankCandidates([]);
    } finally {
      setBankLoading(false);
    }
  }

  async function applyToInvoice(targetId: string) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/facturas/${invoiceId}/compensar`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "other_invoice", appliedToInvoiceId: targetId }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error ?? "Error");
        return;
      }
      const target = candidates.find((c) => c.id === targetId) ?? null;
      setCompensationType("other_invoice");
      setAppliedTo(
        target
          ? { id: target.id, folioNumber: target.folioNumber, totalAmount: target.totalAmount }
          : null
      );
      setRefundMov(null);
      setPickerOpen(null);
      router.refresh();
    } catch {
      setError("Error de red");
    } finally {
      setBusy(false);
    }
  }

  async function applyToBankMovement(movId: string) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/facturas/${invoiceId}/compensar`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "bank_refund", refundBankMovementId: movId }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error ?? "Error");
        return;
      }
      const mov = bankCandidates.find((m) => m.id === movId);
      if (mov) {
        setRefundMov({
          id: mov.id,
          date: mov.date,
          amount: mov.amount,
          bankAccountAlias: mov.bankAccountAlias,
        });
      }
      setCompensationType("bank_refund");
      setAppliedTo(null);
      setPickerOpen(null);
      router.refresh();
    } catch {
      setError("Error de red");
    } finally {
      setBusy(false);
    }
  }

  async function guardarReparto() {
    if (!splitInvoice || !splitMov || splitProblema) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/facturas/${invoiceId}/compensar`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "split",
          appliedToInvoiceId: splitInvoice.id,
          appliedAmount: aFacturaNum,
          refundBankMovementId: splitMov.id,
          refundAmount: alBancoNum,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error ?? "Error");
        return;
      }
      setCompensationType("split");
      setAppliedTo({
        id: splitInvoice.id,
        folioNumber: splitInvoice.folioNumber,
        totalAmount: splitInvoice.totalAmount,
      });
      setRefundMov({
        id: splitMov.id,
        date: splitMov.date,
        amount: splitMov.amount,
        bankAccountAlias: splitMov.bankAccountAlias,
      });
      setPickerOpen(null);
      router.refresh();
    } catch {
      setError("Error de red");
    } finally {
      setBusy(false);
    }
  }

  async function markCashRefund() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/facturas/${invoiceId}/compensar`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "cash_refund" }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error ?? "Error");
        return;
      }
      setCompensationType("cash_refund");
      setAppliedTo(null);
      setRefundMov(null);
      router.refresh();
    } catch {
      setError("Error de red");
    } finally {
      setBusy(false);
    }
  }

  async function clearCompensation() {
    if (!confirm("¿Quitar la compensación de esta NC?")) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/facturas/${invoiceId}/compensar`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: null }),
      });
      if (!res.ok) {
        setError("Error al quitar");
        return;
      }
      setCompensationType(null);
      setAppliedTo(null);
      setRefundMov(null);
      router.refresh();
    } catch {
      setError("Error de red");
    } finally {
      setBusy(false);
    }
  }

  // Aviso de plata sin destino. Va ARRIBA de cualquier estado, incluso de los
  // que se ven "cerrados": el caso que motivó todo esto era justamente una NC
  // que figuraba compensada mientras $16.731 no estaban en ningún lado.
  const avisoSinRepartir =
    reparto.sinRepartir > 0 ? (
      <div className="border border-amber-300 bg-amber-50 rounded-xl p-3 mb-3">
        <p className="text-sm text-amber-900">
          <span className="font-medium">
            Quedan {formatCLP(reparto.sinRepartir)} sin repartir
          </span>{" "}
          de esta nota de crédito
          {reparto.aFactura > 0 && (
            <> — a la factura solo le entraron {formatCLP(reparto.aFactura)}</>
          )}
          . Esa plata volvió de alguna forma: partila entre la factura y el
          depósito del banco para que quede anotado dónde está.
        </p>
      </div>
    ) : null;

  // Estado: partida entre una factura y el banco
  if (compensationType === "split") {
    return (
      <>
        {avisoSinRepartir}
        <div className="border border-gray-200 rounded-xl p-4 mb-6">
          <div className="flex items-start justify-between gap-3">
            <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">
              Nota de crédito repartida
            </p>
            <button
              type="button"
              onClick={clearCompensation}
              disabled={busy}
              className="text-[11px] text-gray-500 hover:text-rose-700 underline whitespace-nowrap"
            >
              quitar
            </button>
          </div>
          <div className="mt-3 divide-y divide-gray-100">
            <div className="flex items-center gap-3 py-2">
              <span className="flex-1 text-sm text-gray-900">
                Paga la factura{" "}
                {appliedTo ? (
                  <a
                    href={`/facturas/${appliedTo.id}`}
                    className="font-medium underline hover:text-gray-600"
                  >
                    F-{appliedTo.folioNumber ?? "—"}
                  </a>
                ) : (
                  "—"
                )}
              </span>
              <span className="text-sm tabular-nums font-medium text-gray-900">
                {formatCLP(reparto.aFactura)}
              </span>
            </div>
            <div className="flex items-center gap-3 py-2">
              <span className="flex-1 text-sm text-gray-900">
                Volvió al banco
                {refundMov && (
                  <span className="text-gray-500">
                    {" "}
                    · {refundMov.bankAccountAlias},{" "}
                    {new Date(refundMov.date).toLocaleDateString("es-CL", {
                      timeZone: "UTC",
                    })}
                  </span>
                )}
              </span>
              <span className="text-sm tabular-nums font-medium text-gray-900">
                {formatCLP(reparto.alBanco)}
              </span>
            </div>
          </div>
        </div>
      </>
    );
  }

  // Estado: ya compensada — efectivo
  if (compensationType === "cash_refund") {
    return (
      <div className="bg-green-50 border border-green-200 rounded-xl p-4 mb-6">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-medium text-green-700 uppercase tracking-wide">
              NC compensada — Reembolso en efectivo
            </p>
            <p className="text-sm text-green-900 mt-1">
              El proveedor devolvió {formatCLP(ncTotal)} en efectivo. La NC ya está
              cerrada y no aparece como pendiente.
            </p>
          </div>
          <button
            type="button"
            onClick={clearCompensation}
            disabled={busy}
            className="text-[11px] text-green-700 hover:text-rose-700 underline whitespace-nowrap"
          >
            quitar
          </button>
        </div>
      </div>
    );
  }

  // Estado: ya compensada — aplicada a otra factura
  if (compensationType === "other_invoice" && appliedTo) {
    return (
      <>
      {avisoSinRepartir}
      <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 mb-6">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-medium text-blue-700 uppercase tracking-wide">
              {ncType === "recibida"
                ? "NC compensada — Aplicada a otra factura"
                : "NC compensada — Anula factura emitida"}
            </p>
            <p className="text-sm text-blue-900 mt-1">
              {ncType === "recibida" ? "Crédito" : "NC"} de {formatCLP(ncTotal)} aplicado a{" "}
              <a
                href={`/facturas/${appliedTo.id}`}
                className="font-medium underline hover:text-blue-700"
              >
                F-{appliedTo.folioNumber ?? "—"}
              </a>{" "}
              (total {formatCLP(appliedTo.totalAmount)}).
            </p>
          </div>
          <button
            type="button"
            onClick={clearCompensation}
            disabled={busy}
            className="text-[11px] text-blue-700 hover:text-rose-700 underline whitespace-nowrap"
          >
            quitar
          </button>
        </div>
      </div>
      </>
    );
  }

  // Estado: ya compensada — reembolso a cuenta bancaria
  if (compensationType === "bank_refund") {
    return (
      <div className="bg-indigo-50 border border-indigo-200 rounded-xl p-4 mb-6">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-medium text-indigo-700 uppercase tracking-wide">
              NC compensada — Reembolso a la cuenta
            </p>
            <p className="text-sm text-indigo-900 mt-1">
              {refundMov ? (
                <>
                  El proveedor devolvió {formatCLP(refundMov.amount)} a tu cuenta{" "}
                  <span className="font-medium">{refundMov.bankAccountAlias}</span> el{" "}
                  {new Date(refundMov.date).toLocaleDateString("es-CL", { timeZone: "UTC" })}. La NC está cerrada.
                </>
              ) : (
                <>
                  El proveedor devolvió {formatCLP(ncTotal)} a tu cuenta bancaria.
                  La NC está cerrada.
                </>
              )}
            </p>
          </div>
          <button
            type="button"
            onClick={clearCompensation}
            disabled={busy}
            className="text-[11px] text-indigo-700 hover:text-rose-700 underline whitespace-nowrap"
          >
            quitar
          </button>
        </div>
      </div>
    );
  }

  // Estado: sin compensar — mostrar opciones
  return (
    <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 mb-6">
      <p className="text-xs font-medium text-amber-800 uppercase tracking-wide">
        NC sin compensar
      </p>
      <p className="text-sm text-amber-900 mt-1 leading-relaxed">
        Esta nota de crédito por {formatCLP(ncTotal)} todavía no está conciliada.
        Decí cómo se compensó:
      </p>

      {!pickerOpen && (
        <div className="flex gap-2 mt-3 flex-wrap">
          <button
            type="button"
            onClick={() => setPickerOpen("invoice")}
            disabled={busy || candidates.length === 0}
            className="text-sm px-3 py-1.5 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
            title={
              candidates.length === 0
                ? `No hay otras facturas del mismo ${contraparteLabel} para compensar`
                : ncType === "recibida"
                  ? "La NC se aplicó como medio de pago de otra factura del mismo proveedor"
                  : "La NC anula o cubre otra factura emitida al mismo cliente (sin movimiento de plata)"
            }
          >
            {ncType === "recibida" ? "Aplicar a otra factura" : "Anular factura emitida"}
          </button>
          <button
            type="button"
            onClick={() => {
              setPickerOpen("bank");
              loadBankCandidates();
            }}
            disabled={busy}
            className="text-sm px-3 py-1.5 bg-indigo-600 text-white rounded hover:bg-indigo-700 disabled:opacity-50"
            title="El proveedor depositó la plata en tu cuenta bancaria"
          >
            Reembolso a la cuenta
          </button>
          <button
            type="button"
            onClick={markCashRefund}
            disabled={busy}
            className="text-sm px-3 py-1.5 bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-50"
            title="El proveedor devolvió la plata en efectivo (caso Sodimac)"
          >
            Reembolso en efectivo
          </button>
          <button
            type="button"
            onClick={() => {
              setPickerOpen("split");
              setSplitAFactura("");
              setSplitInvoice(null);
              setSplitMov(null);
              loadBankCandidates(false);
            }}
            disabled={busy || candidates.length === 0}
            className="text-sm px-3 py-1.5 border border-gray-400 text-gray-800 rounded hover:bg-white disabled:opacity-50"
            title={
              candidates.length === 0
                ? `No hay facturas de este ${contraparteLabel} con saldo para pagar con la nota de crédito`
                : "Una parte pagó otra factura y el resto volvió al banco"
            }
          >
            Partir entre factura y banco
          </button>
        </div>
      )}

      {pickerOpen === "split" && (
        <div className="mt-3 bg-white border border-amber-200 rounded p-3 space-y-3">
          <p className="text-xs text-gray-600">
            Una parte de la nota de crédito pagó una factura y el resto volvió
            al banco. Elegí los dos destinos y cuánto fue a cada uno.
          </p>

          <div>
            <p className="text-[11px] uppercase tracking-wide text-gray-500 mb-1">
              Factura que pagó
            </p>
            <select
              value={splitInvoice?.id ?? ""}
              onChange={(e) => {
                const c = candidates.find((x) => x.id === e.target.value) ?? null;
                setSplitInvoice(c);
                // Arranque razonable: lo que va a la factura es su total, que es
                // el caso normal (la NC paga esa factura entera y el resto
                // vuelve). MJ lo puede corregir.
                if (c) setSplitAFactura(String(Math.round(c.totalAmount)));
              }}
              className="w-full text-sm border border-gray-300 rounded px-2 py-1.5"
            >
              <option value="">Elegí una factura…</option>
              {candidates.map((c) => (
                <option key={c.id} value={c.id}>
                  F-{c.folioNumber ?? "—"} ·{" "}
                  {new Date(c.issueDate).toLocaleDateString("es-CL")} ·{" "}
                  {formatCLP(c.totalAmount)}
                </option>
              ))}
            </select>
          </div>

          <div>
            <p className="text-[11px] uppercase tracking-wide text-gray-500 mb-1">
              Depósito donde volvió el resto
            </p>
            {bankLoading ? (
              <p className="text-sm text-gray-500">Buscando movimientos…</p>
            ) : (
              <select
                value={splitMov?.id ?? ""}
                onChange={(e) =>
                  setSplitMov(
                    bankCandidates.find((x) => x.id === e.target.value) ?? null
                  )
                }
                className="w-full text-sm border border-gray-300 rounded px-2 py-1.5"
              >
                <option value="">Elegí un depósito…</option>
                {bankCandidates.map((m) => (
                  <option key={m.id} value={m.id}>
                    {new Date(m.date).toLocaleDateString("es-CL", {
                      timeZone: "UTC",
                    })}{" "}
                    · {formatCLP(m.amount)} · {m.description.slice(0, 40)}
                  </option>
                ))}
              </select>
            )}
          </div>

          <div className="border-t border-gray-100 pt-3 space-y-1.5">
            <div className="flex items-center justify-between gap-3">
              <label htmlFor="split-a-factura" className="text-sm text-gray-700">
                A la factura
              </label>
              <input
                id="split-a-factura"
                inputMode="numeric"
                value={splitAFactura}
                onChange={(e) => setSplitAFactura(e.target.value)}
                className="w-36 text-sm text-right tabular-nums border border-gray-300 rounded px-2 py-1"
              />
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm text-gray-700">Al banco</span>
              <span className="w-36 text-sm text-right tabular-nums text-gray-900 px-2 py-1">
                {formatCLP(alBancoNum)}
              </span>
            </div>
            <div className="flex items-center justify-between gap-3 border-t border-gray-100 pt-1.5">
              <span className="text-sm text-gray-500">Total de la nota</span>
              <span className="w-36 text-sm text-right tabular-nums font-medium text-gray-900 px-2 py-1">
                {formatCLP(ncTotal)}
              </span>
            </div>
          </div>

          {splitProblema && splitAFactura !== "" && (
            <p className="text-xs text-amber-900">{splitProblema}</p>
          )}

          <div className="flex gap-2">
            <button
              type="button"
              onClick={guardarReparto}
              disabled={busy || !splitInvoice || !splitMov || splitProblema !== null}
              className="text-sm px-3 py-1.5 bg-gray-900 text-white rounded hover:bg-gray-800 disabled:opacity-50"
            >
              Guardar el reparto
            </button>
            <button
              type="button"
              onClick={() => setPickerOpen(null)}
              className="text-[11px] text-gray-500 hover:text-gray-700 underline"
            >
              cancelar
            </button>
          </div>
        </div>
      )}

      {pickerOpen === "invoice" && (
        <div className="mt-3 bg-white border border-amber-200 rounded p-3">
          <p className="text-xs text-gray-600 mb-2">
            {ncType === "recibida"
              ? `Elegí la factura del mismo ${contraparteLabel} a la que se aplicó el crédito:`
              : `Elegí la factura emitida que esta NC anula o cubre:`}
          </p>
          {candidates.length === 0 ? (
            <p className="text-sm text-gray-500">
              No hay otras facturas de este {contraparteLabel} para compensar.
            </p>
          ) : (
            <div className="max-h-64 overflow-y-auto divide-y divide-gray-100">
              {candidates.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => applyToInvoice(c.id)}
                  disabled={busy}
                  className="w-full text-left px-2 py-2 hover:bg-blue-50 disabled:opacity-50 flex items-center gap-3"
                >
                  <span className="text-xs tabular-nums text-gray-500 w-20 truncate">
                    F-{c.folioNumber ?? "—"}
                  </span>
                  <span className="text-xs text-gray-500 w-20">
                    {new Date(c.issueDate).toLocaleDateString("es-CL")}
                  </span>
                  <span className="flex-1 text-sm text-gray-900 truncate">
                    {c.businessName ?? "—"}
                  </span>
                  <span className="text-sm tabular-nums font-medium text-gray-900">
                    {formatCLP(c.totalAmount)}
                  </span>
                </button>
              ))}
            </div>
          )}
          <button
            type="button"
            onClick={() => setPickerOpen(null)}
            className="mt-2 text-[11px] text-gray-500 hover:text-gray-700 underline"
          >
            cancelar
          </button>
        </div>
      )}

      {pickerOpen === "bank" && (
        <div className="mt-3 bg-white border border-amber-200 rounded p-3">
          <p className="text-xs text-gray-600 mb-2">
            Elegí el movimiento bancario donde entró el reembolso (filtrados por
            ingresos sin asignar de monto similar a la NC):
          </p>
          {bankLoading ? (
            <p className="text-sm text-gray-500">Buscando movimientos…</p>
          ) : bankCandidates.length === 0 ? (
            <p className="text-sm text-gray-500">
              No se encontraron movimientos de ingreso sin asignar con monto cercano.
              Buscá manualmente en /banco/movimientos y volvé acá si lo necesitás.
            </p>
          ) : (
            <div className="max-h-64 overflow-y-auto divide-y divide-gray-100">
              {bankCandidates.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => applyToBankMovement(m.id)}
                  disabled={busy}
                  className="w-full text-left px-2 py-2 hover:bg-indigo-50 disabled:opacity-50 flex items-center gap-3"
                >
                  <span className="text-xs text-gray-500 w-20 whitespace-nowrap">
                    {new Date(m.date).toLocaleDateString("es-CL", { timeZone: "UTC" })}
                  </span>
                  <span className="text-xs text-gray-500 w-24 truncate">
                    {m.bankAccountAlias}
                  </span>
                  <span className="flex-1 text-sm text-gray-900 truncate">
                    {m.description}
                  </span>
                  <span className="text-sm tabular-nums font-medium text-emerald-700">
                    {formatCLP(m.amount)}
                  </span>
                </button>
              ))}
            </div>
          )}
          <button
            type="button"
            onClick={() => setPickerOpen(null)}
            className="mt-2 text-[11px] text-gray-500 hover:text-gray-700 underline"
          >
            cancelar
          </button>
        </div>
      )}

      {error && <p className="text-xs text-red-700 mt-2">{error}</p>}
    </div>
  );
}
