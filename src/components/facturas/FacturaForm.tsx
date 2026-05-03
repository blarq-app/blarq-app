"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui";
import { formatCLP } from "@/lib/utils";

type Project = {
  id: string;
  name: string;
  numeroProyecto?: number | null;
  numeroCotizacion?: number | null;
};

function projectLabel(p: Project): string {
  const n = p.numeroProyecto ?? p.numeroCotizacion;
  return n != null ? `${n} · ${p.name}` : p.name;
}

type Category = {
  id: string;
  name: string;
  parent: { id: string; name: string } | null;
};

type ReferenceCandidate = {
  id: string;
  folioNumber: string | null;
  tipoDoc: number | null;
  totalAmount: number;
  businessName: string | null;
  issueDate: string;
};

export type FacturaFormValues = {
  id?: string;
  type: "emitida" | "recibida";
  folioNumber: string;
  rutIssuer: string;
  businessName: string;
  issueDate: string;
  dueDate: string;
  netAmount: number;
  status: "pendiente" | "parcial" | "pagada" | "anulada";
  projectId: string;
  categoryId: string;
  notes: string;
  // Solo se setea para NC (61) / ND (56): folio y tipoDoc del DTE original
  // que esta NC/ND modifica.
  referenceFolioNumber?: string;
  referenceTipoDoc?: number | null;
};

