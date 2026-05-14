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

interface ArtefactoItem {
  id: string;
  room: string;
  subcategory: string;
  name: string;
  detail: string | null;
  brand: string | null;
  quantity: number;
  listPrice: number;
  discountPercent: number | null; // decimal 0..1 (BD)
  clientPrice: number; // unitario neto del cliente (lista x (1 - dcto))
  realCostBlarq: number | null; // unitario, costo real BLARQ
  referenceLink: string | null;
  sortOrder: number;
}

interface PaymentTerm {
  id: string;
  stage: string;
  percentage: number;
  amount: number | null;
}

interface Budget {
  id: string;
  version: string;
  observations: string | null;
  artefactoItems: ArtefactoItem[];
  paymentTerms: PaymentTerm[];
}

const ROOM_LABELS: Record<string, string> = {
  bano_principal: "Baño principal",
  bano_secundario: "Baño secundario",
  bano_visita: "Baño visita",
  cocina: "Cocina",
  lavadero: "Lavadero",
  otro: "Otro",
};

const ROOM_ORDER = [
  "bano_principal",
  "bano_secundario",
  "bano_visita",
  "cocina",
  "lavadero",
  "otro",
];

const SUBCATEGORY_LABELS: Record<string, string> = {
  sanitario: "Artefactos sanitarios",
  cocina: "Artefactos cocina",
  iluminacion: "Artefactos iluminación",
};
const SUBCATEGORY_ORDER = ["sanitario", "cocina", "iluminacion"];

const DEFAULT_PAYMENT = [
  { stage: "Anticipo", percentage: 60 },
  { stage: "Despacho", percentage: 30 },
  { stage: "Saldo", percentage: 10 },
];

// Calcula el clientPrice unitario a partir de lista y descuento decimal.
function calcClientPrice(listPrice: number, discount: number | null): number {
  return listPrice * (1 - (discount ?? 0));
}

