"use client";

import { useState } from "react";
import { formatCLP } from "@/lib/utils";
import { validateObraDiscount } from "@/lib/projects/metrics";

export default function ObraDiscountField({ value, totalOriginal, onSave }: {
  value: number;
  totalOriginal: number;
  onSave: (value: number) => Promise<void>;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  async function commit() {
    if (draft === null || saving) return;
    const text = draft.trim();
    const validFormat = text === "" || /^\d+$/.test(text) || /^\d{1,3}(\.\d{3})+$/.test(text);
    const parsed = validFormat ? Number(text.replaceAll(".", "")) : NaN;
    const invalid = validateObraDiscount(parsed, totalOriginal);
    if (invalid) { setError(invalid); return; }
    if (parsed === value) { setDraft(null); setError(""); return; }
    setSaving(true); setMessage(""); setError("");
    try {
      await onSave(parsed);
      setDraft(null);
      setMessage("Guardado");
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo guardar el descuento.");
    } finally { setSaving(false); }
  }
  const exceedsTotal = value > Math.round(totalOriginal);
  return (
    <div className="pt-2">
      <label className="flex items-center justify-between gap-4 text-sm">
        <span className="text-gray-600">Descuento ($)</span>
        <input
          aria-label="Descuento en pesos"
          aria-invalid={!!error || exceedsTotal}
          aria-describedby="obra-discount-feedback"
          type="text" inputMode="numeric"
          value={draft ?? (value === 0 ? "" : new Intl.NumberFormat("es-CL").format(value))}
          placeholder="0" disabled={saving}
          onFocus={() => { setDraft((current) => current ?? (value ? String(value) : "")); setMessage(""); }}
          onChange={(e) => { setDraft(e.target.value); setError(""); }}
          onBlur={() => void commit()}
          onKeyDown={(e) => {
            if (e.key === "Enter") { e.preventDefault(); e.currentTarget.blur(); }
            if (e.key === "Escape") { setDraft(null); setError(""); }
          }}
          className="w-36 max-w-[50%] rounded border border-gray-300 bg-white px-3 py-1.5 text-right tabular-nums text-gray-900 placeholder:text-gray-600 focus:outline-none focus:ring-1 focus:ring-gray-900 disabled:bg-gray-50"
        />
      </label>
      <div id="obra-discount-feedback" aria-live="polite" className="text-xs text-right mt-1">
        {error || exceedsTotal ? <span role="alert" className="text-red-700">{error || `Revisá el descuento: el total bajó a ${formatCLP(totalOriginal)}.`}</span>
          : <span className="text-gray-600">{saving ? "Guardando…" : message || "Se guarda al salir del campo."}</span>}
      </div>
    </div>
  );
}
