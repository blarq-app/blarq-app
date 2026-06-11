"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { formatCLP, formatNumber } from "@/lib/utils";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import AddArtefactoFromCatalog, {
  type ArtefactoFromCatalog,
} from "./AddArtefactoFromCatalog";
import RevisarPreciosArtefactos, {
  type ArtefactoPricePatch,
} from "./RevisarPreciosArtefactos";
import DuplicarArtefactos from "./DuplicarArtefactos";

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
  referenceLink: string | null; // URL del producto en la tienda (mk.cl, sodimac, easy)
  imageUrl: string | null; // URL de imagen (auto-extraída o pegada manual)
  catalogId: string | null; // si fue agregado desde el catálogo BLARQ
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
  projectId,
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
  const [showRevisar, setShowRevisar] = useState(false);
  const [showDuplicar, setShowDuplicar] = useState(false);
  // Modal de "Agregar del catálogo" de nivel superior (sirve también cuando
  // la cotización está vacía, donde no hay rooms con su botón "+ agregar").
  const [showAgregar, setShowAgregar] = useState(false);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

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

  // Campos que se sincronizan entre todas las copias del mismo catalogId
  // dentro del budget (mismo WC en baño principal y baño secundario =
  // datos idénticos). Incluye realCostBlarq porque la cotización de la
  // vendedora se hace por proyecto — si MJ carga el costo en una copia,
  // debe aplicarse al WC ATENAS en todos los baños del mismo proyecto.
  // (Al catálogo BLARQ global solo sube name/precio web/imagen — eso lo
  // maneja el backend, acá solo nos importa la propagación local.)
  // NO sincronizamos: quantity, room, subcategory, sortOrder.
  const SYNC_FIELDS: Array<keyof ArtefactoItem> = [
    "name",
    "detail",
    "brand",
    "listPrice",
    "discountPercent",
    "clientPrice",
    "referenceLink",
    "imageUrl",
    "realCostBlarq",
  ];

  // Campos que se copian a otros artefactos con el MISMO NOMBRE dentro
  // de la cotización (mismo producto aunque NO vengan del catálogo —
  // caso típico: WC importados de un Excel). Así MJ carga el link de un
  // "WC ATENAS" una sola vez y se completa en todos los baños.
  // NO incluye `name` (es la clave que los agrupa) ni `realCostBlarq`
  // (costo interno, puede variar por item).
  const NAME_SYNC_FIELDS: Array<keyof ArtefactoItem> = [
    "detail",
    "brand",
    "listPrice",
    "discountPercent",
    "clientPrice",
    "referenceLink",
    "imageUrl",
  ];

  function updateItem(itemId: string, patch: Partial<ArtefactoItem>) {
    setItems((prev) => {
      const target = prev.find((i) => i.id === itemId);
      if (!target) return prev;
      const merged = { ...target, ...patch };
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

      const priceRecalced =
        patch.listPrice !== undefined || patch.discountPercent !== undefined;

      // Propagación a las copias del mismo catalogId (SYNC_FIELDS).
      const catalogPatch: Partial<ArtefactoItem> = {};
      let hasCatalog = false;
      for (const k of SYNC_FIELDS) {
        if (k in patch || (k === "clientPrice" && priceRecalced)) {
          (catalogPatch as Record<string, unknown>)[k] = merged[k];
          hasCatalog = true;
        }
      }

      // Propagación a los artefactos con el mismo nombre (NAME_SYNC_FIELDS).
      const namePatch: Partial<ArtefactoItem> = {};
      let hasName = false;
      for (const k of NAME_SYNC_FIELDS) {
        if (k in patch || (k === "clientPrice" && priceRecalced)) {
          (namePatch as Record<string, unknown>)[k] = merged[k];
          hasName = true;
        }
      }

      const mergedName = merged.name.trim().toLowerCase();

      return prev.map((it) => {
        if (it.id === itemId) return merged;
        // Mismo catalogId — gana sobre el match por nombre.
        if (
          hasCatalog &&
          merged.catalogId &&
          it.catalogId === merged.catalogId
        ) {
          return { ...it, ...catalogPatch };
        }
        // Mismo nombre dentro de la cotización.
        if (
          hasName &&
          mergedName &&
          it.name.trim().toLowerCase() === mergedName
        ) {
          return { ...it, ...namePatch };
        }
        return it;
      });
    });
  }

  // Aplica los cambios de precio/imagen que vienen del modal "Revisar
  // online". Reutiliza updateItem para que cada cambio se persista en BD
  // y se propague a las copias del mismo catalogId, igual que una edición
  // manual de la celda.
  async function applyPricePatches(patches: ArtefactoPricePatch[]) {
    for (const p of patches) {
      const patch: Partial<ArtefactoItem> = {};
      if (p.listPrice !== undefined) patch.listPrice = p.listPrice;
      if (p.imageUrl !== undefined) patch.imageUrl = p.imageUrl;
      if (Object.keys(patch).length > 0) updateItem(p.itemId, patch);
    }
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

  // Arrastrar reordena DENTRO de un room (mismo ambiente y subcategoría). El
  // sortOrder es global pero el display agrupa por subcategoría→room y ordena
  // por sortOrder dentro del grupo, así que reasignar 0..n por room alcanza.
  // Persiste con el PUT por ítem (ya guarda sortOrder).
  async function onDragEndRoom(e: DragEndEvent, roomItems: ArtefactoItem[]) {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const oldIdx = roomItems.findIndex((it) => it.id === active.id);
    const newIdx = roomItems.findIndex((it) => it.id === over.id);
    if (oldIdx < 0 || newIdx < 0) return;
    const reordered = arrayMove(roomItems, oldIdx, newIdx);
    const orderMap = new Map(reordered.map((it, i) => [it.id, i]));
    // Optimista: reasigna sortOrder a los ítems de ESTE room.
    setItems((prev) =>
      prev.map((it) =>
        orderMap.has(it.id) ? { ...it, sortOrder: orderMap.get(it.id)! } : it
      )
    );
    // Persistir cada ítem movido (PUT por ítem).
    for (const it of reordered) {
      persistItem({ ...it, sortOrder: orderMap.get(it.id)! });
    }
  }

  // Agrega un item al budget desde el payload del componente
  // AddArtefactoFromCatalog (puede venir del catálogo o tipeado manual).
  async function addItemFromPayload(
    subcategory: string,
    room: string,
    payload: ArtefactoFromCatalog
  ) {
    const clientPrice = calcClientPrice(
      payload.listPrice,
      payload.discountPercent
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
            name: payload.name,
            detail: payload.detail,
            brand: payload.brand,
            quantity: payload.quantity,
            listPrice: payload.listPrice,
            discountPercent: payload.discountPercent,
            clientPrice,
            realCostBlarq: null,
            referenceLink: payload.referenceLink,
            imageUrl: payload.imageUrl,
            catalogId: payload.catalogId,
          }),
        }
      );
      if (!res.ok) throw new Error("Error");
      const created = await res.json();
      setItems((prev) => [...prev, created]);
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
    "grid grid-cols-[5.5rem_minmax(0,1fr)_minmax(0,2.2fr)_minmax(0,0.7fr)_3rem_5.5rem_3rem_6rem_5.5rem_5rem_3.5rem]";
  const gridColsClean =
    "grid grid-cols-[5.5rem_minmax(0,1fr)_minmax(0,2.2fr)_minmax(0,0.7fr)_3rem_5.5rem_3rem_6rem_3.5rem]";
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
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowAgregar(true)}
            className="text-sm bg-gray-900 text-white px-3 py-2 rounded-lg font-medium hover:bg-gray-800"
          >
            + Agregar del catálogo
          </button>
          <button
            onClick={() => setShowDuplicar(true)}
            className="text-sm border border-gray-300 text-gray-700 px-3 py-2 rounded-lg font-medium hover:bg-gray-50"
          >
            Traer de otra cotización
          </button>
          <button
            onClick={() => setShowRevisar(true)}
            className="text-sm border border-gray-300 text-gray-700 px-3 py-2 rounded-lg font-medium hover:bg-gray-50"
          >
            Revisar precios online
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="text-sm bg-gray-900 text-white px-4 py-2 rounded-lg font-medium hover:bg-gray-800 disabled:opacity-50"
          >
            {saving ? "Guardando…" : "Guardar"}
          </button>
        </div>
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
                <div className="text-center">Img</div>
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

              {/* Items del room — arrastrables (manija ⋮⋮ a la derecha) */}
              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragEnd={(e) => onDragEndRoom(e, room.items)}
              >
                <SortableContext
                  items={room.items.map((i) => i.id)}
                  strategy={verticalListSortingStrategy}
                >
                  {room.items.map((item) => (
                    <SortableArtefactoRow
                      key={item.id}
                      item={item}
                      projectId={projectId}
                      showCost={showCost}
                      gridCls={gridCls}
                      onUpdate={(patch) => updateItem(item.id, patch)}
                      onDelete={() => deleteItem(item.id)}
                    />
                  ))}
                </SortableContext>
              </DndContext>

              {/* Subtotal del room */}
              <div
                className={`${gridCls} items-center gap-3 px-4 py-2 bg-gray-50 border-t border-gray-900 text-xs font-semibold`}
              >
                <div className="col-span-7 text-gray-600 uppercase tracking-wider text-[10px]">
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

              {/* Botón agregar item dentro del room — usa el catálogo BLARQ */}
              {addingTo?.subcategory === sub.key &&
              addingTo?.room === room.key ? (
                <AddArtefactoFromCatalog
                  roomLabel={room.label}
                  defaultSubcategory={sub.key}
                  onAdd={async (payload) => {
                    await addItemFromPayload(sub.key, room.key, payload);
                    setAddingTo(null);
                  }}
                  onCancel={() => setAddingTo(null)}
                />
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
            <div className="col-span-7 text-gray-900">Total {sub.label.toLowerCase()}</div>
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
        <div className="bg-white rounded-xl border border-gray-200 p-8 text-center">
          <p className="text-sm text-gray-500 mb-4">
            No hay artefactos cargados. Agregá del catálogo, traé de otra
            cotización o importá desde un Excel.
          </p>
          <button
            onClick={() => setShowAgregar(true)}
            className="text-sm bg-gray-900 text-white px-4 py-2 rounded-lg font-medium hover:bg-gray-800"
          >
            + Agregar del catálogo
          </button>
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

      {/* Modal: revisar precios e imágenes online */}
      {showRevisar && (
        <RevisarPreciosArtefactos
          budgetId={initialBudget.id}
          onApply={applyPricePatches}
          onClose={() => setShowRevisar(false)}
        />
      )}

      {/* Modal: traer artefactos de otra cotización */}
      {showDuplicar && (
        <DuplicarArtefactos
          budgetId={initialBudget.id}
          onClose={() => setShowDuplicar(false)}
          onDone={(newItems) => {
            // Los items duplicados ya están en BD — los agregamos al
            // estado local sin recargar (router.refresh no reinicializa
            // el useState del editor).
            setItems((prev) => [...prev, ...newItems]);
            setShowDuplicar(false);
          }}
        />
      )}

      {/* Modal: agregar del catálogo (nivel superior — sirve con la
          cotización vacía). Elegís el ambiente y vas agregando varios. */}
      {showAgregar && (
        <AgregarArtefactosModal
          onAdd={addItemFromPayload}
          onClose={() => setShowAgregar(false)}
        />
      )}
    </div>
  );
}

