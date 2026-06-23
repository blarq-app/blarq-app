"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { formatCLP, formatNumber } from "@/lib/utils";
import AddHerrajeFromCatalog from "./AddHerrajeFromCatalog";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

// Manija de arrastre ⋮⋮ — mismo glifo gris que el catálogo de herrajes. Solo el
// handle lleva los listeners de useSortable (no la fila entera), para no romper
// los inputs/botones internos al hacer click.
function DragHandle({
  attributes,
  listeners,
  className = "",
}: {
  attributes: React.HTMLAttributes<HTMLElement>;
  listeners: Record<string, unknown> | undefined;
  className?: string;
}) {
  return (
    <span
      {...attributes}
      {...(listeners as React.HTMLAttributes<HTMLElement>)}
      className={`cursor-grab text-gray-300 hover:text-gray-700 select-none leading-none ${className}`}
      title="Arrastrar para reordenar"
    >
      ⋮⋮
    </span>
  );
}

// Cantidad de una línea de herraje. Edita LOCAL mientras se tipea (el subtotal
// se ve al instante) y recién manda al servidor al SALIR del campo (blur o
// Enter). Antes mandaba un PUT por cada tecla: con números de 2+ dígitos las
// respuestas llegaban desordenadas y revertían el valor / el total no cuadraba.
// Devuelve un fragmento con DOS celdas del grid: el input y el subtotal.
function HerrajeQtyInput({
  value,
  costNet,
  onCommit,
}: {
  value: number;
  costNet: number;
  onCommit: (qty: number) => void;
}) {
  const [local, setLocal] = useState(String(value));
  // Si el valor cambia desde afuera (respuesta del back, recarga), re-sincroniza.
  useEffect(() => {
    setLocal(String(value));
  }, [value]);
  const qty = parseFloat(local) || 0;
  const commit = () => {
    if (qty !== value) onCommit(qty);
  };
  return (
    <>
      <input
        type="number"
        min={0}
        step="1"
        value={local}
        onChange={(e) => setLocal(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        }}
        className="bg-transparent border-0 p-0 text-center text-[11px] tabular-nums text-gray-700 outline-none"
      />
      {/* Subtotal costo (costo × cantidad), en vivo con lo que se tipea. */}
      <span className="text-right text-[11px] tabular-nums text-gray-600">
        {formatCLP(costNet * qty)}
      </span>
    </>
  );
}

// Nombre editable de una línea de herraje. Igual que la cantidad: edita en
// LOCAL y guarda al SALIR del campo (blur). El nombre viene del catálogo pero
// se puede ajustar por cotización (ej. pasar a minúscula, corregir texto).
// Textarea con field-sizing para que los nombres largos envuelvan.
function HerrajeNameInput({
  value,
  onCommit,
}: {
  value: string;
  onCommit: (name: string) => void;
}) {
  const [local, setLocal] = useState(value);
  useEffect(() => {
    setLocal(value);
  }, [value]);
  const commit = () => {
    const v = local.replace(/\s+/g, " ").trim();
    if (v && v !== value) onCommit(v);
    else if (!v) setLocal(value); // no permitir vaciar el nombre
  };
  return (
    <textarea
      rows={1}
      value={local}
      onChange={(e) => setLocal(e.target.value)}
      onBlur={commit}
      className="flex-1 min-w-0 bg-transparent border-0 p-0 text-[11px] text-gray-800 leading-tight resize-none [field-sizing:content] outline-none focus:bg-white focus:border focus:border-gray-300 focus:rounded focus:px-1 focus:py-0.5"
    />
  );
}

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

