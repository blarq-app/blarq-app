"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { formatCLP, formatNumber } from "@/lib/utils";

// Input numérico con separadores de miles. Sin foco muestra "5.488.460",
// con foco muestra "5488460" para edición. onChange devuelve el número crudo.
function ThousandsInput({
  value,
  onChange,
  className = "",
  placeholder,
}: {
  value: number;
  onChange: (v: number) => void;
  className?: string;
  placeholder?: string;
}) {
  const [focused, setFocused] = useState(false);
  const display = focused
    ? value === 0
      ? ""
      : String(value)
    : value === 0
    ? ""
    : formatNumber(value);
  return (
    <input
      type={focused ? "number" : "text"}
      inputMode="numeric"
      value={display}
      placeholder={placeholder}
      onFocus={(e) => {
        setFocused(true);
        setTimeout(() => e.target.select(), 0);
      }}
      onBlur={() => setFocused(false)}
      onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
      className={className}
    />
  );
}

type MuebleDetail = {
  id: string;
  name: string;
  material: string;
  sortOrder: number;
};

type MuebleQuote = {
  id: string;
  supplier: string | null;
  costDistributor: number;
  utilityPercentage: number; // decimal
  clientPriceNet: number;
  clientPriceIva: number;
  notes: string | null;
  isSelected: boolean;
  sortOrder: number;
};

type MuebleItem = {
  id: string;
  itemNumber: string;
  name: string;
  descriptionGeneral: string | null;
  quantity: number;
  supplier: string | null;
  costDistributor: number;
  utilityPercentage: number; // decimal, e.g. 0.36
  clientPriceNet: number;
  clientPriceIva: number;
  sortOrder: number;
  details: MuebleDetail[];
  quotes: MuebleQuote[];
};

type MuebleChapter = {
  id: string;
  chapterNumber: number;
  name: string;
  sortOrder: number;
  items: MuebleItem[];
};

type PaymentTerm = {
  stage: string;
  percentage: number;
};

type Budget = {
  id: string;
  version: string;
  observations: string | null;
  muebleChapters: MuebleChapter[];
  paymentTerms: PaymentTerm[];
};

const DEFAULT_PAYMENT: PaymentTerm[] = [
  { stage: "Anticipo", percentage: 60 },
  { stage: "Inicio instalación", percentage: 30 },
  { stage: "Saldo", percentage: 10 },
];

