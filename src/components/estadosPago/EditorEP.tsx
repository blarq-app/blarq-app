"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { formatCLP, formatDate, OBRA_CHAPTERS, ObraChapter } from "@/lib/utils";

type Item = {
  id: string;
  obraItemId: string;
  chapter: string;
  itemNumber: string;
  name: string;
  unit: string;
  quantity: number;
  laborUnitPrice: number;
  laborTotal: number;
  pctAccumulated: number;
  sortOrder: number;
};

type EP = {
  id: string;
  number: number;
  date: string;
  status: string;
  notes: string | null;
  project: { id: string; name: string; maestro: { name: string } | null };
  items: Item[];
};

export default function EditorEP({
  ep,
  prevPaidAccum,
}: {
  ep: EP;
  prevPaidAccum: Record<string, number>;
}) {
  const router = useRouter();
  const [items, setItems] = useState<Item[]>(ep.items);
  const [status, setStatus] = useState(ep.status);
  const [date, setDate] = useState(ep.date.split("T")[0]);
  const [notes, setNotes] = useState(ep.notes || "");
  const [saving, setSaving] = useState(false);
  const [showPrices, setShowPrices] = useState(true);
  const [dirty, setDirty] = useState(false);

  const setPct = (id: string, v: number) => {
    const clamped = Math.max(0, Math.min(100, Number(v) || 0));
    setItems((prev) =>
      prev.map((i) => (i.id === id ? { ...i, pctAccumulated: clamped } : i))
    );
    setDirty(true);
  };

  const totals = useMemo(() => {
    let accum = 0;
    let prevAccum = 0;
    items.forEach((i) => {
      accum += (i.laborTotal * i.pctAccumulated) / 100;
      prevAccum += (i.laborTotal * (prevPaidAccum[i.obraItemId] || 0)) / 100;
    });
    return {
      accum,
      prevAccum,
      thisEp: accum - prevAccum,
      budget: items.reduce((s, i) => s + i.laborTotal, 0),
    };
  }, [items, prevPaidAccum]);

  const grouped = useMemo(() => {
    const g: Record<string, Item[]> = {};
    items.forEach((i) => {
      g[i.chapter] = g[i.chapter] || [];
      g[i.chapter].push(i);
    });
    return g;
  }, [items]);

  async function save() {
    setSaving(true);
    try {
      const res = await fetch(`/api/estados-pago/${ep.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status,
          date,
          notes,
          items: items.map((i) => ({
            id: i.id,
            pctAccumulated: i.pctAccumulated,
          })),
        }),
      });
      if (!res.ok) {
        alert("Error al guardar");
        return false;
      }
      setDirty(false);
      router.refresh();
      return true;
    } finally {
      setSaving(false);
    }
  }

  async function syncWithBudget() {
    if (dirty) {
      const ok = await save();
      if (!ok) return;
    }
    if (
      !confirm(
        "Sincronizar este EP con el presupuesto de obra actual?\n\n" +
          "Se actualizarán los precios de MO, cantidades y partidas nuevas/eliminadas.\n" +
          "Los % de avance que ya ingresaste se mantienen."
      )
    )
      return;
    setSaving(true);
    try {
      const res = await fetch(`/api/estados-pago/${ep.id}/sync`, {
        method: "POST",
      });
      if (!res.ok) {
        alert("Error al sincronizar");
        return;
      }
      const data = await res.json();
      alert(
        `Sincronizado.\n+${data.added} partidas nuevas\n~${data.updated} actualizadas\n-${data.removed} eliminadas`
      );
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  async function openPdf(variant: "maestro" | "interno") {
    if (dirty) {
      const ok = await save();
      if (!ok) return;
    }
    window.open(
      `/api/estados-pago/${ep.id}/pdf?variant=${variant}`,
      "_blank"
    );
  }

  async function handleDelete() {
    if (!confirm(`¿Eliminar EP #${ep.number}?`)) return;
    const res = await fetch(`/api/estados-pago/${ep.id}`, { method: "DELETE" });
    if (res.ok) router.push(`/proyectos/${ep.project.id}/estados-pago`);
  }

  const chapterKeys = Object.keys(OBRA_CHAPTERS) as ObraChapter[];
  const orderedChapters = chapterKeys.filter((c) => grouped[c]?.length);

  return (
    <div className="space-y-6">
      {/* Cabecera */}
      <div className="bg-white rounded-xl border border-gray-200 p-5 grid grid-cols-1 md:grid-cols-4 gap-4">
        <div>
          <label className="text-xs text-gray-500">Fecha</label>
          <input
            type="date"
            value={date}
            onChange={(e) => {
              setDate(e.target.value);
              setDirty(true);
            }}
            className="w-full border border-gray-300 rounded px-2 py-1 text-sm mt-1"
          />
        </div>
        <div>
          <label className="text-xs text-gray-500">Estado</label>
          <select
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              setDirty(true);
            }}
            className="w-full border border-gray-300 rounded px-2 py-1 text-sm mt-1"
          >
            <option value="borrador">Borrador</option>
            <option value="enviado">Enviado</option>
            <option value="pagado">Pagado</option>
          </select>
        </div>
        <div>
          <label className="text-xs text-gray-500">Maestro</label>
          <p className="text-sm text-gray-900 mt-1.5">
            {ep.project.maestro?.name || "— Sin asignar —"}
          </p>
        </div>
        <div className="flex items-end">
          <label className="text-sm text-gray-700 flex items-center gap-2">
            <input
              type="checkbox"
              checked={showPrices}
              onChange={(e) => setShowPrices(e.target.checked)}
            />
            Mostrar precios (vista interna)
          </label>
        </div>
      </div>

      {/* Tabla de partidas */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-200 text-xs uppercase text-gray-500">
            <tr>
              <th className="px-3 py-2 text-left">Item</th>
              <th className="px-3 py-2 text-left">Partida</th>
              <th className="px-3 py-2 text-center">Un</th>
              <th className="px-3 py-2 text-right">Cant.</th>
              {showPrices && (
                <>
                  <th className="px-3 py-2 text-right">P.U MO</th>
                  <th className="px-3 py-2 text-right">Total MO</th>
                </>
              )}
              <th className="px-3 py-2 text-right">% acum</th>
              {showPrices && (
                <>
                  <th className="px-3 py-2 text-right">Acumulado $</th>
                  <th className="px-3 py-2 text-right">A pagar este EP</th>
                </>
              )}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {orderedChapters.map((chapter) => (
              <>
                <tr key={`h-${chapter}`} className="bg-gray-50">
                  <td
                    colSpan={showPrices ? 9 : 5}
                    className="px-3 py-2 text-xs font-semibold text-gray-700 uppercase"
                  >
                    {OBRA_CHAPTERS[chapter].index}. {OBRA_CHAPTERS[chapter].label}
                  </td>
                </tr>
                {grouped[chapter].map((i) => {
                  const accum = (i.laborTotal * i.pctAccumulated) / 100;
                  const prevPct = prevPaidAccum[i.obraItemId] || 0;
                  const prevAccum = (i.laborTotal * prevPct) / 100;
                  const thisEp = accum - prevAccum;
                  return (
                    <tr key={i.id}>
                      <td className="px-3 py-2 text-gray-600 whitespace-nowrap">
                        {i.itemNumber}
                      </td>
                      <td className="px-3 py-2 text-gray-900">{i.name}</td>
                      <td className="px-3 py-2 text-center text-gray-600">
                        {i.unit}
                      </td>
                      <td className="px-3 py-2 text-right text-gray-700">
                        {i.quantity}
                      </td>
                      {showPrices && (
                        <>
                          <td className="px-3 py-2 text-right text-gray-700">
                            {formatCLP(i.laborUnitPrice)}
                          </td>
                          <td className="px-3 py-2 text-right text-gray-700">
                            {formatCLP(i.laborTotal)}
                          </td>
                        </>
                      )}
                      <td className="px-3 py-2 text-right">
                        <div className="inline-flex items-center gap-1">
                          <input
                            type="number"
                            min={0}
                            max={100}
                            step={1}
                            value={
                              Number.isFinite(i.pctAccumulated)
                                ? i.pctAccumulated
                                : 0
                            }
                            onFocus={(e) => e.currentTarget.select()}
                            onChange={(e) => {
                              const v = e.target.value;
                              if (v === "") return setPct(i.id, 0);
                              setPct(i.id, Number(v));
                            }}
                            className="w-16 border border-gray-300 rounded px-1 py-0.5 text-right text-sm"
                          />
                          <span className="text-xs text-gray-500">%</span>
                        </div>
                      </td>
                      {showPrices && (
                        <>
                          <td className="px-3 py-2 text-right text-gray-900 font-medium">
                            {formatCLP(accum)}
                          </td>
                          <td className="px-3 py-2 text-right text-green-700 font-medium">
                            {formatCLP(thisEp)}
                          </td>
                        </>
                      )}
                    </tr>
                  );
                })}
              </>
            ))}
          </tbody>
          {showPrices && (
            <tfoot className="bg-gray-50 border-t border-gray-200 font-medium text-gray-900">
              <tr>
                <td colSpan={5} className="px-3 py-2 text-right">
                  Totales:
                </td>
                <td className="px-3 py-2 text-right">
                  {formatCLP(totals.budget)}
                </td>
                <td></td>
                <td className="px-3 py-2 text-right">
                  {formatCLP(totals.accum)}
                </td>
                <td className="px-3 py-2 text-right text-green-700">
                  {formatCLP(totals.thisEp)}
                </td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      {/* Resumen */}
      {showPrices && (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <p className="text-xs text-gray-500">MO Presupuestada</p>
            <p className="text-lg font-semibold text-gray-900">
              {formatCLP(totals.budget)}
            </p>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <p className="text-xs text-gray-500">Acumulado total</p>
            <p className="text-lg font-semibold text-gray-900">
              {formatCLP(totals.accum)}
            </p>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <p className="text-xs text-gray-500">Pagado en EPs anteriores</p>
            <p className="text-lg font-semibold text-gray-700">
              {formatCLP(totals.prevAccum)}
            </p>
          </div>
          <div className="bg-green-50 rounded-xl border border-green-200 p-4">
            <p className="text-xs text-green-700">A pagar este EP</p>
            <p className="text-lg font-semibold text-green-900">
              {formatCLP(totals.thisEp)}
            </p>
          </div>
        </div>
      )}

      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <label className="text-xs text-gray-500">Notas</label>
        <textarea
          value={notes}
          onChange={(e) => {
            setNotes(e.target.value);
            setDirty(true);
          }}
          rows={3}
          className="w-full border border-gray-300 rounded px-2 py-1 text-sm mt-1"
        />
      </div>

      <div className="flex items-center justify-between">
        <button
          onClick={handleDelete}
          className="text-sm text-red-600 hover:underline"
        >
          Eliminar EP
        </button>
        <div className="flex items-center gap-3">
          <button
            onClick={syncWithBudget}
            disabled={saving}
            className="text-sm border border-gray-300 text-gray-700 px-3 py-2 rounded hover:bg-gray-50 disabled:opacity-50"
            title="Actualizar partidas y precios desde el presupuesto de obra"
          >
            ↻ Sincronizar con presupuesto
          </button>
          <button
            onClick={() => openPdf("maestro")}
            disabled={saving}
            className="text-sm border border-gray-300 text-gray-700 px-3 py-2 rounded hover:bg-gray-50 disabled:opacity-50"
          >
            PDF maestro
          </button>
          <button
            onClick={() => openPdf("interno")}
            disabled={saving}
            className="text-sm border border-gray-300 text-gray-700 px-3 py-2 rounded hover:bg-gray-50 disabled:opacity-50"
          >
            PDF interno
          </button>
          <button
            onClick={save}
            disabled={saving || !dirty}
            className="bg-gray-900 text-white px-4 py-2 rounded text-sm font-medium hover:bg-gray-800 disabled:opacity-50"
          >
            {saving ? "Guardando..." : dirty ? "Guardar" : "Guardado"}
          </button>
        </div>
      </div>
    </div>
  );
}