// Línea de herraje dentro de una partida kind="herrajes". Cada línea apunta a
// un herraje del catálogo (catalogId) y guarda su sector, cantidad y costo
// neto. El precio a cliente de la partida se deriva del total de líneas + margen.
type MuebleHerraje = {
  id: string;
  itemId: string;
  catalogId: string | null;
  sector: string;
  supplier: string;
  name: string;
  measure: string | null;
  finish: string | null;
  sku: string | null;
  quantity: number;
  costNet: number;
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
  // "mueble" (default) | "herrajes". Decide qué bloque se renderiza.
  kind: string;
  details: MuebleDetail[];
  quotes: MuebleQuote[];
  herrajes: MuebleHerraje[];
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

  // ── Arrastre (drag & drop) ──────────────────────────────────────────────
  // Mismo patrón que el catálogo de herrajes. Sensor con un umbral de 5px para
  // no disparar un drag cuando MJ solo quiere hacer click en un input.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  // Reordenar CAPÍTULOS. Optimista: movemos el array de inmediato (arrayMove) y
  // después persistimos. El server renumera (chapterNumber + itemNumber de cada
  // item) y nos devuelve la numeración nueva: la mergeamos sin tocar el resto.
  async function reorderChapters(e: DragEndEvent) {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const oldIdx = chapters.findIndex((c) => c.id === active.id);
    const newIdx = chapters.findIndex((c) => c.id === over.id);
    if (oldIdx < 0 || newIdx < 0) return;
    const reordered = arrayMove(chapters, oldIdx, newIdx);
    setChapters(reordered);
    try {
      const res = await fetch(
        `/api/presupuestos/${budgetId}/muebles/chapters/reorder`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ orderedIds: reordered.map((c) => c.id) }),
        }
      );
      if (!res.ok) {
        console.error("Error al reordenar capítulos:", await res.text());
        return;
      }
      const data: {
        chapters: {
          id: string;
          chapterNumber: number;
          sortOrder: number;
          items: { id: string; itemNumber: string; sortOrder: number }[];
        }[];
      } = await res.json();
      // Mergeamos la numeración nueva (chapterNumber + itemNumber de cada item)
      // sin pisar nombres, costos ni el resto de los campos.
      const numByChapter = new Map(data.chapters.map((c) => [c.id, c]));
      setChapters((prev) =>
        prev.map((c) => {
          const fresh = numByChapter.get(c.id);
          if (!fresh) return c;
          const numByItem = new Map(fresh.items.map((it) => [it.id, it]));
          return {
            ...c,
            chapterNumber: fresh.chapterNumber,
            sortOrder: fresh.sortOrder,
            items: c.items.map((it) => {
              const fi = numByItem.get(it.id);
              return fi
                ? { ...it, itemNumber: fi.itemNumber, sortOrder: fi.sortOrder }
                : it;
            }),
          };
        })
      );
    } catch (err) {
      console.error("Error al reordenar capítulos:", err);
    }
  }

  // Reordenar ITEMS dentro de un capítulo. Optimista + merge de la numeración
  // nueva (itemNumber) que devuelve el server.
  async function reorderItems(chapterId: string, orderedIds: string[]) {
    setChapters((prev) =>
      prev.map((c) => {
        if (c.id !== chapterId) return c;
        const byId = new Map(c.items.map((it) => [it.id, it]));
        const reordered = orderedIds
          .map((id) => byId.get(id))
          .filter((it): it is MuebleItem => !!it);
        return { ...c, items: reordered };
      })
    );
    try {
      const res = await fetch(
        `/api/presupuestos/${budgetId}/muebles/items/reorder`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chapterId, orderedIds }),
        }
      );
      if (!res.ok) {
        console.error("Error al reordenar items:", await res.text());
        return;
      }
      const data: {
        items: { id: string; itemNumber: string; sortOrder: number }[];
      } = await res.json();
      const numByItem = new Map(data.items.map((it) => [it.id, it]));
      setChapters((prev) =>
        prev.map((c) =>
          c.id !== chapterId
            ? c
            : {
                ...c,
                items: c.items.map((it) => {
                  const fi = numByItem.get(it.id);
                  return fi
                    ? { ...it, itemNumber: fi.itemNumber, sortOrder: fi.sortOrder }
                    : it;
                }),
              }
        )
      );
    } catch (err) {
      console.error("Error al reordenar items:", err);
    }
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
    // Sembramos los TRES arrays para que el render no se caiga (la respuesta
    // del POST no necesariamente los trae): details, quotes y herrajes.
    setChapters((prev) =>
      prev.map((c) =>
        c.id === chapterId
          ? // El POST de /muebles/items NO trae las relaciones; hay que sembrar
            // los TRES arrays vacíos (details, quotes, herrajes) o el render se
            // cae al leer item.quotes/.herrajes (.filter/.length) con undefined.
            // (Supersede el fix de #188 que solo sembraba details+quotes.)
            {
              ...c,
              items: [
                ...c.items,
                { ...created, details: [], quotes: [], herrajes: [] },
              ],
            }
          : c
      )
    );
  }

  // Crea una PARTIDA de herrajes (kind="herrajes") dentro del capítulo. El back
  // la nace con name "HERRAJES", utilityPercentage 0.2 y totales en 0.
  async function addHerrajePartida(chapterId: string) {
    const res = await fetch(`/api/presupuestos/${budgetId}/muebles/items`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chapterId, kind: "herrajes" }),
    });
    if (!res.ok) return alert("Error al crear partida de herrajes");
    const created: MuebleItem = await res.json();
    setChapters((prev) =>
      prev.map((c) =>
        c.id === chapterId
          ? {
              ...c,
              items: [
                ...c.items,
                { ...created, details: [], quotes: [], herrajes: [] },
              ],
            }
          : c
      )
    );
  }

  // ── Líneas de herraje dentro de una partida kind="herrajes" ──────────────
  // El editor NO calcula los totales del item: el back los recalcula desde las
  // líneas y los devuelve. Acá solo mergeamos esos totales en el estado para
  // que costo/precio/IVA de la partida queden sincronizados sin recargar.

  // Mergea en el estado los totales recalculados que devuelve el back para un
  // item, dejando el resto de campos del item intactos.
  function patchItemTotals(
    chapterId: string,
    itemId: string,
    updated: Partial<MuebleItem>
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
                      costDistributor:
                        updated.costDistributor ?? i.costDistributor,
                      utilityPercentage:
                        updated.utilityPercentage ?? i.utilityPercentage,
                      clientPriceNet: updated.clientPriceNet ?? i.clientPriceNet,
                      clientPriceIva: updated.clientPriceIva ?? i.clientPriceIva,
                    }
                  : i
              ),
            }
      )
    );
  }

  // El modal ya hizo el POST; acá metemos la línea nueva y refrescamos totales.
  function onHerrajeAdded(
    chapterId: string,
    itemId: string,
    line: MuebleHerraje,
    updated: Partial<MuebleItem>
  ) {
    setChapters((prev) =>
      prev.map((c) =>
        c.id !== chapterId
          ? c
          : {
              ...c,
              items: c.items.map((i) =>
                i.id === itemId
                  ? { ...i, herrajes: [...i.herrajes, line] }
                  : i
              ),
            }
      )
    );
    patchItemTotals(chapterId, itemId, updated);
  }

  // Editar cantidad o sector de una línea de herraje. El back devuelve la línea
  // y el item recalculado.
  async function updateHerraje(
    chapterId: string,
    itemId: string,
    herrajeId: string,
    patch: { quantity?: number; sector?: string; name?: string }
  ) {
    // Optimista: mostramos el cambio de inmediato en la línea.
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
                      herrajes: i.herrajes.map((h) =>
                        h.id === herrajeId ? { ...h, ...patch } : h
                      ),
                    }
              ),
            }
      )
    );
    const res = await fetch(
      `/api/presupuestos/${budgetId}/muebles/items/${itemId}/herrajes/${herrajeId}`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      }
    );
    if (!res.ok) return;
    const data = await res.json();
    // Sincronizamos la línea con la versión del back y refrescamos totales.
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
                      herrajes: i.herrajes.map((h) =>
                        h.id === herrajeId ? { ...h, ...data.line } : h
                      ),
                    }
              ),
            }
      )
    );
    patchItemTotals(chapterId, itemId, data.item);
  }

  // Borrar una línea de herraje. El back devuelve el item recalculado.
  async function deleteHerraje(
    chapterId: string,
    itemId: string,
    herrajeId: string
  ) {
    const res = await fetch(
      `/api/presupuestos/${budgetId}/muebles/items/${itemId}/herrajes/${herrajeId}`,
      { method: "DELETE" }
    );
    if (!res.ok) return alert("Error al eliminar el herraje");
    const data = await res.json();
    setChapters((prev) =>
      prev.map((c) =>
        c.id !== chapterId
          ? c
          : {
              ...c,
              items: c.items.map((i) =>
                i.id !== itemId
                  ? i
                  : { ...i, herrajes: i.herrajes.filter((h) => h.id !== herrajeId) }
              ),
            }
      )
    );
    patchItemTotals(chapterId, itemId, data.item);
  }

  // Editar nombre / margen de la partida de herrajes. Para kind="herrajes" el
  // back recalcula el costo desde las líneas; devuelve el item actualizado.
  async function updateHerrajePartida(
    chapterId: string,
    itemId: string,
    patch: {
      itemNumber?: string;
      name?: string;
      utilityPercentage?: number;
      // Modo MANUAL (partida de herrajes sin líneas del catálogo): costo y
      // proveedor cargados a mano, igual que una partida de muebles.
      costDistributor?: number;
      supplier?: string | null;
    }
  ) {
    // Optimista en nombre/número/margen; los totales llegan del back.
    setChapters((prev) =>
      prev.map((c) =>
        c.id !== chapterId
          ? c
          : {
              ...c,
              items: c.items.map((i) =>
                i.id === itemId ? { ...i, ...patch } : i
              ),
            }
      )
    );
    const current = chapters
      .find((c) => c.id === chapterId)
      ?.items.find((i) => i.id === itemId);
    const res = await fetch(
      `/api/presupuestos/${budgetId}/muebles/items/${itemId}`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: patch.name ?? current?.name ?? "HERRAJES",
          utilityPercentage:
            patch.utilityPercentage ?? current?.utilityPercentage ?? 0.2,
          ...(patch.itemNumber !== undefined
            ? { itemNumber: patch.itemNumber }
            : {}),
          ...(patch.costDistributor !== undefined
            ? { costDistributor: patch.costDistributor }
            : {}),
          ...(patch.supplier !== undefined ? { supplier: patch.supplier } : {}),
        }),
      }
    );
    if (!res.ok) return;
    const updated: Partial<MuebleItem> = await res.json();
    patchItemTotals(chapterId, itemId, updated);
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
      {/* Tabla de presupuesto — vista similar al PDF que se entrega al cliente.
          El cálculo interno (proveedor / costo / utilidad / comparativa de
          alternativas) está oculto detrás de un toggle por ítem. */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        {/* Header de columnas (mismo grid que las filas) */}
        <div className="grid grid-cols-[3rem_minmax(0,1fr)_5rem_8rem_2rem] items-center gap-3 px-4 py-2 border-y-2 border-gray-900 text-[10px] font-bold text-gray-900 uppercase tracking-wider">
          <div>Item</div>
          <div>Partida / Descripción</div>
          <div className="text-center">Cantidad</div>
          <div className="text-right">Total</div>
          <div></div>
        </div>

        <DndContext
          id="muebles-chapters-dnd"
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={reorderChapters}
        >
          <SortableContext
            items={chapters.map((c) => c.id)}
            strategy={verticalListSortingStrategy}
          >
            {chapters.map((ch) => (
              <ChapterBlock
          key={ch.id}
          chapter={ch}
          budgetId={budgetId}
          sensors={sensors}
          onReorderItems={(orderedIds) => reorderItems(ch.id, orderedIds)}
          onUpdate={(patch) => updateChapter(ch.id, patch)}
          onDelete={() => deleteChapter(ch.id)}
          onAddItem={() => addItem(ch.id)}
          onAddHerrajePartida={() => addHerrajePartida(ch.id)}
          onUpdateItem={(itemId, patch) => updateItem(ch.id, itemId, patch)}
          onDeleteItem={(itemId) => deleteItem(ch.id, itemId)}
          onUpdateHerrajePartida={(itemId, patch) =>
            updateHerrajePartida(ch.id, itemId, patch)
          }
          onHerrajeAdded={(itemId, line, updated) =>
            onHerrajeAdded(ch.id, itemId, line, updated)
          }
          onUpdateHerraje={(itemId, herrajeId, patch) =>
            updateHerraje(ch.id, itemId, herrajeId, patch)
          }
          onDeleteHerraje={(itemId, herrajeId) =>
            deleteHerraje(ch.id, itemId, herrajeId)
          }
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
          </SortableContext>
        </DndContext>

        <button
          onClick={addChapter}
          className="text-xs text-gray-500 hover:text-gray-900 px-4 py-2 w-full text-left border-t border-gray-100"
        >
          + Agregar capítulo (ej. Cocina, Closet dormitorio, Walk-in)
        </button>
      </div>

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
  budgetId,
  sensors,
  onReorderItems,
  onUpdate,
  onDelete,
  onAddItem,
  onAddHerrajePartida,
  onUpdateItem,
  onDeleteItem,
  onAddDetail,
  onUpdateDetail,
  onDeleteDetail,
  onAddQuote,
  onUpdateQuote,
  onDeleteQuote,
  onActivateQuote,
  onUpdateHerrajePartida,
  onHerrajeAdded,
  onUpdateHerraje,
  onDeleteHerraje,
}: {
  chapter: MuebleChapter;
  budgetId: string;
  sensors: ReturnType<typeof useSensors>;
  onReorderItems: (orderedIds: string[]) => void;
  onUpdate: (patch: Partial<MuebleChapter>) => void;
  onDelete: () => void;
  onAddItem: () => void;
  onAddHerrajePartida: () => void;
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
  onUpdateHerrajePartida: (
    itemId: string,
    patch: {
      itemNumber?: string;
      name?: string;
      utilityPercentage?: number;
      costDistributor?: number;
      supplier?: string | null;
    }
  ) => void;
  onHerrajeAdded: (
    itemId: string,
    line: MuebleHerraje,
    updated: Partial<MuebleItem>
  ) => void;
  onUpdateHerraje: (
    itemId: string,
    herrajeId: string,
    patch: { quantity?: number; sector?: string; name?: string }
  ) => void;
  onDeleteHerraje: (itemId: string, herrajeId: string) => void;
}) {
  const subtotal = chapter.items.reduce(
    (s, i) => s + i.clientPriceIva * i.quantity,
    0
  );

  // Sortable a nivel capítulo: la fila gris del encabezado es el nodo
  // arrastrable. El handle ⋮⋮ va al lado del número; solo el handle lleva los
  // listeners para no romper el input del nombre ni el botón de borrar.
  const sortable = useSortable({ id: chapter.id });
  const chapterStyle = {
    transform: CSS.Transform.toString(sortable.transform),
    transition: sortable.transition,
    opacity: sortable.isDragging ? 0.5 : 1,
    zIndex: sortable.isDragging ? 10 : ("auto" as const),
    position: "relative" as const,
  };

  return (
    <>
      {/* Fila de capítulo (gris, mismo grid que el resto). La manija va antes
          del número, dentro de la primera celda. */}
      <div
        ref={sortable.setNodeRef}
        style={chapterStyle}
        className="grid grid-cols-[3rem_minmax(0,1fr)_5rem_8rem_2rem] items-center gap-3 px-4 py-2.5 bg-[#DBDBDB] border-b border-gray-300"
      >
        <span className="flex items-center gap-1.5">
          <DragHandle
            attributes={sortable.attributes}
            listeners={sortable.listeners}
          />
          <span className="font-bold text-gray-900 tabular-nums">
            {chapter.chapterNumber}
          </span>
        </span>
        <input
          type="text"
          value={chapter.name}
          onChange={(e) => onUpdate({ name: e.target.value.toUpperCase() })}
          className="bg-transparent border-0 p-0 font-bold text-gray-900 uppercase tracking-wide outline-none"
        />
        <div></div>
        <span className="text-right font-bold tabular-nums text-gray-900">
          {formatCLP(subtotal)}
        </span>
        <button
          onClick={onDelete}
          className="text-gray-500 hover:text-red-600 text-sm"
          title="Eliminar capítulo"
        >
          ✕
        </button>
      </div>

      {/* Items del capítulo. Su PROPIO DndContext (uno por capítulo) para que el
          arrastre de items quede confinado a este capítulo y no se mezclen
          partidas entre capítulos. Los items kind="herrajes" usan un bloque
          distinto (no muestran componentes ni cotizaciones de proveedor). */}
      <DndContext
        id={`muebles-items-dnd-${chapter.id}`}
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={(e: DragEndEvent) => {
          const { active, over } = e;
          if (!over || active.id === over.id) return;
          const oldIdx = chapter.items.findIndex((i) => i.id === active.id);
          const newIdx = chapter.items.findIndex((i) => i.id === over.id);
          if (oldIdx < 0 || newIdx < 0) return;
          const reordered = arrayMove(chapter.items, oldIdx, newIdx);
          onReorderItems(reordered.map((i) => i.id));
        }}
      >
        <SortableContext
          items={chapter.items.map((i) => i.id)}
          strategy={verticalListSortingStrategy}
        >
          {chapter.items.map((item) => (
            <SortableItemWrapper key={item.id} id={item.id}>
              {(handle) =>
                item.kind === "herrajes" ? (
                  <HerrajePartidaBlock
                    item={item}
                    budgetId={budgetId}
                    dragHandle={handle}
                    onUpdate={(patch) => onUpdateHerrajePartida(item.id, patch)}
                    onDelete={() => onDeleteItem(item.id)}
                    onHerrajeAdded={(line, updated) =>
                      onHerrajeAdded(item.id, line, updated)
                    }
                    onUpdateHerraje={(herrajeId, patch) =>
                      onUpdateHerraje(item.id, herrajeId, patch)
                    }
                    onDeleteHerraje={(herrajeId) =>
                      onDeleteHerraje(item.id, herrajeId)
                    }
                  />
                ) : (
                  <ItemBlock
                    item={item}
                    dragHandle={handle}
                    onUpdate={(patch) => onUpdateItem(item.id, patch)}
                    onDelete={() => onDeleteItem(item.id)}
                    onAddDetail={() => onAddDetail(item.id)}
                    onUpdateDetail={(detailId, patch) =>
                      onUpdateDetail(item.id, detailId, patch)
                    }
                    onDeleteDetail={(detailId) =>
                      onDeleteDetail(item.id, detailId)
                    }
                    onAddQuote={() => onAddQuote(item.id)}
                    onUpdateQuote={(quoteId, patch) =>
                      onUpdateQuote(item.id, quoteId, patch)
                    }
                    onDeleteQuote={(quoteId) => onDeleteQuote(item.id, quoteId)}
                    onActivateQuote={(quoteId) =>
                      onActivateQuote(item.id, quoteId)
                    }
                  />
                )
              }
            </SortableItemWrapper>
          ))}
        </SortableContext>
      </DndContext>

      {/* Dos acciones distintas, separadas a propósito para no confundirlas:
          - "Agregar item" = partida de mueble normal (link gris discreto).
          - "Partida de herrajes" = trae el catálogo (botón con borde, más
            visible) — MJ se confundía y nombraba un item normal "HERRAJES". */}
      <div className="px-4 py-2 border-b border-gray-100 flex items-center justify-between gap-4">
        <button
          onClick={onAddItem}
          className="text-[11px] text-gray-400 hover:text-gray-900"
        >
          + Agregar item al capítulo (ej. Muebles, Cubiertas)
        </button>
        {/* El botón de crear partida de herrajes se muestra SOLO si el capítulo
            todavía no tiene una. Una vez creada, se suman más herrajes con
            "Agregar del catálogo" DENTRO de la partida (los sectores son
            sub-grupos de esa única partida). Así no se crean partidas HERRAJES
            duplicadas por error al salir y volver a entrar. */}
        {chapter.items.some((i) => i.kind === "herrajes") ? (
          <span className="text-[11px] text-gray-300 whitespace-nowrap">
            Herrajes: agregá del catálogo dentro de la partida ↑
          </span>
        ) : (
          <button
            onClick={onAddHerrajePartida}
            className="text-[11px] font-medium text-gray-700 border border-gray-300 rounded px-2.5 py-1 hover:bg-gray-50 hover:border-gray-400 whitespace-nowrap"
            title="Crea una partida que se arma con herrajes del catálogo (correderas, bisagras, cajones…)"
          >
            + Partida de herrajes (del catálogo)
          </button>
        )}
      </div>
    </>
  );
}

// Envoltorio sortable para un item (partida) dentro de un capítulo. El item se
// renderiza como varias filas de grid (fragmento); las metemos en un <div> que
// es el nodo arrastrable (las filas internas siguen siendo grid de ancho
// completo, así que el layout no cambia). El handle ⋮⋮ se entrega al bloque por
// render-prop para que lo coloque en su primera fila (solo el handle arrastra).
function SortableItemWrapper({
  id,
  children,
}: {
  id: string;
  children: (handle: React.ReactNode) => React.ReactNode;
}) {
  const sortable = useSortable({ id });
  const style = {
    transform: CSS.Transform.toString(sortable.transform),
    transition: sortable.transition,
    opacity: sortable.isDragging ? 0.5 : 1,
    zIndex: sortable.isDragging ? 10 : ("auto" as const),
    position: "relative" as const,
    background: sortable.isDragging ? "#FAFAFA" : undefined,
  };
  const handle = (
    <DragHandle
      attributes={sortable.attributes}
      listeners={sortable.listeners}
    />
  );
  return (
    <div ref={sortable.setNodeRef} style={style}>
      {children(handle)}
    </div>
  );
}

function ItemBlock({
  item,
  dragHandle,
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
  dragHandle: React.ReactNode;
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
  // Red de seguridad: si por cualquier camino el item llega sin la lista de
  // cotizaciones cargada, tratarla como vacía en vez de caerse al renderizar.
  const alternatives = (item.quotes ?? []).filter((q) => !q.isSelected);
  // Costo interno colapsado por default — la vista por default refleja el PDF.
  // El usuario expande cuando quiere ver/editar el cálculo o comparar proveedores.
  const [showCost, setShowCost] = useState(false);
  // Layout que mirrors el PDF: el grid de columnas es el mismo que el header
  // de la tabla y que la fila del capítulo. Item-row = 3rem | 1fr | 5rem | 8rem | 2rem
  const ROW_GRID = "grid grid-cols-[3rem_minmax(0,1fr)_5rem_8rem_2rem] items-baseline gap-3";
  return (
    <>
      {/* Fila principal del item: manija + número, nombre, cantidad, total */}
      <div className={`${ROW_GRID} px-4 pt-2 pb-1 border-b border-gray-100`}>
        <span className="flex items-center gap-1">
          {dragHandle}
          <input
            type="text"
            value={item.itemNumber}
            onChange={(e) => onUpdate({ itemNumber: e.target.value })}
            className="w-full min-w-0 bg-transparent border-0 p-0 text-sm tabular-nums text-gray-700 outline-none"
          />
        </span>
        <input
          type="text"
          value={item.name}
          onChange={(e) => onUpdate({ name: e.target.value.toUpperCase() })}
          className="bg-transparent border-0 p-0 text-sm font-bold uppercase text-gray-900 outline-none"
        />
        <input
          type="number"
          step="0.01"
          value={item.quantity}
          onChange={(e) =>
            onUpdate({ quantity: parseFloat(e.target.value) || 0 })
          }
          className="bg-transparent border-0 p-0 text-center text-sm tabular-nums text-gray-700 outline-none"
        />
        <span className="text-right text-sm font-bold tabular-nums text-gray-900">
          {formatCLP(item.clientPriceIva * item.quantity)}
        </span>
        <button
          onClick={onDelete}
          className="text-gray-400 hover:text-red-600 text-sm leading-none"
          title="Eliminar item"
        >
          ✕
        </button>
      </div>

      {/* Descripción general (italic, debajo del nombre, dentro del grid) */}
      <div className={`${ROW_GRID} px-4 py-0.5 border-b border-gray-100`}>
        <div></div>
        <input
          type="text"
          value={item.descriptionGeneral ?? ""}
          onChange={(e) => onUpdate({ descriptionGeneral: e.target.value })}
          placeholder="descripción general (ej. SEGÚN PLANOS ARQUITECTURA)"
          className="text-[11px] italic text-gray-600 bg-transparent border-0 p-0 outline-none"
        />
        <div></div>
        <div></div>
        <div></div>
      </div>

      {/* Componentes (CUERPO INTERIOR / TRASERA / etc) — sub-filas indentadas
          en la columna PARTIDA, con grid interno (nombre | materialidad | ✕) */}
      {item.details.map((d) => (
        <div
          key={d.id}
          className={`${ROW_GRID} px-4 py-0.5 border-b border-gray-50`}
        >
          <div></div>
          <div className="grid grid-cols-[10rem_minmax(0,1fr)_1.5rem] gap-2 items-center">
            <input
              type="text"
              value={d.name}
              onChange={(e) =>
                onUpdateDetail(d.id, { name: e.target.value.toUpperCase() })
              }
              placeholder="COMPONENTE"
              className="bg-transparent border-0 p-0 text-[11px] uppercase tracking-tight text-gray-700 outline-none"
            />
            <input
              type="text"
              value={d.material}
              onChange={(e) =>
                onUpdateDetail(d.id, { material: e.target.value })
              }
              placeholder="materialidad…"
              className="bg-transparent border-0 p-0 text-[11px] text-gray-600 outline-none"
            />
            {/* Botón eliminar componente. Antes era una ✕ de 10px en gris muy
                claro dentro de una columna de 1rem: blanco de click minúsculo,
                MJ no lograba borrar los componentes agregados por error. Ahora
                es un botón con padding (área de click ~24px), glifo más grande y
                color más visible que se pone rojo al pasar por encima. */}
            <button
              onClick={() => onDeleteDetail(d.id)}
              className="flex items-center justify-center justify-self-end -my-1 h-6 w-6 rounded text-gray-400 hover:text-red-600 hover:bg-red-50 text-sm leading-none cursor-pointer"
              title="Eliminar componente"
              aria-label="Eliminar componente"
            >
              ✕
            </button>
          </div>
          <div></div>
          <div></div>
          <div></div>
        </div>
      ))}

      {/* Botón "+ Componente" en la columna PARTIDA */}
      <div className={`${ROW_GRID} px-4 pb-1 border-b border-gray-100`}>
        <div></div>
        <button
          onClick={onAddDetail}
          className="text-[10px] text-gray-400 hover:text-gray-900 text-left"
        >
          + Componente
        </button>
        <div></div>
        <div></div>
        <div></div>
      </div>

      {/* Costo interno — colapsado por default. Cuando se expande, muestra el
          panel de cálculo del proveedor activo + tabla de comparativa.
          Pintado en rojo burdeo para señalar visualmente que es info
          INTERNA (no va al PDF del cliente). Utilidad sigue en verde. */}
      <div className="px-4 py-1.5 border-b border-red-200 bg-gray-50">
        <button
          onClick={() => setShowCost((v) => !v)}
          className="text-[11px] text-red-800 hover:text-red-900 flex items-center gap-1.5 w-full text-left"
        >
          <span className="inline-block w-3">{showCost ? "▾" : "▸"}</span>
          <span className="font-medium">Costo interno</span>
          <span className="text-red-300">·</span>
          <span className="text-red-900">{item.supplier || "—"}</span>
          <span className="text-red-300">·</span>
          <span className="text-red-900 tabular-nums">
            {formatCLP(item.clientPriceIva)} c/iva
          </span>
          <span className="text-red-300">·</span>
          <span className="text-green-700 font-medium tabular-nums">
            util {formatCLP(item.clientPriceNet - item.costDistributor)}
          </span>
          {item.quotes.length > 1 && (
            <>
              <span className="text-gray-400">·</span>
              <span className="text-gray-500">
                {item.quotes.length} cotizaciones
              </span>
            </>
          )}
        </button>

        {showCost && (
          <div className="mt-2 space-y-2">
            {/* Cálculo activo — solo se muestra cuando hay 2+ cotizaciones
                (sea o no comparando contra alternativas). Cuando solo hay
                una, el editor de la cotización única vive directamente
                en la tabla de comparativa de abajo, evitando duplicación. */}
            {item.quotes.length >= 2 && (
            <div className="flex items-center flex-wrap gap-x-3 gap-y-1 text-xs bg-white border border-red-200 rounded px-2.5 py-1.5">
              <label className="flex items-center gap-1.5">
                <span className="text-red-700">Proveedor</span>
                <input
                  type="text"
                  value={item.supplier ?? ""}
                  onChange={(e) => onUpdate({ supplier: e.target.value })}
                  className="w-28 bg-white border border-red-200 rounded px-1.5 py-0.5 outline-none focus:ring-1 focus:ring-red-700 font-bold text-red-900"
                />
              </label>
              <label className="flex items-center gap-1.5">
                <span className="text-red-700">Costo dist.</span>
                <ThousandsInput
                  value={item.costDistributor}
                  onChange={(v) => onUpdate({ costDistributor: v })}
                  placeholder="0"
                  className="w-28 bg-white border border-red-200 rounded px-1.5 py-0.5 text-right tabular-nums outline-none focus:ring-1 focus:ring-red-700 font-bold text-red-900"
                />
              </label>
              <label className="flex items-center gap-1.5">
                <span className="text-red-700">% util.</span>
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
                  className="w-14 bg-white border border-red-200 rounded px-1.5 py-0.5 text-right tabular-nums outline-none focus:ring-1 focus:ring-red-700 font-bold text-red-900"
                />
                <span className="text-red-700">%</span>
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
            )}

            {/* Comparativa de cotizaciones */}
            <div className="border border-red-200 rounded overflow-hidden bg-white">
            <table className="w-full text-[11px]">
              <thead className="bg-gray-50 text-red-700 uppercase tracking-wider text-[9.5px]">
                <tr>
                  <th className="text-left px-2 py-1 font-bold">Proveedor</th>
                  <th className="text-right px-2 py-1 font-bold w-24">Costo dist.</th>
                  <th className="text-right px-2 py-1 font-bold w-14">% util</th>
                  <th className="text-right px-2 py-1 font-bold w-24 text-gray-500">Neto</th>
                  <th className="text-right px-2 py-1 font-bold w-24 text-gray-500">C/IVA</th>
                  <th className="text-right px-2 py-1 font-bold w-20 text-green-700">Util</th>
                  <th className="px-2 py-1 w-28"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {/* Fila "virtual" para editar item.* directamente cuando
                    no hay cotizaciones alternativas. Así MJ puede llenar
                    el primer proveedor inline en la tabla sin necesidad
                    del panel "Cálculo activo" arriba. */}
                {item.quotes.length === 0 && (
                  <tr>
                    <td className="px-2 py-1">
                      <input
                        type="text"
                        value={item.supplier ?? ""}
                        onChange={(e) => onUpdate({ supplier: e.target.value })}
                        placeholder="proveedor"
                        className="flex-1 bg-transparent border-0 p-0 outline-none text-red-900"
                      />
                    </td>
                    <td className="px-2 py-1 text-right">
                      <ThousandsInput
                        value={item.costDistributor}
                        onChange={(v) => onUpdate({ costDistributor: v })}
                        placeholder="0"
                        className="w-full bg-transparent border-0 p-0 text-right tabular-nums outline-none text-red-900"
                      />
                    </td>
                    <td className="px-2 py-1 text-right">
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
                        className="w-full bg-transparent border-0 p-0 text-right tabular-nums outline-none text-red-900"
                      />
                    </td>
                    {/* Neto y C/IVA en gris — son el precio cliente.
                        Util en verde (utilidad sigue siendo verde como
                        antes). */}
                    <td className="px-2 py-1 text-right tabular-nums text-gray-700">
                      {formatCLP(item.clientPriceNet)}
                    </td>
                    <td className="px-2 py-1 text-right tabular-nums text-gray-700">
                      {formatCLP(item.clientPriceIva)}
                    </td>
                    <td className="px-2 py-1 text-right tabular-nums text-green-700">
                      {formatCLP(item.clientPriceNet - item.costDistributor)}
                    </td>
                    <td className="px-2 py-1"></td>
                  </tr>
                )}
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
          </div>
        )}
      </div>
    </>
  );
}

// ─── Partida de herrajes (kind="herrajes") ──────────────────────────────────
// Bloque distinto al ItemBlock normal: no tiene componentes ni cotizaciones de
// proveedor. Lista herrajes del catálogo AGRUPADOS por sector, con su cantidad
// editable, y muestra el costo interno + margen + precio cliente de la partida.
function HerrajePartidaBlock({
  item,
  budgetId,
  dragHandle,
  onUpdate,
  onDelete,
  onHerrajeAdded,
  onUpdateHerraje,
  onDeleteHerraje,
}: {
  item: MuebleItem;
  budgetId: string;
  dragHandle: React.ReactNode;
  onUpdate: (patch: {
    itemNumber?: string;
    name?: string;
    utilityPercentage?: number;
    costDistributor?: number;
    supplier?: string | null;
  }) => void;
  onDelete: () => void;
  onHerrajeAdded: (
    line: MuebleHerraje,
    updated: Partial<MuebleItem>
  ) => void;
  onUpdateHerraje: (
    herrajeId: string,
    patch: { quantity?: number; sector?: string; name?: string }
  ) => void;
  onDeleteHerraje: (herrajeId: string) => void;
}) {
  const [showCatalog, setShowCatalog] = useState(false);

  // Mismo grid que el resto de la tabla (item · partida · cantidad · total · ✕).
  const ROW_GRID =
    "grid grid-cols-[3rem_minmax(0,1fr)_5rem_8rem_2rem] items-baseline gap-3";

  // Agrupamos las líneas por sector. "" = "Sin sector". Conservamos el orden de
  // aparición de los sectores (primer line de cada sector marca su posición).
  const groups: { sector: string; lines: MuebleHerraje[] }[] = [];
  for (const line of item.herrajes) {
    const sector = line.sector ?? "";
    const existing = groups.find((g) => g.sector === sector);
    if (existing) existing.lines.push(line);
    else groups.push({ sector, lines: [line] });
  }

  // Sectores ya usados (para sugerir en el modal).
  const existingSectors = Array.from(
    new Set(item.herrajes.map((h) => h.sector).filter(Boolean))
  );

  // Margen mostrado como % entero (0.2 → 20).
  const marginPct = item.utilityPercentage
    ? Math.round(item.utilityPercentage * 100)
    : 0;

  return (
    <>
      {/* Fila de la partida: manija + número (editable), nombre, total. */}
      <div className={`${ROW_GRID} px-4 pt-2 pb-1 border-b border-gray-100`}>
        <span className="flex items-center gap-1">
          {dragHandle}
          <input
            type="text"
            value={item.itemNumber}
            onChange={(e) => onUpdate({ itemNumber: e.target.value })}
            className="w-full min-w-0 bg-transparent border-0 p-0 text-sm tabular-nums text-gray-700 outline-none"
          />
        </span>
        <input
          type="text"
          value={item.name}
          onChange={(e) => onUpdate({ name: e.target.value.toUpperCase() })}
          className="bg-transparent border-0 p-0 text-sm font-bold uppercase text-gray-900 outline-none"
        />
        <div></div>
        <span className="text-right text-sm font-bold tabular-nums text-gray-900">
          {formatCLP(item.clientPriceIva)}
        </span>
        <button
          onClick={onDelete}
          className="text-gray-400 hover:text-red-600 text-sm leading-none"
          title="Eliminar partida de herrajes"
        >
          ✕
        </button>
      </div>

      {/* Sin líneas del catálogo: modo MANUAL — proveedor + costo total a mano
          (igual que muebles, para cuando el mueblista cotiza los herrajes). La
          otra opción ("Agregar del catálogo") sigue abajo; si agrega del
          catálogo, la partida pasa a modo itemizado y el costo lo derivan las
          líneas. */}
      {item.herrajes.length === 0 ? (
        <div className="px-4 py-2 border-b border-gray-100 flex items-center flex-wrap gap-x-3 gap-y-1 text-[11px] text-gray-600">
          <span className="text-gray-500">Cargar a mano:</span>
          <span>proveedor</span>
          <input
            type="text"
            value={item.supplier ?? ""}
            onChange={(e) => onUpdate({ supplier: e.target.value || null })}
            placeholder="ej. mueblista"
            className="w-32 bg-white border border-gray-300 rounded px-1.5 py-0.5 outline-none focus:border-gray-500"
          />
          <span className="text-gray-300">·</span>
          <span>costo total</span>
          <ThousandsInput
            value={item.costDistributor}
            onChange={(v) => onUpdate({ costDistributor: v })}
            placeholder="0"
            className="w-24 bg-white border border-gray-300 rounded px-1.5 py-0.5 text-right tabular-nums outline-none focus:border-gray-500"
          />
          <span className="text-gray-300 mx-1">·</span>
          <span className="text-gray-400 italic">
            o usá “Agregar del catálogo” abajo
          </span>
        </div>
      ) : (
        groups.map((g) => (
          <div key={g.sector || "__sin__"}>
            {/* Sub-encabezado del sector: SOLO si la línea tiene un sector
                asignado. Si no hay sectores, no mostramos "Sin sector" (era
                ruido cuando MJ no usa sectores); los herrajes se listan planos.
                El sector se asigna al agregar del catálogo (campo Sector). */}
            {g.sector && (
              <div className={`${ROW_GRID} px-4 pt-1.5 pb-0.5 border-b border-gray-50`}>
                <div></div>
                <div className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider">
                  Sector {g.sector}
                </div>
                <div></div>
                <div></div>
                <div></div>
              </div>
            )}

            {/* Cada herraje del sector */}
            {g.lines.map((h) => (
              <div
                key={h.id}
                className={`${ROW_GRID} px-4 py-0.5 border-b border-gray-50`}
              >
                <div></div>
                {/* Columna PARTIDA: nombre + medida + color + proveedor.
                    Flex (no grid anidado): el grid anidado colapsaba la columna
                    del nombre a ~1 carácter y lo dibujaba en vertical. */}
                <div className="flex items-baseline gap-2 min-w-0">
                  {/* Nombre editable (commit al salir del campo). */}
                  <HerrajeNameInput
                    value={h.name}
                    onCommit={(name) => onUpdateHerraje(h.id, { name })}
                  />
                  {(h.measure || h.finish) && (
                    <span className="shrink-0 text-[10px] text-gray-500 self-center">
                      {[h.measure, h.finish]
                        .filter(Boolean)
                        .map((s) => (s as string).toUpperCase())
                        .join(" · ")}
                    </span>
                  )}
                  <span className="shrink-0 text-[9px] uppercase tracking-wider text-gray-400 self-center">
                    {h.supplier}
                  </span>
                  {/* Costo unitario (read-only, gris). */}
                  <span className="shrink-0 w-16 text-[10px] text-right tabular-nums text-gray-400 self-center">
                    {formatCLP(h.costNet)}
                  </span>
                </div>
                {/* Cantidad editable (commit al salir del campo) + subtotal. */}
                <HerrajeQtyInput
                  value={h.quantity}
                  costNet={h.costNet}
                  onCommit={(qty) => onUpdateHerraje(h.id, { quantity: qty })}
                />
                <button
                  onClick={() => onDeleteHerraje(h.id)}
                  className="text-gray-300 hover:text-red-500 text-xs leading-none"
                  title="Eliminar herraje"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        ))
      )}

      {/* Botón "Agregar del catálogo" + modal */}
      <div className={`${ROW_GRID} px-4 pb-1 pt-1 border-b border-gray-100`}>
        <div></div>
        <button
          onClick={() => setShowCatalog((v) => !v)}
          className="text-[10px] text-gray-400 hover:text-gray-900 text-left"
        >
          {showCatalog ? "Cerrar catálogo" : "Agregar del catálogo"}
        </button>
        <div></div>
        <div></div>
        <div></div>
      </div>

      {showCatalog && (
        <AddHerrajeFromCatalog
          budgetId={budgetId}
          itemId={item.id}
          existingSectors={existingSectors}
          onAdded={(line, updated) =>
            onHerrajeAdded(line as MuebleHerraje, updated as Partial<MuebleItem>)
          }
          onClose={() => setShowCatalog(false)}
        />
      )}

      {/* Costo interno de la partida — sobrio, gris. Margen editable. */}
      <div className="px-4 py-1.5 border-b border-gray-200 bg-gray-50">
        <div className="flex items-center flex-wrap gap-x-2 gap-y-1 text-[11px] text-gray-600">
          <span className="font-medium text-gray-700">Costo interno</span>
          <span className="text-gray-900 tabular-nums">
            {formatCLP(item.costDistributor)}
          </span>
          <span className="text-gray-300">·</span>
          <span>margen</span>
          <input
            type="number"
            step="1"
            value={marginPct || ""}
            onChange={(e) =>
              onUpdate({
                utilityPercentage: (parseFloat(e.target.value) || 0) / 100,
              })
            }
            placeholder="20"
            className="w-12 bg-white border border-gray-300 rounded px-1.5 py-0.5 text-right tabular-nums outline-none focus:border-gray-500 text-gray-900"
          />
          <span>%</span>
          <span className="text-gray-300">·</span>
          <span>cliente</span>
          <span className="text-gray-900 font-medium tabular-nums">
            {formatCLP(item.clientPriceIva)}
          </span>
          {/* Utilidad de la partida (igual que muebles/cubiertas): el margen en
              $ = precio neto al cliente − costo. */}
          <span className="text-gray-300">·</span>
          <span className="text-green-700 font-medium tabular-nums">
            util {formatCLP(item.clientPriceNet - item.costDistributor)}
          </span>
        </div>
      </div>
    </>
  );
}