export default function MueblesEditor({
  budget: initialBudget,
}: {
  budget: Budget;
  projectId: string;
}) {
  const router = useRouter();
  const budgetId = initialBudget.id;
  const [chapters, setChapters] = useState<MuebleChapter[]>(
    initialBudget.muebleChapters
  );
  const [observations, setObservations] = useState(
    initialBudget.observations || ""
  );
  const [paymentTerms, setPaymentTerms] = useState<PaymentTerm[]>(
    initialBudget.paymentTerms.length > 0
      ? initialBudget.paymentTerms
      : DEFAULT_PAYMENT
  );
  const [saving, setSaving] = useState(false);

  // ── Totales ──
  const allItems = chapters.flatMap((c) => c.items);
  const totalCostBlarq = allItems.reduce(
    (s, i) => s + i.costDistributor * i.quantity,
    0
  );
  const totalClientNet = allItems.reduce(
    (s, i) => s + i.clientPriceNet * i.quantity,
    0
  );
  const totalClientIva = allItems.reduce(
    (s, i) => s + i.clientPriceIva * i.quantity,
    0
  );
  const totalUtilidad = totalClientNet - totalCostBlarq;

  // ── Helpers de mutación local + servidor ──

  function recalc(item: Partial<MuebleItem>): Partial<MuebleItem> {
    const cost = item.costDistributor ?? 0;
    const utility = item.utilityPercentage ?? 0;
    const net = cost * (1 + utility);
    const iva = net * 1.19;
    return { clientPriceNet: net, clientPriceIva: iva };
  }

  // ── Capítulos ──
  async function addChapter() {
    const res = await fetch(`/api/presupuestos/${budgetId}/muebles/chapters`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "NUEVO CAPITULO" }),
    });
    if (!res.ok) return alert("Error al crear capítulo");
    const created: MuebleChapter = await res.json();
    setChapters([...chapters, { ...created, items: [] }]);
  }

  async function updateChapter(chapterId: string, patch: Partial<MuebleChapter>) {
    setChapters((prev) =>
      prev.map((c) => (c.id === chapterId ? { ...c, ...patch } : c))
    );
    await fetch(`/api/presupuestos/${budgetId}/muebles/chapters/${chapterId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
  }

  async function deleteChapter(chapterId: string) {
    if (!confirm("¿Eliminar este capítulo y todos sus items?")) return;
    await fetch(`/api/presupuestos/${budgetId}/muebles/chapters/${chapterId}`, {
      method: "DELETE",
    });
    setChapters((prev) => prev.filter((c) => c.id !== chapterId));
  }

  // ── Items ──
  async function addItem(chapterId: string) {
    const res = await fetch(`/api/presupuestos/${budgetId}/muebles/items`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chapterId, name: "NUEVO ITEM" }),
    });
    if (!res.ok) return alert("Error al crear item");
    const created: MuebleItem = await res.json();
    setChapters((prev) =>
      prev.map((c) =>
        c.id === chapterId
          ? { ...c, items: [...c.items, { ...created, details: [] }] }
          : c
      )
    );
  }

  async function updateItem(
    chapterId: string,
    itemId: string,
    patch: Partial<MuebleItem>
  ) {
    setChapters((prev) =>
      prev.map((c) =>
        c.id !== chapterId
          ? c
          : {
              ...c,
              items: c.items.map((i) =>
                i.id === itemId
                  ? {
                      ...i,
                      ...patch,
                      ...recalc({ ...i, ...patch }),
                    }
                  : i
              ),
            }
      )
    );
    const updated = chapters
      .find((c) => c.id === chapterId)
      ?.items.find((i) => i.id === itemId);
    if (!updated) return;
    const merged = { ...updated, ...patch, ...recalc({ ...updated, ...patch }) };
    await fetch(`/api/presupuestos/${budgetId}/muebles/items/${itemId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        itemNumber: merged.itemNumber,
        name: merged.name,
        descriptionGeneral: merged.descriptionGeneral,
        quantity: merged.quantity,
        supplier: merged.supplier,
        costDistributor: merged.costDistributor,
        utilityPercentage: merged.utilityPercentage,
      }),
    });
  }

  async function deleteItem(chapterId: string, itemId: string) {
    if (!confirm("¿Eliminar este item?")) return;
    await fetch(`/api/presupuestos/${budgetId}/muebles/items/${itemId}`, {
      method: "DELETE",
    });
    setChapters((prev) =>
      prev.map((c) =>
        c.id === chapterId ? { ...c, items: c.items.filter((i) => i.id !== itemId) } : c
      )
    );
  }

  // ── Detalles ──
  async function addDetail(chapterId: string, itemId: string) {
    const res = await fetch(`/api/presupuestos/${budgetId}/muebles/details`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ itemId, name: "COMPONENTE", material: "" }),
    });
    if (!res.ok) return alert("Error al crear componente");
    const created: MuebleDetail = await res.json();
    setChapters((prev) =>
      prev.map((c) =>
        c.id !== chapterId
          ? c
          : {
              ...c,
              items: c.items.map((i) =>
                i.id === itemId ? { ...i, details: [...i.details, created] } : i
              ),
            }
      )
    );
  }

  async function updateDetail(
    chapterId: string,
    itemId: string,
    detailId: string,
    patch: Partial<MuebleDetail>
  ) {
    setChapters((prev) =>
      prev.map((c) =>
        c.id !== chapterId
          ? c
          : {
              ...c,
              items: c.items.map((i) =>
                i.id !== itemId
                  ? i
                  : {
                      ...i,
                      details: i.details.map((d) =>
                        d.id === detailId ? { ...d, ...patch } : d
                      ),
                    }
              ),
            }
      )
    );
    await fetch(`/api/presupuestos/${budgetId}/muebles/details/${detailId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
  }

  async function deleteDetail(
    chapterId: string,
    itemId: string,
    detailId: string
  ) {
    await fetch(`/api/presupuestos/${budgetId}/muebles/details/${detailId}`, {
      method: "DELETE",
    });
    setChapters((prev) =>
      prev.map((c) =>
        c.id !== chapterId
          ? c
          : {
              ...c,
              items: c.items.map((i) =>
                i.id !== itemId
                  ? i
                  : { ...i, details: i.details.filter((d) => d.id !== detailId) }
              ),
            }
      )
    );
  }

  // ── Cotizaciones alternativas ──
  async function addQuote(chapterId: string, itemId: string) {
    const res = await fetch(`/api/presupuestos/${budgetId}/muebles/quotes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ itemId, supplier: "", costDistributor: 0, utilityPercentage: 0.30 }),
    });
    if (!res.ok) return alert("Error al agregar cotización");
    const created: MuebleQuote = await res.json();
    setChapters((prev) =>
      prev.map((c) =>
        c.id !== chapterId
          ? c
          : {
              ...c,
              items: c.items.map((i) =>
                i.id !== itemId ? i : { ...i, quotes: [...i.quotes, created] }
              ),
            }
      )
    );
  }

  async function updateQuote(
    chapterId: string,
    itemId: string,
    quoteId: string,
    patch: Partial<MuebleQuote>
  ) {
    setChapters((prev) =>
      prev.map((c) =>
        c.id !== chapterId
          ? c
          : {
              ...c,
              items: c.items.map((i) => {
                if (i.id !== itemId) return i;
                const updatedQuotes = i.quotes.map((q) => {
                  if (q.id !== quoteId) return q;
                  const cost = patch.costDistributor ?? q.costDistributor;
                  const util = patch.utilityPercentage ?? q.utilityPercentage;
                  const net = cost * (1 + util);
                  const iva = net * 1.19;
                  return {
                    ...q,
                    ...patch,
                    clientPriceNet: net,
                    clientPriceIva: iva,
                  };
                });
                // Si la quote actualizada es la activa, sincronizar item
                const active = updatedQuotes.find((q) => q.isSelected);
                if (active && active.id === quoteId) {
                  return {
                    ...i,
                    supplier: active.supplier,
                    costDistributor: active.costDistributor,
                    utilityPercentage: active.utilityPercentage,
                    clientPriceNet: active.clientPriceNet,
                    clientPriceIva: active.clientPriceIva,
                    quotes: updatedQuotes,
                  };
                }
                return { ...i, quotes: updatedQuotes };
              }),
            }
      )
    );
    await fetch(`/api/presupuestos/${budgetId}/muebles/quotes/${quoteId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
  }

  async function deleteQuote(
    chapterId: string,
    itemId: string,
    quoteId: string
  ) {
    if (
      !confirm(
        "¿Eliminar esta cotización? Si era la activa, se promueve la siguiente alternativa automáticamente."
      )
    )
      return;
    const res = await fetch(
      `/api/presupuestos/${budgetId}/muebles/quotes/${quoteId}`,
      { method: "DELETE" }
    );
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      alert(j.error || "Error al eliminar cotización");
      return;
    }
    // Update local state: drop the quote; if it was active, promote the first sibling
    setChapters((prev) =>
      prev.map((c) =>
        c.id !== chapterId
          ? c
          : {
              ...c,
              items: c.items.map((i) => {
                if (i.id !== itemId) return i;
                const removed = i.quotes.find((q) => q.id === quoteId);
                const remaining = i.quotes.filter((q) => q.id !== quoteId);
                if (removed?.isSelected && remaining.length > 0) {
                  // Promote the first sibling
                  const newActive = { ...remaining[0], isSelected: true };
                  return {
                    ...i,
                    supplier: newActive.supplier,
                    costDistributor: newActive.costDistributor,
                    utilityPercentage: newActive.utilityPercentage,
                    clientPriceNet: newActive.clientPriceNet,
                    clientPriceIva: newActive.clientPriceIva,
                    quotes: [
                      newActive,
                      ...remaining.slice(1).map((q) => ({ ...q, isSelected: false })),
                    ],
                  };
                }
                return { ...i, quotes: remaining };
              }),
            }
      )
    );
  }

  async function activateQuote(
    chapterId: string,
    itemId: string,
    quoteId: string
  ) {
    const res = await fetch(
      `/api/presupuestos/${budgetId}/muebles/quotes/${quoteId}/activate`,
      { method: "POST" }
    );
    if (!res.ok) return alert("Error al activar cotización");
    // Update local state: this quote becomes active; copy values to item denormalization
    setChapters((prev) =>
      prev.map((c) =>
        c.id !== chapterId
          ? c
          : {
              ...c,
              items: c.items.map((i) => {
                if (i.id !== itemId) return i;
                const updatedQuotes = i.quotes.map((q) => ({
                  ...q,
                  isSelected: q.id === quoteId,
                }));
                const newActive = updatedQuotes.find((q) => q.isSelected);
                if (!newActive) return i;
                return {
                  ...i,
                  supplier: newActive.supplier,
                  costDistributor: newActive.costDistributor,
                  utilityPercentage: newActive.utilityPercentage,
                  clientPriceNet: newActive.clientPriceNet,
                  clientPriceIva: newActive.clientPriceIva,
                  quotes: updatedQuotes,
                };
              }),
            }
      )
    );
  }

  // ── Guardar formas de pago + observaciones ──
  async function saveAll() {
    setSaving(true);
    try {
      await fetch(`/api/presupuestos/${budgetId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ observations }),
      });
      await fetch(`/api/presupuestos/${budgetId}/forma-pago`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          terms: paymentTerms.map((t) => ({
            stage: t.stage,
            percentage: t.percentage,
            amount: (totalClientIva * t.percentage) / 100,
          })),
        }),
      });
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Capítulos */}
      {chapters.map((ch) => (
        <ChapterBlock
          key={ch.id}
          chapter={ch}
          onUpdate={(patch) => updateChapter(ch.id, patch)}
          onDelete={() => deleteChapter(ch.id)}
          onAddItem={() => addItem(ch.id)}
          onUpdateItem={(itemId, patch) => updateItem(ch.id, itemId, patch)}
          onDeleteItem={(itemId) => deleteItem(ch.id, itemId)}
          onAddDetail={(itemId) => addDetail(ch.id, itemId)}
          onUpdateDetail={(itemId, detailId, patch) =>
            updateDetail(ch.id, itemId, detailId, patch)
          }
          onDeleteDetail={(itemId, detailId) =>
            deleteDetail(ch.id, itemId, detailId)
          }
          onAddQuote={(itemId) => addQuote(ch.id, itemId)}
          onUpdateQuote={(itemId, quoteId, patch) =>
            updateQuote(ch.id, itemId, quoteId, patch)
          }
          onDeleteQuote={(itemId, quoteId) =>
            deleteQuote(ch.id, itemId, quoteId)
          }
          onActivateQuote={(itemId, quoteId) =>
            activateQuote(ch.id, itemId, quoteId)
          }
        />
      ))}

      <button
        onClick={addChapter}
        className="text-sm text-gray-600 hover:text-gray-900 border border-dashed border-gray-300 hover:border-gray-500 px-4 py-3 rounded-lg w-full"
      >
        + Agregar capítulo (ej. Cocina, Closet dormitorio, Walk-in)
      </button>

      {/* Resumen interno */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <h2 className="text-base font-semibold text-gray-900 mb-3">
          Resumen interno
        </h2>
        <div className="max-w-md grid grid-cols-2 gap-y-1 text-sm">
          <span className="text-gray-500">Costo BLARQ (distribuidor)</span>
          <span className="text-right tabular-nums">
            {formatCLP(totalCostBlarq)}
          </span>
          <span className="text-gray-500">Precio Neto al Cliente</span>
          <span className="text-right tabular-nums">
            {formatCLP(totalClientNet)}
          </span>
          <span className="text-green-700">Utilidad</span>
          <span className="text-right tabular-nums text-green-700 font-medium">
            {formatCLP(totalUtilidad)}
          </span>
          <span className="font-bold border-t-2 border-gray-900 pt-2">
            Total al Cliente (IVA inc.)
          </span>
          <span className="text-right tabular-nums font-bold border-t-2 border-gray-900 pt-2">
            {formatCLP(totalClientIva)}
          </span>
        </div>
      </div>

      {/* Forma de pago */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <h2 className="text-base font-semibold text-gray-900 mb-3">
          Forma de pago
        </h2>
        <div className="space-y-2 max-w-lg">
          {paymentTerms.map((t, i) => (
            <div key={i} className="grid grid-cols-12 gap-2 items-center text-sm">
              <input
                type="text"
                value={t.stage}
                onChange={(e) => {
                  const next = [...paymentTerms];
                  next[i] = { ...next[i], stage: e.target.value };
                  setPaymentTerms(next);
                }}
                className="col-span-6 px-2 py-1.5 border border-gray-300 rounded outline-none focus:ring-1 focus:ring-gray-900"
              />
              <div className="col-span-3 flex items-center gap-1">
                <input
                  type="number"
                  value={t.percentage}
                  onChange={(e) => {
                    const next = [...paymentTerms];
                    next[i] = {
                      ...next[i],
                      percentage: parseFloat(e.target.value) || 0,
                    };
                    setPaymentTerms(next);
                  }}
                  className="w-full px-2 py-1.5 border border-gray-300 rounded text-right outline-none focus:ring-1 focus:ring-gray-900"
                />
                <span className="text-gray-500">%</span>
              </div>
              <span className="col-span-3 text-right text-gray-600 tabular-nums">
                {formatCLP((totalClientIva * t.percentage) / 100)}
              </span>
            </div>
          ))}
          <div className="flex justify-between pt-1 border-t border-gray-100">
            <button
              onClick={() =>
                setPaymentTerms([
                  ...paymentTerms,
                  { stage: `Etapa ${paymentTerms.length + 1}`, percentage: 0 },
                ])
              }
              className="text-xs text-gray-500 hover:text-gray-900"
            >
              + Agregar etapa
            </button>
            <span className="text-xs text-gray-500">
              Total: {paymentTerms.reduce((s, t) => s + t.percentage, 0)}%
            </span>
          </div>
        </div>
      </div>

      {/* Observaciones */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <h2 className="text-base font-semibold text-gray-900 mb-3">
          Observaciones (opcional)
        </h2>
        <textarea
          value={observations}
          onChange={(e) => setObservations(e.target.value)}
          rows={3}
          placeholder="Las observaciones generales del PDF van automáticamente. Acá podés agregar notas específicas adicionales para esta cotización."
          className="w-full px-3 py-2 border border-gray-300 rounded text-sm outline-none resize-y focus:ring-1 focus:ring-gray-900"
        />
      </div>

      <div className="flex justify-end">
        <button
          onClick={saveAll}
          disabled={saving}
          className="bg-gray-900 text-white px-6 py-2.5 rounded-lg text-sm font-medium hover:bg-gray-700 disabled:opacity-50"
        >
          {saving ? "Guardando..." : "Guardar pago + observaciones"}
        </button>
      </div>
    </div>
  );
}

// ─── Sub-componentes ───────────────────────────────────────────────

function ChapterBlock({
  chapter,
  onUpdate,
  onDelete,
  onAddItem,
  onUpdateItem,
  onDeleteItem,
  onAddDetail,
  onUpdateDetail,
  onDeleteDetail,
  onAddQuote,
  onUpdateQuote,
  onDeleteQuote,
  onActivateQuote,
}: {
  chapter: MuebleChapter;
  onUpdate: (patch: Partial<MuebleChapter>) => void;
  onDelete: () => void;
  onAddItem: () => void;
  onUpdateItem: (itemId: string, patch: Partial<MuebleItem>) => void;
  onDeleteItem: (itemId: string) => void;
  onAddDetail: (itemId: string) => void;
  onUpdateDetail: (
    itemId: string,
    detailId: string,
    patch: Partial<MuebleDetail>
  ) => void;
  onDeleteDetail: (itemId: string, detailId: string) => void;
  onAddQuote: (itemId: string) => void;
  onUpdateQuote: (
    itemId: string,
    quoteId: string,
    patch: Partial<MuebleQuote>
  ) => void;
  onDeleteQuote: (itemId: string, quoteId: string) => void;
  onActivateQuote: (itemId: string, quoteId: string) => void;
}) {
  const subtotal = chapter.items.reduce(
    (s, i) => s + i.clientPriceIva * i.quantity,
    0
  );
  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      {/* Header capítulo */}
      <div className="flex items-center gap-3 px-4 py-3 bg-[#DBDBDB]">
        <span className="font-bold text-gray-900 tabular-nums w-6">
          {chapter.chapterNumber}
        </span>
        <input
          type="text"
          value={chapter.name}
          onChange={(e) => onUpdate({ name: e.target.value.toUpperCase() })}
          className="flex-1 bg-transparent border-0 p-0 font-bold text-gray-900 uppercase tracking-wide outline-none"
        />
        <span className="text-xs text-gray-700 tabular-nums">
          Subtotal {formatCLP(subtotal)}
        </span>
        <button
          onClick={onDelete}
          className="text-gray-500 hover:text-red-600 text-sm"
          title="Eliminar capítulo"
        >
          ✕
        </button>
      </div>

      {/* Items */}
      <div className="divide-y divide-gray-100">
        {chapter.items.map((item) => (
          <ItemBlock
            key={item.id}
            item={item}
            onUpdate={(patch) => onUpdateItem(item.id, patch)}
            onDelete={() => onDeleteItem(item.id)}
            onAddDetail={() => onAddDetail(item.id)}
            onUpdateDetail={(detailId, patch) =>
              onUpdateDetail(item.id, detailId, patch)
            }
            onDeleteDetail={(detailId) => onDeleteDetail(item.id, detailId)}
            onAddQuote={() => onAddQuote(item.id)}
            onUpdateQuote={(quoteId, patch) =>
              onUpdateQuote(item.id, quoteId, patch)
            }
            onDeleteQuote={(quoteId) => onDeleteQuote(item.id, quoteId)}
            onActivateQuote={(quoteId) => onActivateQuote(item.id, quoteId)}
          />
        ))}
        <div className="p-3">
          <button
            onClick={onAddItem}
            className="text-xs text-gray-500 hover:text-gray-900"
          >
            + Agregar item al capítulo (ej. Muebles, Herrajes, Cubiertas)
          </button>
        </div>
      </div>
    </div>
  );
}