export default function FacturaForm({
  mode,
  initial,
  projects,
  categories,
  tipoDoc = null,
  referenceCandidates = [],
}: {
  mode: "create" | "edit";
  initial: FacturaFormValues;
  projects: Project[];
  categories: Category[];
  tipoDoc?: number | null;
  referenceCandidates?: ReferenceCandidate[];
}) {
  const router = useRouter();
  const [v, setV] = useState<FacturaFormValues>(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function set<K extends keyof FacturaFormValues>(key: K, value: FacturaFormValues[K]) {
    setV((prev) => ({ ...prev, [key]: value }));
  }

  const iva = Math.round(v.netAmount * 0.19);
  const total = v.netAmount + iva;

  // Categorías agrupadas por padre
  const grouped: Record<string, Category[]> = {};
  for (const c of categories) {
    const parentName = c.parent?.name ?? c.name; // si no tiene padre, agrupa bajo sí mismo
    if (!grouped[parentName]) grouped[parentName] = [];
    grouped[parentName].push(c);
  }
  const parentNames = Object.keys(grouped).sort();

  async function submit() {
    setSaving(true);
    setError(null);
    try {
      const payload = {
        type: v.type,
        folioNumber: v.folioNumber || null,
        rutIssuer: v.rutIssuer || null,
        businessName: v.businessName || null,
        issueDate: v.issueDate,
        dueDate: v.dueDate || null,
        netAmount: v.netAmount,
        status: v.status,
        projectId: v.projectId || null,
        categoryId: v.categoryId || null,
        notes: v.notes || null,
        referenceFolioNumber: v.referenceFolioNumber || null,
        referenceTipoDoc: v.referenceTipoDoc ?? null,
      };
      const url = mode === "edit" ? `/api/facturas/${v.id}` : "/api/facturas";
      const method = mode === "edit" ? "PUT" : "POST";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setError(j.error || "Error al guardar");
        return;
      }
      router.push("/facturas");
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (mode !== "edit" || !v.id) return;
    if (!confirm("¿Eliminar esta factura?")) return;
    setSaving(true);
    try {
      await fetch(`/api/facturas/${v.id}`, { method: "DELETE" });
      router.push("/facturas");
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-6 max-w-3xl">
      {/* Tipo */}
      <Field label="Tipo">
        <div className="flex gap-2">
          {(["emitida", "recibida"] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => set("type", t)}
              disabled={mode === "edit"}
              className={`px-4 py-2 rounded text-sm border transition-colors disabled:opacity-50 ${
                v.type === t
                  ? "bg-gray-900 text-white border-gray-900"
                  : "bg-white text-gray-700 border-gray-300 hover:border-gray-500"
              }`}
            >
              {t === "emitida" ? "Emitida (cobro a cliente)" : "Recibida (gasto)"}
            </button>
          ))}
        </div>
      </Field>

      <div className="grid grid-cols-2 gap-x-6 gap-y-4 mt-4">
        <Field label="N° Folio">
          <input
            type="text"
            value={v.folioNumber}
            onChange={(e) => set("folioNumber", e.target.value)}
            className={inputCls}
          />
        </Field>

        <Field label="Fecha emisión">
          <input
            type="date"
            value={v.issueDate}
            onChange={(e) => set("issueDate", e.target.value)}
            className={inputCls}
          />
        </Field>

        <Field
          label={
            v.type === "recibida" ? "RUT proveedor" : "RUT cliente (opcional)"
          }
        >
          <input
            type="text"
            value={v.rutIssuer}
            onChange={(e) => set("rutIssuer", e.target.value)}
            placeholder="76.123.456-7"
            className={inputCls}
          />
        </Field>

        <Field
          label={
            v.type === "recibida" ? "Razón social proveedor" : "Razón social cliente"
          }
        >
          <input
            type="text"
            value={v.businessName}
            onChange={(e) => set("businessName", e.target.value)}
            className={inputCls}
          />
        </Field>

        <Field label="Proyecto">
          <select
            value={v.projectId}
            onChange={(e) => set("projectId", e.target.value)}
            className={inputCls}
          >
            <option value="">— Sin asignar —</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {projectLabel(p)}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Categoría">
          <select
            value={v.categoryId}
            onChange={(e) => set("categoryId", e.target.value)}
            className={inputCls}
          >
            <option value="">— Sin categorizar —</option>
            {parentNames.map((parent) => (
              <optgroup key={parent} label={parent}>
                {grouped[parent].map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.parent ? c.name : `${c.name} (general)`}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </Field>

        <Field label="Monto neto (CLP)">
          <input
            type="number"
            value={v.netAmount || ""}
            onChange={(e) => set("netAmount", Number(e.target.value) || 0)}
            className={inputCls}
          />
        </Field>

        <Field label="Estado">
          <select
            value={v.status}
            onChange={(e) =>
              set("status", e.target.value as FacturaFormValues["status"])
            }
            className={inputCls}
          >
            <option value="pendiente">Pendiente</option>
            <option value="pagada">Pagada</option>
            <option value="anulada">Anulada</option>
          </select>
        </Field>

        <Field label="Vencimiento (opcional)">
          <input
            type="date"
            value={v.dueDate}
            onChange={(e) => set("dueDate", e.target.value)}
            className={inputCls}
          />
        </Field>

        <Field label="">
          <div className="text-xs text-gray-500 leading-relaxed pt-2">
            <div>IVA (19%): <span className="text-gray-900 tabular-nums">{formatCLP(iva)}</span></div>
            <div className="font-semibold text-gray-900 text-sm mt-0.5">
              Total: <span className="tabular-nums">{formatCLP(total)}</span>
            </div>
          </div>
        </Field>
      </div>

      {/* Referencia a factura original — solo NC (61) y ND (56) */}
      {(tipoDoc === 61 || tipoDoc === 56) && (
        <div className="mt-4 bg-blue-50/50 border border-blue-100 rounded p-3">
          <Field
            label={
              tipoDoc === 61
                ? "Factura referenciada (esta NC la modifica)"
                : "Factura referenciada (esta ND la modifica)"
            }
          >
            <select
              value={v.referenceFolioNumber ?? ""}
              onChange={(e) => {
                const folio = e.target.value;
                if (!folio) {
                  set("referenceFolioNumber", "");
                  set("referenceTipoDoc", null);
                  return;
                }
                const c = referenceCandidates.find((c) => c.folioNumber === folio);
                set("referenceFolioNumber", folio);
                set("referenceTipoDoc", c?.tipoDoc ?? 33);
              }}
              className={inputCls}
            >
              <option value="">— Sin referencia / no resuelta —</option>
              {referenceCandidates.map((c) => (
                <option key={c.id} value={c.folioNumber ?? ""}>
                  F-{c.folioNumber} · {formatCLP(c.totalAmount)} ·{" "}
                  {c.businessName?.slice(0, 30) ?? "—"} · {c.issueDate}
                </option>
              ))}
            </select>
          </Field>
          <p className="text-[11px] text-gray-500 mt-1">
            {referenceCandidates.length} factura{referenceCandidates.length !== 1 ? "s" : ""} candidata
            {referenceCandidates.length !== 1 ? "s" : ""} (mismo {v.type === "recibida" ? "proveedor" : "cliente"}).
            {v.referenceFolioNumber && !referenceCandidates.some((c) => c.folioNumber === v.referenceFolioNumber) && (
              <span className="text-amber-700"> · folio actual {v.referenceFolioNumber} no está en la lista (factura no sincronizada todavía).</span>
            )}
          </p>
        </div>
      )}

      <div className="mt-4">
        <Field label="Notas">
          <textarea
            value={v.notes}
            onChange={(e) => set("notes", e.target.value)}
            rows={2}
            className={`${inputCls} resize-y`}
          />
        </Field>
      </div>

      {error && (
        <div className="mt-4 text-sm text-red-700 bg-red-50 border border-red-200 rounded px-3 py-2">
          {error}
        </div>
      )}

      <div className="flex items-center justify-between mt-6 pt-4 border-t border-gray-100">
        {mode === "edit" ? (
          <Button variant="danger" size="sm" onClick={remove} disabled={saving}>
            Eliminar
          </Button>
        ) : (
          <span />
        )}
        <div className="flex gap-2">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => router.push("/facturas")}
            disabled={saving}
          >
            Cancelar
          </Button>
          <Button variant="primary" size="sm" onClick={submit} disabled={saving}>
            {saving ? "Guardando…" : mode === "edit" ? "Guardar cambios" : "Crear factura"}
          </Button>
        </div>
      </div>
    </div>
  );
}

const inputCls =
  "w-full px-3 py-2 border border-gray-300 rounded text-sm bg-white focus:ring-1 focus:ring-gray-900 focus:border-gray-900 outline-none";

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      {label && (
        <label className="block text-[10px] uppercase tracking-wider text-gray-500 mb-1">
          {label}
        </label>
      )}
      {children}
    </div>
  );
}
