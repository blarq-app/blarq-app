"use client";

import { Fragment, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { formatCLP, formatDate, OBRA_CHAPTERS, ObraChapter } from "@/lib/utils";
import { annotateZones } from "@/lib/presupuesto/zones";
import {
  computeEPItem,
  validateQuantityExecuted,
  pctToQuantity,
  sumEPTotals,
  type EPItemSnapshot,
} from "@/lib/ep/calculations";
import SyncDiffModal from "./SyncDiffModal";

type Item = {
  id: string;
  obraItemId: string;
  lineageId: string;
  chapter: string;
  subChapter: string | null;
  itemNumber: string;
  name: string;
  descriptionMaestro: string | null;
  unit: string;
  quantity: number;
  laborUnitPrice: number;
  laborTotal: number;
  quantityExecuted: number;
  amountPaid: number | null;
  outOfScope: boolean;
  pctAccumulated: number;
  sortOrder: number;
};

type EP = {
  id: string;
  number: number;
  date: string;
  status: string; // borrador | cerrado
  closedAt: string | null;
  notes: string | null;
  project: {
    id: string;
    name: string;
    clientName: string;
    address: string | null;
    ufReference: number | null;
    maestro: { name: string; rut: string | null } | null;
  };
  // Maestro dueño de este EP (Opción B). null en EPs legacy de obra completa.
  maestro: { name: string; rut: string | null } | null;
  budgetVersion: { id: string; version: string; status: string } | null;
  items: Item[];
};

type PreviousEpSummary = {
  id: string;
  number: number;
  date: string;
  closedAt: string | null;
  totalPaid: number;
};

export default function EditorEP({
  ep,
  prevExecutedByLineage,
  prevAmountPaidByLineage,
  previousEps,
  latestBudgetVersion,
  hasNewerVersion,
}: {
  ep: EP;
  prevExecutedByLineage: Record<string, number>;
  prevAmountPaidByLineage: Record<string, number>;
  previousEps: PreviousEpSummary[];
  latestBudgetVersion: { id: string; version: string } | null;
  hasNewerVersion: boolean;
}) {
  const router = useRouter();
  const [items, setItems] = useState<Item[]>(ep.items);
  const [date, setDate] = useState(ep.date.split("T")[0]);
  const [notes, setNotes] = useState(ep.notes || "");
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [showSyncModal, setShowSyncModal] = useState(false);
  // input mode por item: por default es "pct" (decisión: el usuario calcula
  // el % en su cabeza y lo tipea; la cantidad ejecutada se deriva).
  const [inputMode, setInputMode] = useState<Record<string, "qty" | "pct">>({});
  // mensaje de validación por item (transient)
  const [errorByItem, setErrorByItem] = useState<Record<string, string | null>>({});

  const isClosed = ep.status === "cerrado";

  // Snapshots para los cálculos puros
  const snapshotsById = useMemo<Record<string, EPItemSnapshot>>(() => {
    const map: Record<string, EPItemSnapshot> = {};
    for (const i of items) {
      map[i.id] = {
        quantity: i.quantity,
        laborUnitPrice: i.laborUnitPrice,
        quantityExecuted: i.quantityExecuted,
        prevExecutedQuantity: prevExecutedByLineage[i.lineageId] ?? 0,
        prevAmountPaid: prevAmountPaidByLineage[i.lineageId] ?? 0,
        outOfScope: i.outOfScope,
      };
    }
    return map;
  }, [items, prevExecutedByLineage, prevAmountPaidByLineage]);

  // Totales del EP
  const totals = useMemo(
    () => sumEPTotals(Object.values(snapshotsById)),
    [snapshotsById]
  );
  const totalAccumulatedAllPriorClosedEps = previousEps.reduce(
    (s, p) => s + p.totalPaid,
    0
  );

  const grouped = useMemo(() => {
    const g: Record<string, Item[]> = {};
    items.forEach((i) => {
      g[i.chapter] = g[i.chapter] || [];
      g[i.chapter].push(i);
    });
    // Orden dentro del capítulo: por sortOrder (el orden manual de MJ en la
    // cotización), igual que el editor de presupuesto y el PDF — NO alfabético.
    for (const k of Object.keys(g)) {
      g[k].sort((a, b) => a.sortOrder - b.sortOrder);
    }
    return g;
  }, [items]);
  const chapterKeys = Object.keys(OBRA_CHAPTERS) as ObraChapter[];
  const orderedChapters = chapterKeys.filter((c) => grouped[c]?.length);
  // Zona efectiva por partida (derivada por posición, mismo helper que la
  // cotización y el PDF). Map chapter -> filas alineadas con grouped[chapter].
  const zoneRowsByChapter = useMemo(() => {
    const m: Record<
      string,
      { item: Item; zone: string | null; isZoneStart: boolean }[]
    > = {};
    for (const k of Object.keys(grouped)) {
      m[k] = annotateZones(
        grouped[k].map((i) => ({ ...i, total: i.laborTotal }))
      ).rows;
    }
    return m;
  }, [grouped]);

  // ── Edición ───────────────────────────────────────────────────────────
  function tryUpdateQty(id: string, newQty: number) {
    const item = items.find((i) => i.id === id);
    if (!item || isClosed || item.outOfScope) return;
    const snap = snapshotsById[id];
    const err = validateQuantityExecuted(newQty, {
      prevExecutedQuantity: snap.prevExecutedQuantity,
      quantity: snap.quantity,
      outOfScope: snap.outOfScope,
    });
    if (err) {
      setErrorByItem((m) => ({ ...m, [id]: err }));
      // Limpiar mensaje a los 5s
      setTimeout(
        () => setErrorByItem((m) => ({ ...m, [id]: null })),
        5000
      );
      return;
    }
    setItems((prev) =>
      prev.map((i) =>
        i.id === id
          ? {
              ...i,
              quantityExecuted: newQty,
              pctAccumulated:
                i.quantity > 0 ? (newQty / i.quantity) * 100 : 0,
            }
          : i
      )
    );
    setErrorByItem((m) => ({ ...m, [id]: null }));
    setDirty(true);
  }

  function setMode(id: string, mode: "qty" | "pct") {
    setInputMode((m) => ({ ...m, [id]: mode }));
  }

  // ── Guardado / Cierre / Sync ──────────────────────────────────────────
  async function save() {
    setSaving(true);
    try {
      const res = await fetch(`/api/estados-pago/${ep.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          date,
          notes,
          items: items.map((i) => ({
            id: i.id,
            quantityExecuted: i.quantityExecuted,
            pctAccumulated: i.pctAccumulated,
            descriptionMaestro: i.descriptionMaestro,
          })),
        }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        alert(j.error || "Error al guardar");
        return false;
      }
      setDirty(false);
      router.refresh();
      return true;
    } finally {
      setSaving(false);
    }
  }

  async function openSyncModal() {
    if (dirty) {
      const ok = await save();
      if (!ok) return;
    }
    setShowSyncModal(true);
  }

  async function closeEp() {
    if (dirty) {
      const ok = await save();
      if (!ok) return;
    }
    if (
      !confirm(
        "¿Cerrar este EP?\n\n" +
          "Al cerrarlo, las cantidades ejecutadas quedarán bloqueadas y servirán de base para el siguiente EP. El monto pagado de cada partida se congela como snapshot histórico.\n\n" +
          "Esta acción no se puede deshacer fácilmente."
      )
    )
      return;
    setSaving(true);
    try {
      const res = await fetch(`/api/estados-pago/${ep.id}/close`, {
        method: "POST",
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        alert(j.error || "Error al cerrar");
        return;
      }
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  async function openPdf() {
    if (dirty) {
      const ok = await save();
      if (!ok) return;
    }
    window.open(`/api/estados-pago/${ep.id}/pdf?variant=maestro`, "_blank");
  }

  async function handleDelete() {
    if (!confirm(`¿Eliminar EP #${ep.number}?`)) return;
    const res = await fetch(`/api/estados-pago/${ep.id}`, { method: "DELETE" });
    if (res.ok) router.push(`/proyectos/${ep.project.id}/estados-pago`);
  }

  // ── Render ────────────────────────────────────────────────────────────
  return (
    <div className="space-y-6">
      {/* HEADER — datos del proyecto + EP */}
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-4">
          {/* Columna izquierda */}
          <div className="space-y-3">
            <Field label="Mandante" value={ep.project.clientName} />
            <Field label="Proyecto" value={ep.project.name} />
            <Field label="Dirección" value={ep.project.address || "—"} />
          </div>
          {/* Columna derecha */}
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-4">
              <Field
                label="Fecha"
                editable={!isClosed}
                inputType="date"
                value={date}
                onChange={(v) => {
                  setDate(v);
                  setDirty(true);
                }}
              />
              <Field
                label="Versión presupuesto"
                value={ep.budgetVersion?.version ?? "—"}
                badge={
                  hasNewerVersion && latestBudgetVersion
                    ? `⚠ ${latestBudgetVersion.version} disponible`
                    : null
                }
              />
            </div>
            <Field
              label="Maestro"
              value={
                ep.maestro?.name ||
                ep.project.maestro?.name ||
                "— Sin asignar —"
              }
            />
            <div className="flex items-center justify-between">
              <Field
                label="Estado"
                value=""
                rawValue={
                  <span
                    className={`inline-block text-[10px] uppercase tracking-wider px-2 py-0.5 rounded ${
                      isClosed
                        ? "bg-gray-900 text-white"
                        : "bg-gray-100 text-gray-700"
                    }`}
                  >
                    {ep.status}
                  </span>
                }
              />
              {ep.project.ufReference != null && (
                <Field
                  label="Valor UF"
                  value={formatCLP(ep.project.ufReference)}
                />
              )}
            </div>
          </div>
        </div>

        {/* Acciones */}
        <div className="flex items-center justify-end gap-2 mt-5 pt-4 border-t border-gray-100">
          {hasNewerVersion && !isClosed && (
            <button
              onClick={openSyncModal}
              disabled={saving}
              className="text-xs px-3 py-1.5 rounded border border-amber-300 bg-amber-50 text-amber-800 hover:border-amber-500"
            >
              Sincronizar con {latestBudgetVersion?.version}
            </button>
          )}
          {!isClosed && (
            <button
              onClick={save}
              disabled={saving || !dirty}
              className="text-xs px-3 py-1.5 rounded border border-gray-300 hover:bg-gray-50 disabled:opacity-50"
            >
              {saving ? "Guardando…" : dirty ? "Guardar cambios" : "Guardado"}
            </button>
          )}
          <button
            onClick={openPdf}
            disabled={saving}
            className="text-xs px-3 py-1.5 rounded border border-gray-300 hover:bg-gray-50"
          >
            Exportar PDF
          </button>
          {!isClosed && (
            <button
              onClick={closeEp}
              disabled={saving}
              className="text-xs px-3 py-1.5 rounded bg-gray-900 text-white hover:bg-gray-700"
            >
              Cerrar EP
            </button>
          )}
          {!isClosed && (
            <button
              onClick={handleDelete}
              disabled={saving}
              className="text-xs px-3 py-1.5 rounded text-red-500 hover:text-red-700"
            >
              Eliminar
            </button>
          )}
        </div>
      </div>

      {/* TABLA DE PARTIDAS */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        {/* Headers */}
        <div className="grid grid-cols-[3rem_minmax(0,3fr)_3rem_5rem_5.5rem_6rem_8rem_6.5rem] items-center gap-2 px-4 py-2 border-y-2 border-gray-900 bg-white text-[10px] font-bold text-gray-900 uppercase tracking-wider">
          <div className="text-center">Item</div>
          <div className="text-left">Partida + Descripción</div>
          <div className="text-center">Un.</div>
          <div className="text-right">Cant. total</div>
          <div className="text-right">P.U MO</div>
          <div className="text-right">Total MO</div>
          <div className="text-right">Avance</div>
          <div className="text-right">$ acumulado</div>
        </div>

        {orderedChapters.map((chapter, chIdx) => {
          const chItems = grouped[chapter];
          // Número de capítulo reflowado (1, 2, 3… saltando vacíos), igual que
          // la cotización y el PDF.
          const chapterNumber = chIdx + 1;
          const zoneRows = zoneRowsByChapter[chapter] ?? [];
          const chSubtotal = chItems.reduce((sum, i) => {
            const c = computeEPItem(snapshotsById[i.id]);
            return sum + c.amountThisEp;
          }, 0);
          return (
            <Fragment key={chapter}>
              {/* Chapter row */}
              <div className="flex items-center justify-between px-4 py-1.5 bg-[#DBDBDB]">
                <h3 className="font-bold text-gray-900 text-xs uppercase tracking-wide">
                  <span className="inline-block w-6">
                    {chapterNumber}
                  </span>
                  {OBRA_CHAPTERS[chapter].label}
                </h3>
                <span className="text-[11px] text-gray-700 tabular-nums">
                  Subtotal capítulo {formatCLP(chSubtotal)}
                </span>
              </div>
              {chItems.map((i, idx) => {
                const snap = snapshotsById[i.id];
                const c = computeEPItem(snap);
                const mode = inputMode[i.id] ?? "pct";
                const err = errorByItem[i.id];
                // Zona efectiva (derivada por posición): el encabezado va en la
                // primera partida de cada zona.
                const zoneRow = zoneRows[idx];
                const zone = zoneRow?.zone ?? null;
                const showSub = zoneRow?.isZoneStart ?? false;
                return (
                  <Fragment key={i.id}>
                  {showSub && (
                    <div className="px-4 py-1 bg-[#F2F2F2] text-[11px] font-semibold italic uppercase tracking-wide text-gray-600 border-b border-gray-200">
                      {zone}
                    </div>
                  )}
                  <div
                    className={`grid grid-cols-[3rem_minmax(0,3fr)_3rem_5rem_5.5rem_6rem_8rem_6.5rem] items-center gap-2 px-4 py-1 border-b border-gray-100 ${
                      i.outOfScope ? "bg-amber-50/40" : ""
                    } ${c.warningExceedsTotal ? "bg-amber-50" : ""}`}
                  >
                    <div className="text-center text-xs text-gray-700 tabular-nums pt-0.5">
                      {chapterNumber}.{idx + 1}
                    </div>
                    {/* Partida + descripción */}
                    <div className="min-w-0">
                      <div className="text-xs uppercase font-medium text-gray-900 leading-tight">
                        {i.name}
                        {i.outOfScope && (
                          <span className="ml-2 text-[9px] uppercase px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 tracking-wider">
                            Fuera de alcance
                          </span>
                        )}
                      </div>
                      {i.descriptionMaestro ? (
                        <div className="text-[11px] text-gray-500 leading-snug mt-0.5 whitespace-pre-wrap">
                          {i.descriptionMaestro}
                        </div>
                      ) : (
                        <div className="text-[11px] text-gray-300 mt-0.5">—</div>
                      )}
                    </div>
                    <div className="text-center pt-0.5">
                      <span className="text-[10px] text-gray-600 bg-gray-100 px-1.5 py-0.5 rounded">
                        {i.unit}
                      </span>
                    </div>
                    <div className="text-right text-xs text-gray-700 tabular-nums pt-0.5">
                      {fmtNum(i.quantity)}
                    </div>
                    <div className="text-right text-xs text-gray-700 tabular-nums pt-0.5">
                      {formatCLP(i.laborUnitPrice)}
                    </div>
                    <div className="text-right text-xs text-gray-700 tabular-nums pt-0.5">
                      {formatCLP(c.totalMo)}
                    </div>
                    {/* AVANCE — input editable: % primario, cantidad como hint */}
                    <div className="text-right">
                      {isClosed || i.outOfScope ? (
                        <div className="text-xs tabular-nums text-gray-700 pt-0.5">
                          <div className="font-medium">
                            {c.pctAccumulatedCurrent.toFixed(0)}%
                          </div>
                          <div className="text-[10px] text-gray-400">
                            {fmtNum(i.quantityExecuted)} {i.unit.toLowerCase()}
                          </div>
                        </div>
                      ) : (
                        <div>
                          <div className="flex items-center gap-1 justify-end leading-none">
                            {mode === "pct" ? (
                              <>
                                <input
                                  type="number"
                                  step="1"
                                  min={0}
                                  max={100}
                                  value={Number(c.pctAccumulatedCurrent.toFixed(2))}
                                  onFocus={(e) => e.currentTarget.select()}
                                  onChange={(e) => {
                                    const pct = parseFloat(e.target.value) || 0;
                                    tryUpdateQty(i.id, pctToQuantity(pct, i.quantity));
                                  }}
                                  className="w-12 border border-gray-300 rounded px-1 py-0.5 text-right text-xs tabular-nums bg-gray-50/40 focus:bg-white focus:ring-1 focus:ring-gray-900 outline-none"
                                />
                                <span className="text-[10px] text-gray-500">%</span>
                                <button
                                  onClick={() => setMode(i.id, "qty")}
                                  className="text-[10px] text-gray-300 hover:text-gray-600 tabular-nums leading-none"
                                  title={`Cambiar a cantidad — equivale a ${fmtNum(i.quantityExecuted)} ${i.unit.toLowerCase()}`}
                                >
                                  ({fmtNum(i.quantityExecuted)})
                                </button>
                              </>
                            ) : (
                              <>
                                <input
                                  type="number"
                                  step="0.01"
                                  value={i.quantityExecuted}
                                  onFocus={(e) => e.currentTarget.select()}
                                  onChange={(e) =>
                                    tryUpdateQty(i.id, parseFloat(e.target.value) || 0)
                                  }
                                  className="w-14 border border-gray-300 rounded px-1 py-0.5 text-right text-xs tabular-nums bg-gray-50/40 focus:bg-white focus:ring-1 focus:ring-gray-900 outline-none"
                                />
                                <button
                                  onClick={() => setMode(i.id, "pct")}
                                  className="text-[10px] text-gray-300 hover:text-gray-600 tabular-nums leading-none"
                                  title="Cambiar a %"
                                >
                                  ({c.pctAccumulatedCurrent.toFixed(0)}%)
                                </button>
                              </>
                            )}
                          </div>
                          {err && (
                            <div className="text-[10px] text-red-600 leading-tight mt-0.5">
                              {err}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                    {/* $ ACUMULADO — total pagado/pagable por esta partida hasta este EP */}
                    <div className="text-right text-xs tabular-nums pt-0.5">
                      <div className="font-medium text-gray-900">
                        {formatCLP(c.totalAccumulated)}
                      </div>
                      {c.amountThisEp > 0 && (
                        <div className="text-[10px] text-green-700 leading-tight">
                          +{formatCLP(c.amountThisEp)} este EP
                        </div>
                      )}
                    </div>
                  </div>
                  </Fragment>
                );
              })}
            </Fragment>
          );
        })}
      </div>

      {/* RESUMEN AL PIE */}
      <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
        <div className="flex items-baseline justify-between">
          <span className="text-[10px] uppercase tracking-wider text-gray-500">
            Total mano de obra ({ep.budgetVersion?.version ?? "—"})
          </span>
          <span className="text-sm tabular-nums font-medium text-gray-900">
            {formatCLP(totals.totalMoBudget)}
          </span>
        </div>

        {/* Histórico de pagos por EP (deltas reales) */}
        <div className="border-t border-gray-100 pt-3">
          <div className="text-[10px] uppercase tracking-wider text-gray-500 mb-2">
            Pagos por estado de pago
          </div>
          <table className="w-full text-xs">
            <tbody>
              {previousEps.map((p) => (
                <tr key={p.id} className="border-b border-gray-50">
                  <td className="py-1 text-gray-700">EP #{p.number}</td>
                  <td className="py-1 text-gray-500">
                    {formatDate(new Date(p.closedAt ?? p.date))}
                  </td>
                  <td className="py-1 text-gray-500">Cerrado</td>
                  <td className="py-1 text-right tabular-nums text-gray-700">
                    +{formatCLP(p.totalPaid)}
                  </td>
                </tr>
              ))}
              {/* Este EP */}
              <tr className="border-b border-gray-50 bg-green-50/30">
                <td className="py-1.5 text-gray-900 font-medium">
                  EP #{ep.number}
                </td>
                <td className="py-1.5 text-gray-500">
                  {formatDate(new Date(ep.date))}
                </td>
                <td className="py-1.5 text-gray-700 italic">
                  {isClosed ? "Cerrado" : "Este EP (borrador)"}
                </td>
                <td className="py-1.5 text-right tabular-nums text-green-700 font-medium">
                  +{formatCLP(totals.totalAmountThisEp)}
                </td>
              </tr>
              <tr>
                <td colSpan={3} className="py-2 text-[10px] uppercase tracking-wider text-gray-700 font-bold">
                  Total acumulado pagado al maestro
                </td>
                <td className="py-2 text-right tabular-nums font-bold text-gray-900 text-sm">
                  {formatCLP(totalAccumulatedAllPriorClosedEps + totals.totalAmountThisEp)}
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        {/* Saldo */}
        <div className="flex items-baseline justify-between text-xs text-gray-500 border-t border-gray-100 pt-3">
          <span>Saldo por pagar al cerrar este EP (referencial)</span>
          <span className="tabular-nums">
            {formatCLP(
              totals.totalMoBudget -
                totalAccumulatedAllPriorClosedEps -
                totals.totalAmountThisEp
            )}
          </span>
        </div>

        {/* Notas */}
        <div className="border-t border-gray-100 pt-3">
          <label className="text-[10px] uppercase tracking-wider text-gray-500 block mb-1">
            Notas
          </label>
          <textarea
            value={notes}
            onChange={(e) => {
              setNotes(e.target.value);
              setDirty(true);
            }}
            disabled={isClosed}
            rows={2}
            className="w-full border border-gray-300 rounded px-2 py-1.5 text-xs resize-y disabled:bg-gray-50 disabled:text-gray-500 focus:ring-1 focus:ring-gray-900 outline-none"
          />
        </div>
      </div>

      {showSyncModal && (
        <SyncDiffModal
          epId={ep.id}
          onClose={() => setShowSyncModal(false)}
          onApplied={() => {
            setShowSyncModal(false);
            router.refresh();
          }}
        />
      )}
    </div>
  );
}

// ─── helpers ───────────────────────────────────────────────────────────────
function fmtNum(n: number): string {
  return new Intl.NumberFormat("es-CL", {
    maximumFractionDigits: 2,
  }).format(n);
}

function Field({
  label,
  value,
  rawValue,
  editable,
  inputType,
  onChange,
  badge,
}: {
  label: string;
  value: string;
  rawValue?: React.ReactNode;
  editable?: boolean;
  inputType?: string;
  onChange?: (v: string) => void;
  badge?: string | null;
}) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-gray-500">
        {label}
        {badge && (
          <span className="ml-2 inline-block text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 normal-case font-normal">
            {badge}
          </span>
        )}
      </div>
      {editable ? (
        <input
          type={inputType ?? "text"}
          value={value}
          onChange={(e) => onChange?.(e.target.value)}
          className="text-sm text-gray-900 bg-transparent border-0 p-0 focus:ring-0 outline-none"
        />
      ) : rawValue !== undefined ? (
        rawValue
      ) : (
        <p className="text-sm text-gray-900 mt-0.5">{value}</p>
      )}
    </div>
  );
}