function ItemBlock({
  item,
  onUpdate,
  onDelete,
  onAddDetail,
  onUpdateDetail,
  onDeleteDetail,
  onAddQuote,
  onUpdateQuote,
  onDeleteQuote,
  onActivateQuote,
}: {
  item: MuebleItem;
  onUpdate: (patch: Partial<MuebleItem>) => void;
  onDelete: () => void;
  onAddDetail: () => void;
  onUpdateDetail: (detailId: string, patch: Partial<MuebleDetail>) => void;
  onDeleteDetail: (detailId: string) => void;
  onAddQuote: () => void;
  onUpdateQuote: (quoteId: string, patch: Partial<MuebleQuote>) => void;
  onDeleteQuote: (quoteId: string) => void;
  onActivateQuote: (quoteId: string) => void;
}) {
  const alternatives = item.quotes.filter((q) => !q.isSelected);
  const [showAlternatives, setShowAlternatives] = useState(
    alternatives.length > 0
  );
  return (
    <div className="px-4 py-3 space-y-2">
      <div className="flex items-baseline gap-3">
        <input
          type="text"
          value={item.itemNumber}
          onChange={(e) => onUpdate({ itemNumber: e.target.value })}
          className="w-12 bg-transparent border-0 p-0 text-sm font-medium tabular-nums text-gray-700 outline-none"
        />
        <input
          type="text"
          value={item.name}
          onChange={(e) => onUpdate({ name: e.target.value.toUpperCase() })}
          className="flex-1 bg-transparent border-0 p-0 text-sm font-semibold uppercase text-gray-900 outline-none"
        />
        <span className="text-xs text-gray-600 tabular-nums">
          qty:{" "}
          <input
            type="number"
            step="0.01"
            value={item.quantity}
            onChange={(e) =>
              onUpdate({ quantity: parseFloat(e.target.value) || 0 })
            }
            className="w-12 bg-transparent border-0 p-0 text-right tabular-nums outline-none"
          />
        </span>
        <span className="text-sm font-bold text-gray-900 tabular-nums w-28 text-right">
          {formatCLP(item.clientPriceIva * item.quantity)}
        </span>
        <button
          onClick={onDelete}
          className="text-gray-400 hover:text-red-600 text-sm"
        >
          ✕
        </button>
      </div>

      <input
        type="text"
        value={item.descriptionGeneral ?? ""}
        onChange={(e) => onUpdate({ descriptionGeneral: e.target.value })}
        placeholder="Descripción general (ej. SEGÚN PLANOS ARQUITECTURA)"
        className="w-full text-xs text-gray-600 bg-transparent border-0 border-b border-dashed border-gray-200 focus:border-gray-400 p-0 py-1 outline-none"
      />

      {/* Cálculo costo (interno, no va al PDF) */}
      <div className="flex items-center flex-wrap gap-x-3 gap-y-1 text-xs bg-gray-50 rounded px-2.5 py-1.5">
        <label className="flex items-center gap-1.5">
          <span className="text-gray-500">Proveedor</span>
          <input
            type="text"
            value={item.supplier ?? ""}
            onChange={(e) => onUpdate({ supplier: e.target.value })}
            className="w-28 bg-white border border-gray-200 rounded px-1.5 py-0.5 outline-none focus:ring-1 focus:ring-gray-900 font-bold text-gray-900"
          />
        </label>
        <label className="flex items-center gap-1.5">
          <span className="text-gray-500">Costo dist.</span>
          <ThousandsInput
            value={item.costDistributor}
            onChange={(v) => onUpdate({ costDistributor: v })}
            placeholder="0"
            className="w-28 bg-white border border-gray-200 rounded px-1.5 py-0.5 text-right tabular-nums outline-none focus:ring-1 focus:ring-gray-900 font-bold text-gray-900"
          />
        </label>
        <label className="flex items-center gap-1.5">
          <span className="text-gray-500">% util.</span>
          <input
            type="number"
            step="1"
            value={
              item.utilityPercentage
                ? Math.round(item.utilityPercentage * 100)
                : ""
            }
            onChange={(e) =>
              onUpdate({
                utilityPercentage: (parseFloat(e.target.value) || 0) / 100,
              })
            }
            placeholder="30"
            className="w-14 bg-white border border-gray-200 rounded px-1.5 py-0.5 text-right tabular-nums outline-none focus:ring-1 focus:ring-gray-900 font-bold text-gray-900"
          />
          <span className="text-gray-500">%</span>
        </label>
        <span className="text-gray-300">→</span>
        <span className="text-gray-500">
          Neto{" "}
          <span className="text-gray-900 font-bold tabular-nums">
            {formatCLP(item.clientPriceNet)}
          </span>
        </span>
        <span className="text-gray-300">·</span>
        <span className="text-gray-500">
          C/IVA{" "}
          <span className="text-gray-900 font-bold tabular-nums">
            {formatCLP(item.clientPriceIva)}
          </span>
        </span>
        <span className="text-gray-300">·</span>
        <span className="text-green-700 font-bold tabular-nums">
          util {formatCLP(item.clientPriceNet - item.costDistributor)}
        </span>
      </div>

      {/* Comparativa de cotizaciones */}
      <div>
        <button
          onClick={() => setShowAlternatives((v) => !v)}
          className="text-[11px] text-gray-500 hover:text-gray-900 flex items-center gap-1"
        >
          <span className="inline-block w-3">{showAlternatives ? "▾" : "▸"}</span>
          Comparar con otros proveedores
          {alternatives.length > 0 && (
            <span className="text-gray-400">
              ({alternatives.length} alternativa{alternatives.length > 1 ? "s" : ""})
            </span>
          )}
        </button>
        {showAlternatives && (
          <div className="mt-1.5 border border-gray-200 rounded overflow-hidden">
            <table className="w-full text-[11px]">
              <thead className="bg-gray-50 text-gray-500 uppercase tracking-wider text-[9.5px]">
                <tr>
                  <th className="text-left px-2 py-1 font-bold">Proveedor</th>
                  <th className="text-right px-2 py-1 font-bold w-24">Costo dist.</th>
                  <th className="text-right px-2 py-1 font-bold w-14">% util</th>
                  <th className="text-right px-2 py-1 font-bold w-24">Neto</th>
                  <th className="text-right px-2 py-1 font-bold w-24">C/IVA</th>
                  <th className="text-right px-2 py-1 font-bold w-20">Util</th>
                  <th className="px-2 py-1 w-28"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {item.quotes.map((q) => {
                  const isActive = q.isSelected;
                  // En la fila activa los valores van en negrita; en las
                  // alternativas en peso normal para que se distingan.
                  const valueWeight = isActive ? "font-bold text-gray-900" : "text-gray-700";
                  return (
                    <tr
                      key={q.id}
                      className={
                        isActive
                          ? "bg-green-50/50"
                          : "hover:bg-gray-50/50"
                      }
                    >
                      <td className="px-2 py-1">
                        <div className="flex items-center gap-1.5">
                          {isActive && (
                            <span className="text-[8px] uppercase tracking-wider px-1 py-0.5 rounded bg-green-700 text-white font-bold">
                              activa
                            </span>
                          )}
                          <input
                            type="text"
                            value={q.supplier ?? ""}
                            onChange={(e) =>
                              onUpdateQuote(q.id, { supplier: e.target.value })
                            }
                            placeholder="proveedor"
                            className={`flex-1 bg-transparent border-0 p-0 outline-none ${valueWeight}`}
                          />
                        </div>
                      </td>
                      <td className="px-2 py-1 text-right">
                        <ThousandsInput
                          value={q.costDistributor}
                          onChange={(v) =>
                            onUpdateQuote(q.id, { costDistributor: v })
                          }
                          placeholder="0"
                          className={`w-full bg-transparent border-0 p-0 text-right tabular-nums outline-none ${valueWeight}`}
                        />
                      </td>
                      <td className="px-2 py-1 text-right">
                        <input
                          type="number"
                          step="1"
                          value={
                            q.utilityPercentage
                              ? Math.round(q.utilityPercentage * 100)
                              : ""
                          }
                          onChange={(e) =>
                            onUpdateQuote(q.id, {
                              utilityPercentage:
                                (parseFloat(e.target.value) || 0) / 100,
                            })
                          }
                          placeholder="30"
                          className={`w-full bg-transparent border-0 p-0 text-right tabular-nums outline-none ${valueWeight}`}
                        />
                      </td>
                      <td className={`px-2 py-1 text-right tabular-nums ${valueWeight}`}>
                        {formatCLP(q.clientPriceNet)}
                      </td>
                      <td className={`px-2 py-1 text-right tabular-nums ${valueWeight}`}>
                        {formatCLP(q.clientPriceIva)}
                      </td>
                      <td className={`px-2 py-1 text-right tabular-nums text-green-700 ${isActive ? "font-bold" : ""}`}>
                        {formatCLP(q.clientPriceNet - q.costDistributor)}
                      </td>
                      <td className="px-2 py-1 text-right">
                        <div className="flex items-center justify-end gap-2">
                          {!isActive && (
                            <button
                              onClick={() => onActivateQuote(q.id)}
                              className="text-[10px] uppercase tracking-wider text-green-700 hover:text-green-900 font-bold border border-green-300 hover:border-green-500 rounded px-1.5 py-0.5"
                              title="Hacer esta cotización la activa (usa esta en el PDF y en totales)"
                            >
                              Activar
                            </button>
                          )}
                          <button
                            onClick={() => onDeleteQuote(q.id)}
                            className="text-gray-400 hover:text-red-600 text-sm leading-none"
                            title="Eliminar esta cotización"
                          >
                            ✕
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <div className="px-2 py-1.5 bg-gray-50 border-t border-gray-200">
              <button
                onClick={onAddQuote}
                className="text-[10px] text-gray-500 hover:text-gray-900"
              >
                + Agregar cotización de otro proveedor
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Detalles (componentes con materialidad) — emula la lista del PDF */}
      <div className="pl-6 border-l border-gray-100 space-y-0.5">
        {item.details.map((d) => (
          <div
            key={d.id}
            className="flex items-baseline gap-2 text-[11px] leading-tight"
          >
            <input
              type="text"
              value={d.name}
              onChange={(e) =>
                onUpdateDetail(d.id, { name: e.target.value.toUpperCase() })
              }
              placeholder="COMPONENTE"
              className="w-40 bg-transparent border-0 p-0 uppercase text-gray-700 outline-none tracking-tight"
            />
            <input
              type="text"
              value={d.material}
              onChange={(e) =>
                onUpdateDetail(d.id, { material: e.target.value })
              }
              placeholder="materialidad…"
              className="flex-1 bg-transparent border-0 p-0 text-gray-600 outline-none"
            />
            <button
              onClick={() => onDeleteDetail(d.id)}
              className="text-gray-300 hover:text-red-500 text-[10px]"
              title="Eliminar componente"
            >
              ✕
            </button>
          </div>
        ))}
        <button
          onClick={onAddDetail}
          className="text-[10px] text-gray-400 hover:text-gray-700 mt-0.5"
        >
          + Componente
        </button>
      </div>
    </div>
  );
}