// ─── Modal: agregar artefactos del catálogo ──────────────────────────────
//
// Punto de entrada de nivel superior para sumar artefactos al presupuesto.
// A diferencia del botón "+ agregar" de cada room (que vive dentro de un
// grupo y necesita que ya haya items), este modal se puede abrir siempre —
// incluido el caso de cotización vacía. MJ elige el AMBIENTE (baño, cocina…)
// y el TIPO (sanitario/cocina/iluminación), busca en el catálogo y va
// agregando; el modal queda abierto para sumar varios de una.
function AgregarArtefactosModal({
  onAdd,
  onClose,
}: {
  onAdd: (
    subcategory: string,
    room: string,
    payload: ArtefactoFromCatalog
  ) => Promise<void>;
  onClose: () => void;
}) {
  const [room, setRoom] = useState("bano_principal");
  const [sub, setSub] = useState("sanitario");
  const [count, setCount] = useState(0);

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4 overflow-y-auto"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-xl shadow-xl max-w-2xl w-full my-8"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-200">
          <h3 className="text-sm font-semibold text-gray-900 uppercase tracking-wider">
            Agregar del catálogo
            {count > 0 && (
              <span className="ml-2 text-[11px] font-normal text-green-700 normal-case tracking-normal">
                {count} agregado{count === 1 ? "" : "s"}
              </span>
            )}
          </h3>
          <button
            onClick={onClose}
            className="text-sm bg-gray-900 text-white px-3 py-1.5 rounded-lg font-medium hover:bg-gray-800"
          >
            Listo
          </button>
        </div>

        {/* Selectores: ambiente + tipo */}
        <div className="flex flex-wrap items-end gap-4 px-5 py-3 bg-gray-50 border-b border-gray-200">
          <div>
            <label className="block text-[10px] uppercase tracking-wider text-gray-500 mb-1">
              Ambiente
            </label>
            <select
              value={room}
              onChange={(e) => setRoom(e.target.value)}
              className="px-2 py-1.5 border border-gray-300 rounded text-xs bg-white outline-none focus:border-gray-500"
            >
              {ROOM_ORDER.map((r) => (
                <option key={r} value={r}>
                  {ROOM_LABELS[r]}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-[10px] uppercase tracking-wider text-gray-500 mb-1">
              Tipo
            </label>
            <div className="flex items-center gap-1">
              {SUBCATEGORY_ORDER.map((s) => (
                <button
                  key={s}
                  onClick={() => setSub(s)}
                  className={`text-[11px] px-2.5 py-1.5 rounded ${
                    sub === s
                      ? "bg-gray-900 text-white"
                      : "bg-white border border-gray-300 text-gray-600 hover:border-gray-400"
                  }`}
                >
                  {SUBCATEGORY_LABELS[s]?.replace("Artefactos ", "") ?? s}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Buscador del catálogo (reusa el componente existente). Cambia de
            subcategoría al tocar el tab → vuelve a buscar. */}
        <AddArtefactoFromCatalog
          key={sub}
          roomLabel={ROOM_LABELS[room] ?? room}
          defaultSubcategory={sub}
          onAdd={async (payload) => {
            await onAdd(sub, room, payload);
            setCount((c) => c + 1);
          }}
          onCancel={onClose}
        />
      </div>
    </div>
  );
}

// ─── Componente: fila de artefacto (arrastrable) ─────────────────────────
//
// La fila se puede arrastrar de la manija "⋮⋮" (a la derecha, junto a ×) para
// reordenar DENTRO del room. Borrar (×) queda visible. El resto de las celdas
// son los inputs editables de siempre.
function SortableArtefactoRow({
  item,
  projectId,
  showCost,
  gridCls,
  onUpdate,
  onDelete,
}: {
  item: ArtefactoItem;
  projectId: string;
  showCost: boolean;
  gridCls: string;
  onUpdate: (patch: Partial<ArtefactoItem>) => void;
  onDelete: () => void;
}) {
  const sortable = useSortable({ id: item.id });
  const style = {
    transform: CSS.Transform.toString(sortable.transform),
    transition: sortable.transition,
    opacity: sortable.isDragging ? 0.5 : 1,
    zIndex: sortable.isDragging ? 10 : ("auto" as const),
    background: sortable.isDragging ? "#FAFAFA" : undefined,
  };
  const totalCliente = item.clientPrice * item.quantity;
  const totalCosto = (item.realCostBlarq ?? 0) * item.quantity;
  const utilidad = totalCliente - totalCosto;

  return (
    <div
      ref={sortable.setNodeRef}
      style={style}
      className={`${gridCls} items-center gap-3 px-4 py-1.5 border-b border-gray-100 last:border-b-0 text-xs hover:bg-gray-50`}
    >
      <ItemImageCell
        projectId={projectId}
        item={item}
        onUpdate={onUpdate}
      />
      <input
        type="text"
        value={item.name}
        onChange={(e) => onUpdate({ name: e.target.value })}
        className="w-full bg-transparent border-0 p-0 font-semibold text-gray-900 outline-none focus:bg-white focus:border focus:border-gray-300 focus:rounded focus:px-1.5 focus:py-0.5"
      />
      <input
        type="text"
        value={item.detail ?? ""}
        placeholder="modelo…"
        onChange={(e) => onUpdate({ detail: e.target.value })}
        className="w-full bg-transparent border-0 p-0 text-gray-700 outline-none focus:bg-white focus:border focus:border-gray-300 focus:rounded focus:px-1.5 focus:py-0.5"
      />
      <input
        type="text"
        value={item.brand ?? ""}
        onChange={(e) => onUpdate({ brand: e.target.value })}
        className="w-full bg-transparent border-0 p-0 text-gray-600 outline-none focus:bg-white focus:border focus:border-gray-300 focus:rounded focus:px-1.5 focus:py-0.5"
      />
      <input
        type="number"
        value={item.quantity}
        onChange={(e) =>
          onUpdate({ quantity: parseInt(e.target.value) || 1 })
        }
        className="w-full bg-transparent border-0 p-0 text-center tabular-nums text-gray-900 outline-none focus:bg-white focus:border focus:border-gray-300 focus:rounded focus:px-1 focus:py-0.5"
      />
      <ThousandsInput
        value={item.listPrice}
        onChange={(v) => onUpdate({ listPrice: v })}
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
            onUpdate({
              discountPercent: (parseFloat(e.target.value) || 0) / 100,
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
            onChange={(v) => onUpdate({ realCostBlarq: v })}
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
      <div className="flex items-center gap-1.5 justify-end">
        <button
          onClick={onDelete}
          className="text-gray-400 hover:text-red-600 text-sm leading-none"
          title="Eliminar fila"
        >
          ×
        </button>
        <span
          {...sortable.attributes}
          {...sortable.listeners}
          className="cursor-grab text-gray-300 hover:text-gray-700 select-none leading-none"
          title="Arrastrar para reordenar"
        >
          ⋮⋮
        </span>
      </div>
    </div>
  );
}

// ─── Componente: celda de imagen del item ────────────────────────────────
//
// Muestra un thumbnail si hay imageUrl, o un placeholder "+ foto". Click
// abre un popover sencillo donde MJ puede:
//   - Pegar URL del producto (referenceLink) → click "Extraer" → auto-fetch
//     trae imagen + nombre + marca + precio lista del sitio (mk.cl / sodimac
//     / easy).
//   - Pegar URL de imagen manual (fallback cuando el sitio no es soportado
//     o el producto está descontinuado).
//
// El popover NO va al PDF — esto es solo edición.

function ItemImageCell({
  projectId,
  item,
  onUpdate,
}: {
  projectId: string;
  item: ArtefactoItem;
  onUpdate: (patch: Partial<ArtefactoItem>) => void;
}) {
  const [open, setOpen] = useState(false);
  const [linkDraft, setLinkDraft] = useState(item.referenceLink ?? "");
  const [imgDraft, setImgDraft] = useState(item.imageUrl ?? "");
  const [extracting, setExtracting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Si el item cambió (otro item se renderizó), reset drafts.
  // Esto es importante porque ItemImageCell se re-monta por item (key),
  // pero como precaución leemos también del item.
  function openPopover() {
    setLinkDraft(item.referenceLink ?? "");
    setImgDraft(item.imageUrl ?? "");
    setError(null);
    setOpen(true);
  }

  async function handleExtract() {
    if (!linkDraft) {
      setError("Pegá primero el link del producto.");
      return;
    }
    setExtracting(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/proyectos/${projectId}/artefactos/extract?url=${encodeURIComponent(
          linkDraft
        )}`
      );
      const data = await res.json();
      if (!res.ok) {
        setError(
          data.error ||
            "No se pudo extraer. Probá pegar la URL de imagen manualmente."
        );
        return;
      }
      // Aplicamos lo que vino del scraper. Si vienen vacíos algunos campos
      // (común en productos parcialmente catalogados), respetamos lo que
      // MJ ya tenía cargado.
      if (data.imageUrl) setImgDraft(data.imageUrl);
      const patch: Partial<ArtefactoItem> = {
        referenceLink: linkDraft,
        imageUrl: data.imageUrl ?? item.imageUrl ?? null,
      };
      if (data.name && !item.detail) patch.detail = data.name;
      if (data.brand && !item.brand) patch.brand = data.brand;
      if (data.listPrice && data.listPrice > 0 && !item.listPrice) {
        patch.listPrice = data.listPrice;
      }
      onUpdate(patch);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error inesperado");
    } finally {
      setExtracting(false);
    }
  }

  function handleSave() {
    onUpdate({
      referenceLink: linkDraft || null,
      imageUrl: imgDraft || null,
    });
    setOpen(false);
  }

  function handleClear() {
    setLinkDraft("");
    setImgDraft("");
    onUpdate({ referenceLink: null, imageUrl: null });
    setOpen(false);
  }

  return (
    <>
      <button
        type="button"
        onClick={openPopover}
        className="w-20 h-20 mx-auto rounded border border-gray-200 hover:border-gray-500 bg-white flex items-center justify-center overflow-hidden transition-colors"
        title={item.imageUrl ? "Editar imagen" : "Agregar imagen"}
      >
        {item.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={item.imageUrl}
            alt={item.name}
            className="w-full h-full object-contain"
          />
        ) : (
          <span className="text-gray-300 text-lg">+</span>
        )}
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => setOpen(false)}
        >
          <div
            className="bg-white rounded-xl shadow-xl max-w-md w-full p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-sm font-semibold text-gray-900 uppercase tracking-wider mb-3">
              Imagen del artefacto
            </h3>

            <div className="space-y-3">
              <div>
                <label className="block text-[10px] uppercase tracking-wider text-gray-500 mb-1">
                  Link del producto (mk.cl, chc.cl, byp.cl, ledstudio, ledconcept, sodimac, easy…)
                </label>
                <div className="flex gap-2">
                  <input
                    type="url"
                    value={linkDraft}
                    onChange={(e) => setLinkDraft(e.target.value)}
                    placeholder="https://www.mk.cl/…"
                    className="flex-1 px-2 py-1.5 border border-gray-300 rounded text-xs outline-none focus:border-gray-500"
                  />
                  <button
                    onClick={handleExtract}
                    disabled={extracting || !linkDraft}
                    className="text-xs bg-gray-900 text-white px-3 py-1.5 rounded hover:bg-gray-800 disabled:opacity-50 whitespace-nowrap"
                  >
                    {extracting ? "Buscando…" : "Extraer"}
                  </button>
                </div>
                <p className="text-[10px] text-gray-500 mt-1">
                  La app intentará traer imagen + nombre + marca + precio
                  lista. Si el producto está descontinuado, usá el campo de
                  abajo.
                </p>
              </div>

              {error && (
                <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1.5">
                  {error}
                </div>
              )}

              <div>
                <label className="block text-[10px] uppercase tracking-wider text-gray-500 mb-1">
                  URL de imagen (manual, fallback)
                </label>
                <input
                  type="url"
                  value={imgDraft}
                  onChange={(e) => setImgDraft(e.target.value)}
                  placeholder="https://…/imagen.jpg"
                  className="w-full px-2 py-1.5 border border-gray-300 rounded text-xs outline-none focus:border-gray-500"
                />
                <p className="text-[10px] text-gray-500 mt-1">
                  Pegá un link directo a una foto (.jpg / .png / .webp).
                </p>
              </div>

              {imgDraft && (
                <div className="border border-gray-200 rounded p-2 bg-gray-50">
                  <div className="text-[10px] uppercase tracking-wider text-gray-500 mb-1.5">
                    Vista previa
                  </div>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={imgDraft}
                    alt="preview"
                    className="max-h-40 mx-auto object-contain"
                    onError={(e) => {
                      (e.target as HTMLImageElement).style.opacity = "0.3";
                    }}
                  />
                </div>
              )}
            </div>

            <div className="flex items-center justify-between mt-5 pt-4 border-t border-gray-100">
              <button
                onClick={handleClear}
                className="text-xs text-gray-500 hover:text-red-600"
              >
                Borrar imagen
              </button>
              <div className="flex gap-2">
                <button
                  onClick={() => setOpen(false)}
                  className="text-xs text-gray-600 px-3 py-1.5 hover:text-gray-900"
                >
                  Cancelar
                </button>
                <button
                  onClick={handleSave}
                  className="text-xs bg-gray-900 text-white px-4 py-1.5 rounded hover:bg-gray-800"
                >
                  Guardar
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