export default function ArtefactosEditor({
  budget: initialBudget,
  projectId: _projectId,
}: {
  budget: Budget;
  projectId: string;
}) {
  const router = useRouter();
  const [items, setItems] = useState<ArtefactoItem[]>(
    initialBudget.artefactoItems
  );
  const [observations, setObservations] = useState(
    initialBudget.observations || ""
  );
  const [paymentTerms, setPaymentTerms] = useState(
    initialBudget.paymentTerms.length > 0
      ? initialBudget.paymentTerms.map((t) => ({
          stage: t.stage,
          percentage: t.percentage,
        }))
      : DEFAULT_PAYMENT
  );
  const [saving, setSaving] = useState(false);
  const [showCost, setShowCost] = useState(false);
  const [addingTo, setAddingTo] = useState<
    null | { subcategory: string; room: string }
  >(null);
  const [newItem, setNewItem] = useState({
    name: "",
    detail: "",
    brand: "",
    quantity: 1,
    listPrice: 0,
    discountPercent: 0, // 0..1 decimal en BD; el input lo trata como porcentaje 0..100
  });

  // ── Totales globales ─────────────────────────────────────────────────
  const totalCliente = items.reduce(
    (s, i) => s + i.clientPrice * i.quantity,
    0
  );
  const totalCostoBlarq = items.reduce(
    (s, i) => s + (i.realCostBlarq ?? 0) * i.quantity,
    0
  );
  const totalUtilidad = totalCliente - totalCostoBlarq;

  // ── Agrupación: subcategoría → habitación → items ────────────────────
  type RoomGroup = {
    key: string;
    label: string;
    items: ArtefactoItem[];
    subtotal: number;
    subtotalCostoBlarq: number;
  };
  type SubcatGroup = {
    key: string;
    label: string;
    rooms: RoomGroup[];
    subtotal: number;
    subtotalCostoBlarq: number;
  };

  const subcatBuckets = new Map<string, ArtefactoItem[]>();
  for (const it of items) {
    const k = it.subcategory || "sanitario";
    const arr = subcatBuckets.get(k) ?? [];
    arr.push(it);
    subcatBuckets.set(k, arr);
  }

  const subcats: SubcatGroup[] = Array.from(subcatBuckets.keys())
    .sort((a, b) => {
      const ia = SUBCATEGORY_ORDER.indexOf(a);
      const ib = SUBCATEGORY_ORDER.indexOf(b);
      return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
    })
    .map((subKey) => {
      const subItems = subcatBuckets.get(subKey) ?? [];
      const roomBuckets = new Map<string, ArtefactoItem[]>();
      for (const it of subItems) {
        const r = it.room || "otro";
        const arr = roomBuckets.get(r) ?? [];
        arr.push(it);
        roomBuckets.set(r, arr);
      }
      const rooms = Array.from(roomBuckets.keys())
        .sort((a, b) => {
          const ia = ROOM_ORDER.indexOf(a);
          const ib = ROOM_ORDER.indexOf(b);
          return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
        })
        .map((rkey) => {
          const rItems = (roomBuckets.get(rkey) ?? []).sort(
            (a, b) => a.sortOrder - b.sortOrder
          );
          const subtotal = rItems.reduce(
            (s, it) => s + it.clientPrice * it.quantity,
            0
          );
          const subtotalCostoBlarq = rItems.reduce(
            (s, it) => s + (it.realCostBlarq ?? 0) * it.quantity,
            0
          );
          return {
            key: rkey,
            label: ROOM_LABELS[rkey] ?? rkey,
            items: rItems,
            subtotal,
            subtotalCostoBlarq,
          };
        });
      const subtotal = rooms.reduce((s, r) => s + r.subtotal, 0);
      const subtotalCostoBlarq = rooms.reduce(
        (s, r) => s + r.subtotalCostoBlarq,
        0
      );
      return {
        key: subKey,
        label: SUBCATEGORY_LABELS[subKey] ?? subKey,
        rooms,
        subtotal,
        subtotalCostoBlarq,
      };
    });

  // ── Mutaciones ───────────────────────────────────────────────────────
  async function persistItem(item: ArtefactoItem) {
    try {
      await fetch(
        `/api/presupuestos/${initialBudget.id}/artefactos/${item.id}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(item),
        }
      );
    } catch {
      /* silent — se reintenta al guardar todo */
    }
  }

  function updateItem(itemId: string, patch: Partial<ArtefactoItem>) {
    setItems((prev) =>
      prev.map((it) => {
        if (it.id !== itemId) return it;
        const merged = { ...it, ...patch };
        // Si cambiaron lista o descuento → recalcular clientPrice unitario.
        if (
          patch.listPrice !== undefined ||
          patch.discountPercent !== undefined
        ) {
          merged.clientPrice = calcClientPrice(
            merged.listPrice,
            merged.discountPercent
          );
        }
        persistItem(merged);
        return merged;
      })
    );
  }

  async function deleteItem(itemId: string) {
    try {
      await fetch(
        `/api/presupuestos/${initialBudget.id}/artefactos/${itemId}`,
        { method: "DELETE" }
      );
      setItems((prev) => prev.filter((i) => i.id !== itemId));
    } catch {
      alert("Error al eliminar");
    }
  }

  async function addItem(subcategory: string, room: string) {
    if (!newItem.name) return;
    const clientPrice = calcClientPrice(
      newItem.listPrice,
      newItem.discountPercent
    );
    try {
      const res = await fetch(
        `/api/presupuestos/${initialBudget.id}/artefactos`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            subcategory,
            room,
            name: newItem.name,
            detail: newItem.detail || null,
            brand: newItem.brand || null,
            quantity: newItem.quantity,
            listPrice: newItem.listPrice,
            discountPercent: newItem.discountPercent,
            clientPrice,
            realCostBlarq: null,
          }),
        }
      );
      if (!res.ok) throw new Error("Error");
      const created = await res.json();
      setItems((prev) => [...prev, created]);
      setNewItem({
        name: "",
        detail: "",
        brand: "",
        quantity: 1,
        listPrice: 0,
        discountPercent: 0,
      });
      setAddingTo(null);
    } catch {
      alert("Error al agregar artefacto");
    }
  }

  async function handleSave() {
    setSaving(true);
    try {
      await fetch(`/api/presupuestos/${initialBudget.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ observations }),
      });
      await fetch(`/api/presupuestos/${initialBudget.id}/forma-pago`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          terms: paymentTerms.map((t) => ({
            stage: t.stage,
            percentage: t.percentage,
            amount: (totalCliente * t.percentage) / 100,
          })),
        }),
      });
      router.refresh();
    } catch {
      alert("Error al guardar");
    } finally {
      setSaving(false);
    }
  }

  // ── Layout de columnas: grid igual a un thead, reaprovechable por fila.
  // En "showCost" se agregan 2 columnas extra (NETO BLARQ + UTILIDAD) que
  // NO van al PDF — solo visibles internamente.
  // OJO: las clases de Tailwind tienen que aparecer LITERALES en el código
  // para que el tree-shaking las detecte. Por eso las defino como strings
  // constantes y no las interpolo.
  const gridColsCost =
    "grid grid-cols-[minmax(0,1fr)_minmax(0,2.2fr)_minmax(0,0.7fr)_3rem_5.5rem_3rem_6rem_5.5rem_5rem_2rem]";
  const gridColsClean =
    "grid grid-cols-[minmax(0,1fr)_minmax(0,2.2fr)_minmax(0,0.7fr)_3rem_5.5rem_3rem_6rem_2rem]";
  const gridCls = showCost ? gridColsCost : gridColsClean;

  return (
    <div className="space-y-6">
      {/* Toggle costo interno — banner editorial sutil arriba de todo */}
      <div className="flex items-center justify-between">
        <label className="flex items-center gap-2 text-xs text-gray-600 cursor-pointer">
          <input
            type="checkbox"
            checked={showCost}
            onChange={(e) => setShowCost(e.target.checked)}
            className="accent-gray-900"
          />
          Mostrar columnas internas (costo BLARQ, utilidad) — no van al PDF cliente
        </label>
        <button
          onClick={handleSave}
          disabled={saving}
          className="text-sm bg-gray-900 text-white px-4 py-2 rounded-lg font-medium hover:bg-gray-800 disabled:opacity-50"
        >
          {saving ? "Guardando…" : "Guardar"}
        </button>
      </div>

      {/* Cada subcategoría es un bloque editorial cerrado */}
      {subcats.map((sub) => (
        <div
          key={sub.key}
          className="bg-white rounded-xl border border-gray-200 overflow-hidden"
        >
          {/* Banner negro con el nombre de la subcategoría */}
          <div className="bg-gray-900 text-white px-4 py-2 text-[11px] font-semibold uppercase tracking-wider">
            {sub.label}
          </div>

          {sub.rooms.map((room) => (
            <div key={room.key} className="border-b border-gray-200 last:border-b-0">
              {/* Banner del room */}
              <div className="bg-gray-100 px-4 py-1.5 text-[11px] font-bold uppercase tracking-wider text-gray-900 border-b border-gray-300">
                {room.label}
              </div>

              {/* Header de columnas */}
              <div
                className={`${gridCls} items-center gap-3 px-4 py-2 border-b border-gray-200 bg-white text-[10px] font-semibold text-gray-500 uppercase tracking-wider`}
              >
                <div>Item</div>
                <div>Detalle</div>
                <div>Marca</div>
                <div className="text-center">Cant.</div>
                <div className="text-right">P. lista</div>
                <div className="text-right">Dcto</div>
                <div className="text-right">Total</div>
                {showCost && (
                  <>
                    <div className="text-right text-red-700/80">Neto BLARQ</div>
                    <div className="text-right text-green-700/80">Utilidad</div>
                  </>
                )}
                <div></div>
              </div>

              {/* Items del room */}
              {room.items.map((item) => {
                const totalCliente = item.clientPrice * item.quantity;
                const totalCosto =
                  (item.realCostBlarq ?? 0) * item.quantity;
                const utilidad = totalCliente - totalCosto;
                return (
                  <div
                    key={item.id}
                    className={`${gridCls} items-center gap-3 px-4 py-1.5 border-b border-gray-100 last:border-b-0 text-xs hover:bg-gray-50`}
                  >
                    <input
                      type="text"
                      value={item.name}
                      onChange={(e) =>
                        updateItem(item.id, { name: e.target.value })
                      }
                      className="w-full bg-transparent border-0 p-0 font-semibold text-gray-900 outline-none focus:bg-white focus:border focus:border-gray-300 focus:rounded focus:px-1.5 focus:py-0.5"
                    />
                    <input
                      type="text"
                      value={item.detail ?? ""}
                      placeholder="modelo…"
                      onChange={(e) =>
                        updateItem(item.id, { detail: e.target.value })
                      }
                      className="w-full bg-transparent border-0 p-0 text-gray-700 outline-none focus:bg-white focus:border focus:border-gray-300 focus:rounded focus:px-1.5 focus:py-0.5"
                    />
                    <input
                      type="text"
                      value={item.brand ?? ""}
                      onChange={(e) =>
                        updateItem(item.id, { brand: e.target.value })
                      }
                      className="w-full bg-transparent border-0 p-0 text-gray-600 outline-none focus:bg-white focus:border focus:border-gray-300 focus:rounded focus:px-1.5 focus:py-0.5"
                    />
                    <input
                      type="number"
                      value={item.quantity}
                      onChange={(e) =>
                        updateItem(item.id, {
                          quantity: parseInt(e.target.value) || 1,
                        })
                      }
                      className="w-full bg-transparent border-0 p-0 text-center tabular-nums text-gray-900 outline-none focus:bg-white focus:border focus:border-gray-300 focus:rounded focus:px-1 focus:py-0.5"
                    />
                    <ThousandsInput
                      value={item.listPrice}
                      onChange={(v) => updateItem(item.id, { listPrice: v })}
                      placeholder="0"
                      className="w-full bg-transparent border-0 p-0 text-right tabular-nums text-gray-900 outline-none focus:bg-white focus:border focus:border-gray-300 focus:rounded focus:px-1 focus:py-0.5"
                    />
                    <div className="flex items-center justify-end gap-0.5">
                      <input
                        type="number"
                        step="1"
                        value={
                          item.discountPercent !== null
                            ? Math.round(item.discountPercent * 100)
                            : ""
                        }
                        placeholder="0"
                        onChange={(e) =>
                          updateItem(item.id, {
                            discountPercent:
                              (parseFloat(e.target.value) || 0) / 100,
                          })
                        }
                        className="w-8 bg-transparent border-0 p-0 text-right tabular-nums text-gray-600 outline-none focus:bg-white focus:border focus:border-gray-300 focus:rounded focus:px-1 focus:py-0.5"
                      />
                      <span className="text-gray-400">%</span>
                    </div>
                    <div className="text-right tabular-nums font-semibold text-gray-900">
                      {formatCLP(totalCliente)}
                    </div>
                    {showCost && (
                      <>
                        <ThousandsInput
                          value={item.realCostBlarq ?? 0}
                          onChange={(v) =>
                            updateItem(item.id, { realCostBlarq: v })
                          }
                          placeholder="—"
                          className="w-full bg-transparent border-0 p-0 text-right tabular-nums text-red-700 outline-none focus:bg-white focus:border focus:border-red-300 focus:rounded focus:px-1 focus:py-0.5"
                        />
                        <div
                          className={`text-right tabular-nums font-semibold ${
                            utilidad >= 0 ? "text-green-700" : "text-red-700"
                          }`}
                        >
                          {formatCLP(utilidad)}
                        </div>
                      </>
                    )}
                    <button
                      onClick={() => deleteItem(item.id)}
                      className="text-gray-300 hover:text-red-600 text-xs"
                      title="Eliminar"
                    >
                      ×
                    </button>
                  </div>
                );
              })}

              {/* Subtotal del room */}
              <div
                className={`${gridCls} items-center gap-3 px-4 py-2 bg-gray-50 border-t border-gray-900 text-xs font-semibold`}
              >
                <div className="col-span-6 text-gray-600 uppercase tracking-wider text-[10px]">
                  Total artefactos {room.label.toLowerCase()}
                </div>
                <div className="text-right tabular-nums text-gray-900">
                  {formatCLP(room.subtotal)}
                </div>
                {showCost && (
                  <>
                    <div className="text-right tabular-nums text-red-700">
                      {formatCLP(room.subtotalCostoBlarq)}
                    </div>
                    <div
                      className={`text-right tabular-nums ${
                        room.subtotal - room.subtotalCostoBlarq >= 0
                          ? "text-green-700"
                          : "text-red-700"
                      }`}
                    >
                      {formatCLP(room.subtotal - room.subtotalCostoBlarq)}
                    </div>
                  </>
                )}
                <div></div>
              </div>

              {/* Botón agregar item dentro del room */}
              {addingTo?.subcategory === sub.key &&
              addingTo?.room === room.key ? (
                <div className="bg-gray-50 px-4 py-3 border-t border-gray-200 flex flex-wrap items-end gap-3">
                  <div>
                    <label className="block text-[10px] uppercase tracking-wider text-gray-500 mb-0.5">
                      Item
                    </label>
                    <input
                      autoFocus
                      type="text"
                      value={newItem.name}
                      onChange={(e) =>
                        setNewItem({ ...newItem, name: e.target.value })
                      }
                      className="w-32 bg-white border border-gray-300 rounded px-2 py-1 text-xs outline-none focus:border-gray-500"
                    />
                  </div>
                  <div className="flex-1 min-w-[160px]">
                    <label className="block text-[10px] uppercase tracking-wider text-gray-500 mb-0.5">
                      Detalle / modelo
                    </label>
                    <input
                      type="text"
                      value={newItem.detail}
                      onChange={(e) =>
                        setNewItem({ ...newItem, detail: e.target.value })
                      }
                      className="w-full bg-white border border-gray-300 rounded px-2 py-1 text-xs outline-none focus:border-gray-500"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] uppercase tracking-wider text-gray-500 mb-0.5">
                      Marca
                    </label>
                    <input
                      type="text"
                      value={newItem.brand}
                      onChange={(e) =>
                        setNewItem({ ...newItem, brand: e.target.value })
                      }
                      className="w-24 bg-white border border-gray-300 rounded px-2 py-1 text-xs outline-none focus:border-gray-500"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] uppercase tracking-wider text-gray-500 mb-0.5">
                      Cant.
                    </label>
                    <input
                      type="number"
                      value={newItem.quantity}
                      onChange={(e) =>
                        setNewItem({
                          ...newItem,
                          quantity: parseInt(e.target.value) || 1,
                        })
                      }
                      className="w-12 bg-white border border-gray-300 rounded px-2 py-1 text-xs outline-none text-center"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] uppercase tracking-wider text-gray-500 mb-0.5">
                      P. lista
                    </label>
                    <ThousandsInput
                      value={newItem.listPrice}
                      onChange={(v) =>
                        setNewItem({ ...newItem, listPrice: v })
                      }
                      placeholder="0"
                      className="w-24 bg-white border border-gray-300 rounded px-2 py-1 text-xs tabular-nums text-right outline-none focus:border-gray-500"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] uppercase tracking-wider text-gray-500 mb-0.5">
                      % desc.
                    </label>
                    <input
                      type="number"
                      value={
                        newItem.discountPercent
                          ? Math.round(newItem.discountPercent * 100)
                          : ""
                      }
                      onChange={(e) =>
                        setNewItem({
                          ...newItem,
                          discountPercent:
                            (parseFloat(e.target.value) || 0) / 100,
                        })
                      }
                      placeholder="0"
                      className="w-12 bg-white border border-gray-300 rounded px-2 py-1 text-xs tabular-nums text-right outline-none focus:border-gray-500"
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => addItem(sub.key, room.key)}
                      disabled={!newItem.name}
                      className="text-xs bg-gray-900 text-white px-3 py-1.5 rounded hover:bg-gray-800 disabled:opacity-50"
                    >
                      Agregar
                    </button>
                    <button
                      onClick={() => setAddingTo(null)}
                      className="text-xs text-gray-500 px-2 py-1.5 hover:text-gray-900"
                    >
                      Cancelar
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  onClick={() =>
                    setAddingTo({ subcategory: sub.key, room: room.key })
                  }
                  className="px-4 py-1.5 text-xs text-gray-500 hover:text-gray-900 hover:bg-gray-50 w-full text-left border-t border-gray-100"
                >
                  + agregar artefacto en {room.label.toLowerCase()}
                </button>
              )}
            </div>
          ))}

          {/* Subtotal de subcategoría */}
          <div
            className={`${gridCls} items-center gap-3 px-4 py-2.5 bg-gray-100 border-t-2 border-gray-900 text-xs font-bold uppercase tracking-wider`}
          >
            <div className="col-span-6 text-gray-900">Total {sub.label.toLowerCase()}</div>
            <div className="text-right tabular-nums text-gray-900 text-sm">
              {formatCLP(sub.subtotal)}
            </div>
            {showCost && (
              <>
                <div className="text-right tabular-nums text-red-700">
                  {formatCLP(sub.subtotalCostoBlarq)}
                </div>
                <div
                  className={`text-right tabular-nums ${
                    sub.subtotal - sub.subtotalCostoBlarq >= 0
                      ? "text-green-700"
                      : "text-red-700"
                  }`}
                >
                  {formatCLP(sub.subtotal - sub.subtotalCostoBlarq)}
                </div>
              </>
            )}
            <div></div>
          </div>
        </div>
      ))}

      {/* Si no hay items todavía, ofrecemos arrancar */}
      {subcats.length === 0 && (
        <div className="bg-white rounded-xl border border-gray-200 p-8 text-center text-sm text-gray-500">
          No hay artefactos cargados. Importá desde un Excel o agregá manualmente.
        </div>
      )}

      {/* Total general */}
      <div className="bg-white rounded-xl border border-gray-200 px-6 py-4">
        <div className="max-w-md ml-auto space-y-1.5">
          <div className="flex justify-between text-sm">
            <span className="text-gray-600 uppercase tracking-wider text-xs">
              Total cliente
            </span>
            <span className="font-bold tabular-nums text-gray-900">
              {formatCLP(totalCliente)}
            </span>
          </div>
          {showCost && (
            <>
              <div className="flex justify-between text-xs">
                <span className="text-gray-500 uppercase tracking-wider">
                  Costo BLARQ
                </span>
                <span className="font-medium tabular-nums text-red-700">
                  {formatCLP(totalCostoBlarq)}
                </span>
              </div>
              <div className="flex justify-between text-sm font-bold border-t-2 border-gray-900 pt-2">
                <span className="text-gray-900 uppercase tracking-wider text-xs">
                  Utilidad
                </span>
                <span
                  className={`tabular-nums ${
                    totalUtilidad >= 0 ? "text-green-700" : "text-red-700"
                  }`}
                >
                  {formatCLP(totalUtilidad)}
                </span>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Forma de pago */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <h2 className="text-sm font-semibold text-gray-900 uppercase tracking-wider mb-4">
          Forma de pago
        </h2>
        <div className="space-y-2 max-w-lg">
          {paymentTerms.map((term, index) => (
            <div
              key={index}
              className="grid grid-cols-12 gap-3 items-center text-xs"
            >
              <div className="col-span-5">
                <input
                  type="text"
                  value={term.stage}
                  onChange={(e) => {
                    const u = [...paymentTerms];
                    u[index] = { ...u[index], stage: e.target.value };
                    setPaymentTerms(u);
                  }}
                  className="w-full px-2 py-1.5 border border-gray-300 rounded text-xs outline-none focus:border-gray-500"
                />
              </div>
              <div className="col-span-3">
                <div className="flex items-center gap-1">
                  <input
                    type="number"
                    value={term.percentage}
                    onChange={(e) => {
                      const u = [...paymentTerms];
                      u[index] = {
                        ...u[index],
                        percentage: parseFloat(e.target.value) || 0,
                      };
                      setPaymentTerms(u);
                    }}
                    className="w-full px-2 py-1.5 border border-gray-300 rounded text-xs outline-none text-right tabular-nums focus:border-gray-500"
                  />
                  <span className="text-gray-500">%</span>
                </div>
              </div>
              <div className="col-span-3 text-right text-gray-700 tabular-nums">
                {formatCLP((totalCliente * term.percentage) / 100)}
              </div>
              <div className="col-span-1">
                <button
                  onClick={() =>
                    setPaymentTerms(paymentTerms.filter((_, i) => i !== index))
                  }
                  className="text-gray-300 hover:text-red-600"
                >
                  ×
                </button>
              </div>
            </div>
          ))}
          <div className="flex items-center justify-between pt-2 border-t border-gray-100">
            <button
              onClick={() =>
                setPaymentTerms([
                  ...paymentTerms,
                  {
                    stage: `Etapa ${paymentTerms.length + 1}`,
                    percentage: 0,
                  },
                ])
              }
              className="text-xs text-gray-600 hover:text-gray-900 font-medium"
            >
              + agregar etapa
            </button>
            <span className="text-xs text-gray-500">
              Total:{" "}
              {paymentTerms.reduce((s, t) => s + t.percentage, 0)}%
            </span>
          </div>
        </div>
      </div>

      {/* Observaciones */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <h2 className="text-sm font-semibold text-gray-900 uppercase tracking-wider mb-4">
          Observaciones
        </h2>
        <textarea
          value={observations}
          onChange={(e) => setObservations(e.target.value)}
          rows={4}
          className="w-full px-3 py-2 border border-gray-300 rounded text-xs outline-none resize-none focus:border-gray-500"
          placeholder="Notas adicionales que se incluirán en el PDF cliente…"
        />
      </div>
    </div>
  );
}
