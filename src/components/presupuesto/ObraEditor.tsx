"use client";

import { useState, useEffect, useRef, Fragment } from "react";
import { useRouter } from "next/navigation";
import { OBRA_CHAPTERS, ObraChapter, formatCLP } from "@/lib/utils";

interface ObraItem {
  id: string;
  chapter: string;
  itemNumber: string;
  name: string;
  description: string | null;
  unit: string;
  quantity: number;
  unitPrice: number;
  total: number;
  costMaterial: number | null;
  costLabor: number | null;
  costSubcontract: number | null;
  costMargin: number | null;
  costTools: number | null;
  costLoss: number | null;
  sortOrder: number;
}

interface PaymentTerm {
  id: string;
  stage: string;
  percentage: number;
  amount: number | null;
  sortOrder: number;
}

interface Budget {
  id: string;
  version: string;
  status: string;
  type: string;
  observations: string | null;
  ggPercentage: number | null;
  utilityPercentage: number | null;
  obraItems: ObraItem[];
  paymentTerms: PaymentTerm[];
}

interface CatalogPartida {
  id: string;
  category: string;
  name: string;
  unit: string;
  unitPrice: number;
  costMaterial: number;
  costLabor: number;
  costTools: number;
  costMargin: number;
  costLoss: number;
  costSubcontract: number;
}

const UNITS = ["M2", "ML", "UN", "GL", "M3", "KG", "DIA"];

const DEFAULT_PAYMENT_TERMS = [
  { stage: "Anticipo", percentage: 40 },
  { stage: "Avance 1", percentage: 25 },
  { stage: "Avance 2", percentage: 25 },
  { stage: "Saldo final", percentage: 10 },
];

export default function ObraEditor({
  budget: initialBudget,
  projectId,
}: {
  budget: Budget;
  projectId: string;
}) {
  const router = useRouter();
  const [items, setItems] = useState<ObraItem[]>(initialBudget.obraItems);
  const [ggPercent, setGgPercent] = useState(initialBudget.ggPercentage || 20);
  const [utilPercent, setUtilPercent] = useState(
    initialBudget.utilityPercentage || 5
  );
  const [observations, setObservations] = useState(
    initialBudget.observations || ""
  );
  const [paymentTerms, setPaymentTerms] = useState<
    { stage: string; percentage: number }[]
  >(
    initialBudget.paymentTerms.length > 0
      ? initialBudget.paymentTerms.map((t) => ({
          stage: t.stage,
          percentage: t.percentage,
        }))
      : DEFAULT_PAYMENT_TERMS
  );
  const [saving, setSaving] = useState(false);
  const [addingChapter, setAddingChapter] = useState<string | null>(null);
  const [expandedItems, setExpandedItems] = useState<Record<string, boolean>>({});

  // Catalog search state
  const [catalogQuery, setCatalogQuery] = useState("");
  const [catalogResults, setCatalogResults] = useState<CatalogPartida[]>([]);
  const [searchingCatalog, setSearchingCatalog] = useState(false);
  const [showManualForm, setShowManualForm] = useState(false);
  const [selectedCatalog, setSelectedCatalog] = useState<CatalogPartida | null>(null);
  const searchRef = useRef<HTMLDivElement>(null);

  // New item state (for both catalog-selected and manual)
  const [newItem, setNewItem] = useState({
    name: "",
    description: "",
    unit: "GL",
    quantity: 0,
    unitPrice: 0,
  });

  // Search catalog with debounce
  useEffect(() => {
    if (!catalogQuery || catalogQuery.length < 2) {
      setCatalogResults([]);
      return;
    }
    const timer = setTimeout(async () => {
      setSearchingCatalog(true);
      try {
        const res = await fetch(
          `/api/catalogo/partidas?q=${encodeURIComponent(catalogQuery)}&limit=15`
        );
        const data = await res.json();
        setCatalogResults(data);
      } catch {
        setCatalogResults([]);
      } finally {
        setSearchingCatalog(false);
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [catalogQuery]);

  // Close dropdown on click outside
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
        setCatalogResults([]);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Calculos
  const costoDirecto = items.reduce((sum, item) => sum + item.total, 0);
  const gastosGenerales = costoDirecto * (ggPercent / 100);
  const subtotal = costoDirecto + gastosGenerales;
  const utilidad = subtotal * (utilPercent / 100);
  const neto = subtotal + utilidad;
  const iva = neto * 0.19;
  const totalConIva = neto + iva;

  // Agrupar por capitulo
  const chapters = Object.entries(OBRA_CHAPTERS) as [
    ObraChapter,
    { label: string; index: number }
  ][];
  const itemsByChapter = chapters.map(([key, chapter]) => ({
    key,
    ...chapter,
    items: items
      .filter((item) => item.chapter === key)
      .sort((a, b) => a.sortOrder - b.sortOrder),
    subtotal: items
      .filter((item) => item.chapter === key)
      .reduce((sum, item) => sum + item.total, 0),
  }));

  function handleSelectFromCatalog(partida: CatalogPartida) {
    setSelectedCatalog(partida);
    setNewItem({
      name: partida.name,
      description: "",
      unit: partida.unit,
      quantity: 0,
      unitPrice: Math.round(partida.unitPrice),
    });
    setCatalogQuery("");
    setCatalogResults([]);
    setShowManualForm(false);
  }

  function handleStartManual() {
    setSelectedCatalog(null);
    setShowManualForm(true);
    setCatalogResults([]);
    setNewItem({ name: catalogQuery, description: "", unit: "GL", quantity: 0, unitPrice: 0 });
  }

  function resetAddForm() {
    setCatalogQuery("");
    setCatalogResults([]);
    setSelectedCatalog(null);
    setShowManualForm(false);
    setNewItem({ name: "", description: "", unit: "GL", quantity: 0, unitPrice: 0 });
    setAddingChapter(null);
  }

  async function handleAddItem(chapter: string) {
    if (!newItem.name) return;

    try {
      const body: any = { ...newItem, chapter };
      if (selectedCatalog) {
        body.catalogPartidaId = selectedCatalog.id;
        body.costMaterial = selectedCatalog.costMaterial;
        body.costLabor = selectedCatalog.costLabor;
        body.costSubcontract = selectedCatalog.costSubcontract;
        body.costMargin = selectedCatalog.costMargin;
        body.costTools = selectedCatalog.costTools;
        body.costLoss = selectedCatalog.costLoss;
      }

      const res = await fetch(
        `/api/presupuestos/${initialBudget.id}/partidas`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      );

      if (!res.ok) throw new Error("Error");
      const created = await res.json();
      setItems([...items, created]);

      // Si es manual y no existe en catalogo, guardar al catalogo
      if (!selectedCatalog && newItem.name) {
        saveToCatalog(chapter, newItem);
      }

      resetAddForm();
    } catch {
      alert("Error al agregar partida");
    }
  }

  async function saveToCatalog(
    chapter: string,
    item: { name: string; unit: string; unitPrice: number }
  ) {
    try {
      // Map chapter key to a category name for the catalog
      const chapterEntry = OBRA_CHAPTERS[chapter as ObraChapter];
      const categoryName = chapterEntry
        ? chapterEntry.label.toUpperCase()
        : chapter.toUpperCase();

      await fetch("/api/catalogo/partidas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          category: categoryName,
          name: item.name,
          unit: item.unit,
          unitPrice: item.unitPrice,
        }),
      });
    } catch {
      // silently fail - catalog save is best-effort
    }
  }

  async function handleDeleteItem(itemId: string) {
    try {
      await fetch(
        `/api/presupuestos/${initialBudget.id}/partidas/${itemId}`,
        { method: "DELETE" }
      );
      setItems(items.filter((i) => i.id !== itemId));
    } catch {
      alert("Error al eliminar partida");
    }
  }

  async function handleUpdateItem(
    itemId: string,
    field: string,
    value: string | number
  ) {
    const BREAKDOWN_FIELDS = [
      "costMaterial",
      "costLabor",
      "costSubcontract",
      "costMargin",
      "costTools",
      "costLoss",
    ];
    const updatedItems = items.map((item) => {
      if (item.id !== itemId) return item;
      const updated = { ...item, [field]: value };
      // Si cambió un componente del desglose → P.U = suma del desglose
      if (BREAKDOWN_FIELDS.includes(field)) {
        updated.unitPrice =
          (updated.costMaterial ?? 0) +
          (updated.costLabor ?? 0) +
          (updated.costSubcontract ?? 0) +
          (updated.costMargin ?? 0) +
          (updated.costTools ?? 0) +
          (updated.costLoss ?? 0);
      }
      if (
        field === "quantity" ||
        field === "unitPrice" ||
        BREAKDOWN_FIELDS.includes(field)
      ) {
        updated.total = updated.quantity * updated.unitPrice;
      }
      return updated;
    });
    setItems(updatedItems);

    const item = updatedItems.find((i) => i.id === itemId);
    if (!item) return;

    try {
      await fetch(
        `/api/presupuestos/${initialBudget.id}/partidas/${itemId}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(item),
        }
      );
    } catch {
      // silently fail, item is updated locally
    }
  }

  async function handleSaveConfig() {
    setSaving(true);
    try {
      await fetch(`/api/presupuestos/${initialBudget.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ggPercentage: ggPercent,
          utilityPercentage: utilPercent,
          observations,
        }),
      });

      await fetch(`/api/presupuestos/${initialBudget.id}/forma-pago`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          terms: paymentTerms.map((t) => ({
            stage: t.stage,
            percentage: t.percentage,
            amount: (totalConIva * t.percentage) / 100,
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

  return (
    <div className="space-y-6">
      {/* Configuracion GG + Utilidad */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">
          Configuracion
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Gastos Generales (%)
            </label>
            <input
              type="number"
              step="0.1"
              value={ggPercent}
              onChange={(e) => setGgPercent(parseFloat(e.target.value) || 0)}
              className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-gray-900 focus:border-transparent outline-none"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Utilidad (%)
            </label>
            <input
              type="number"
              step="0.1"
              value={utilPercent}
              onChange={(e) => setUtilPercent(parseFloat(e.target.value) || 0)}
              className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-gray-900 focus:border-transparent outline-none"
            />
          </div>
          <div className="flex items-end">
            <button
              onClick={handleSaveConfig}
              disabled={saving}
              className="bg-gray-900 text-white px-6 py-2.5 rounded-lg text-sm font-medium hover:bg-gray-800 transition-colors disabled:opacity-50"
            >
              {saving ? "Guardando..." : "Guardar Config"}
            </button>
          </div>
        </div>
      </div>

      {/* Tabla de partidas por capitulo */}
      {itemsByChapter.map((chapter) => (
        <div
          key={chapter.key}
          className="bg-white rounded-xl border border-gray-200 overflow-visible"
        >
          <div className="flex items-center justify-between p-4 bg-gray-50 border-b border-gray-200">
            <h3 className="font-semibold text-gray-900">
              {chapter.index}. {chapter.label}
            </h3>
            <div className="flex items-center gap-4">
              <span className="text-sm font-medium text-gray-600">
                Subtotal: {formatCLP(chapter.subtotal)}
              </span>
              <button
                onClick={() => {
                  resetAddForm();
                  setAddingChapter(chapter.key);
                }}
                className="text-sm text-gray-600 hover:text-gray-900 font-medium"
              >
                + Agregar
              </button>
            </div>
          </div>

          {chapter.items.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100">
                    <th className="text-left px-4 py-2 text-xs text-gray-500 w-16">
                      N°
                    </th>
                    <th className="text-left px-4 py-2 text-xs text-gray-500">
                      Partida
                    </th>
                    <th className="text-left px-4 py-2 text-xs text-gray-500 w-20">
                      Unidad
                    </th>
                    <th className="text-right px-4 py-2 text-xs text-gray-500 w-24">
                      Cantidad
                    </th>
                    <th className="text-right px-4 py-2 text-xs text-gray-500 w-32">
                      P. Unitario
                    </th>
                    <th className="text-right px-4 py-2 text-xs text-gray-500 w-32">
                      Total
                    </th>
                    <th className="w-10"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {chapter.items.map((item) => (
                    <Fragment key={item.id}>
                    <tr className="hover:bg-gray-50">
                      <td className="px-4 py-2 text-gray-500">
                        <button
                          type="button"
                          onClick={() => {
                            const willOpen = !expandedItems[item.id];
                            setExpandedItems((prev) => ({
                              ...prev,
                              [item.id]: willOpen,
                            }));
                            const sum =
                              (item.costMaterial ?? 0) +
                              (item.costLabor ?? 0) +
                              (item.costSubcontract ?? 0) +
                              (item.costMargin ?? 0) +
                              (item.costTools ?? 0) +
                              (item.costLoss ?? 0);
                            if (willOpen && sum === 0 && item.unitPrice > 0) {
                              // Desglose vacío → seed Material = P.U
                              handleUpdateItem(
                                item.id,
                                "costMaterial",
                                item.unitPrice
                              );
                            } else if (willOpen && sum > 0 && sum !== item.unitPrice) {
                              // Desglose no cuadra con P.U → sincronizar P.U = suma
                              handleUpdateItem(item.id, "unitPrice", sum);
                            }
                          }}
                          className="mr-1 text-gray-400 hover:text-gray-700"
                          title="Ver desglose"
                        >
                          {expandedItems[item.id] ? "▾" : "▸"}
                        </button>
                        {item.itemNumber}
                      </td>
                      <td className="px-4 py-2">
                        <input
                          type="text"
                          value={item.name}
                          onChange={(e) =>
                            handleUpdateItem(item.id, "name", e.target.value)
                          }
                          className="w-full bg-transparent border-0 p-0 text-gray-900 focus:ring-0 outline-none"
                        />
                      </td>
                      <td className="px-4 py-2">
                        <select
                          value={item.unit}
                          onChange={(e) =>
                            handleUpdateItem(item.id, "unit", e.target.value)
                          }
                          className="bg-transparent border-0 p-0 text-gray-600 focus:ring-0 outline-none text-sm"
                        >
                          {UNITS.map((u) => (
                            <option key={u} value={u}>
                              {u}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="px-4 py-2">
                        <input
                          type="number"
                          step="0.01"
                          value={item.quantity}
                          onChange={(e) =>
                            handleUpdateItem(
                              item.id,
                              "quantity",
                              parseFloat(e.target.value) || 0
                            )
                          }
                          className="w-full bg-transparent border-0 p-0 text-right text-gray-900 focus:ring-0 outline-none"
                        />
                      </td>
                      <td className="px-4 py-2">
                        <div className="flex items-center justify-end">
                          <span className="text-gray-900">$</span>
                          <input
                            type="number"
                            step="1"
                            value={item.unitPrice}
                            onChange={(e) =>
                              handleUpdateItem(
                                item.id,
                                "unitPrice",
                                parseFloat(e.target.value) || 0
                              )
                            }
                            className="w-20 bg-transparent border-0 p-0 text-right text-gray-900 focus:ring-0 outline-none"
                          />
                        </div>
                      </td>
                      <td className="px-4 py-2 text-right font-medium text-gray-900">
                        {formatCLP(item.total)}
                      </td>
                      <td className="px-4 py-2">
                        <button
                          onClick={() => handleDeleteItem(item.id)}
                          className="text-gray-400 hover:text-red-500 transition-colors"
                          title="Eliminar"
                        >
                          x
                        </button>
                      </td>
                    </tr>
                    {expandedItems[item.id] && (
                      <tr className="bg-gray-50">
                        <td colSpan={7} className="px-4 py-3">
                          <div className="grid grid-cols-2 md:grid-cols-7 gap-3 text-xs">
                            {([
                              ["Material", "costMaterial"],
                              ["Mano de obra", "costLabor"],
                              ["Herramientas", "costTools"],
                              ["Subcontrato", "costSubcontract"],
                              ["Pérdida", "costLoss"],
                              ["Margen", "costMargin"],
                            ] as const).map(([label, field]) => (
                              <label key={field} className="flex flex-col">
                                <span className="text-gray-500 mb-1">{label}</span>
                                <div className="relative">
                                  <span className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-500 pointer-events-none">
                                    $
                                  </span>
                                  <input
                                    type="number"
                                    step="1"
                                    value={(item[field] as number | null) ?? 0}
                                    onChange={(e) =>
                                      handleUpdateItem(
                                        item.id,
                                        field,
                                        parseFloat(e.target.value) || 0
                                      )
                                    }
                                    className="w-full border border-gray-300 rounded pl-6 pr-2 py-1 text-right"
                                  />
                                </div>
                              </label>
                            ))}
                            <div className="flex flex-col justify-end">
                              <span className="text-gray-500 mb-1">Suma desglose</span>
                              <span className="text-gray-900 font-medium px-2 py-1 text-right">
                                {formatCLP(
                                  (item.costMaterial ?? 0) +
                                    (item.costLabor ?? 0) +
                                    (item.costSubcontract ?? 0) +
                                    (item.costMargin ?? 0) +
                                    (item.costTools ?? 0) +
                                    (item.costLoss ?? 0)
                                )}
                              </span>
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Panel agregar partida desde catalogo */}
          {addingChapter === chapter.key && (
            <div className="p-4 border-t border-gray-100 bg-blue-50">
              {/* Step 1: Search catalog or go manual */}
              {!selectedCatalog && !showManualForm && (
                <div ref={searchRef} className="relative">
                  <div className="flex gap-2 items-center">
                    <div className="flex-1 relative">
                      <input
                        type="text"
                        value={catalogQuery}
                        onChange={(e) => setCatalogQuery(e.target.value)}
                        className="w-full px-4 py-2.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-gray-900 focus:border-transparent outline-none"
                        placeholder="Buscar partida en catalogo... (ej: demolicion muro, enchape)"
                        autoFocus
                      />
                      {searchingCatalog && (
                        <div className="absolute right-3 top-3">
                          <div className="w-4 h-4 border-2 border-gray-300 border-t-gray-600 rounded-full animate-spin" />
                        </div>
                      )}
                    </div>
                    <button
                      onClick={handleStartManual}
                      className="text-sm text-gray-600 hover:text-gray-900 font-medium whitespace-nowrap px-3 py-2.5 border border-gray-300 rounded-lg bg-white hover:bg-gray-50"
                    >
                      Crear nueva
                    </button>
                    <button
                      onClick={resetAddForm}
                      className="text-gray-400 hover:text-gray-600 px-2 py-2.5"
                    >
                      Cancelar
                    </button>
                  </div>

                  {/* Search results dropdown */}
                  {catalogResults.length > 0 && (
                    <div className="absolute z-10 left-0 right-16 mt-1 bg-white rounded-lg border border-gray-200 shadow-lg max-h-72 overflow-y-auto">
                      {catalogResults.map((p) => (
                        <button
                          key={p.id}
                          onClick={() => handleSelectFromCatalog(p)}
                          className="w-full text-left px-4 py-3 hover:bg-gray-50 border-b border-gray-50 last:border-0 transition-colors"
                        >
                          <div className="flex items-center justify-between">
                            <div>
                              <span className="text-sm font-medium text-gray-900">
                                {p.name}
                              </span>
                              <span className="ml-2 text-xs text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded">
                                {p.unit}
                              </span>
                              <span className="ml-2 text-xs text-gray-400">
                                {p.category}
                              </span>
                            </div>
                            <span className="text-sm font-medium text-gray-600">
                              {formatCLP(p.unitPrice)}/{p.unit}
                            </span>
                          </div>
                        </button>
                      ))}
                    </div>
                  )}

                  {/* No results message */}
                  {catalogQuery.length >= 2 &&
                    !searchingCatalog &&
                    catalogResults.length === 0 && (
                      <div className="absolute z-10 left-0 right-16 mt-1 bg-white rounded-lg border border-gray-200 shadow-lg p-4">
                        <p className="text-sm text-gray-500 mb-2">
                          No se encontraron partidas para &quot;{catalogQuery}&quot;
                        </p>
                        <button
                          onClick={handleStartManual}
                          className="text-sm text-blue-600 hover:text-blue-800 font-medium"
                        >
                          Crear partida nueva manualmente
                        </button>
                      </div>
                    )}
                </div>
              )}

              {/* Step 2a: Catalog partida selected - just need quantity */}
              {selectedCatalog && (
                <div>
                  <div className="flex items-center gap-2 mb-3">
                    <span className="text-xs text-gray-500 bg-green-100 text-green-700 px-2 py-0.5 rounded font-medium">
                      Del catalogo
                    </span>
                    <span className="text-sm font-medium text-gray-900">
                      {selectedCatalog.name}
                    </span>
                    <button
                      onClick={() => {
                        setSelectedCatalog(null);
                        setCatalogQuery("");
                      }}
                      className="text-xs text-gray-400 hover:text-gray-600 ml-1"
                    >
                      (cambiar)
                    </button>
                  </div>
                  <div className="grid grid-cols-12 gap-2 items-end">
                    <div className="col-span-4">
                      <label className="block text-xs text-gray-600 mb-1">
                        Nombre
                      </label>
                      <input
                        type="text"
                        value={newItem.name}
                        onChange={(e) =>
                          setNewItem({ ...newItem, name: e.target.value })
                        }
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-gray-900 focus:border-transparent outline-none"
                      />
                    </div>
                    <div className="col-span-2">
                      <label className="block text-xs text-gray-600 mb-1">
                        Unidad
                      </label>
                      <select
                        value={newItem.unit}
                        onChange={(e) =>
                          setNewItem({ ...newItem, unit: e.target.value })
                        }
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-gray-900 focus:border-transparent outline-none"
                      >
                        {UNITS.map((u) => (
                          <option key={u} value={u}>
                            {u}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="col-span-2">
                      <label className="block text-xs text-gray-600 mb-1">
                        Cantidad
                      </label>
                      <input
                        type="number"
                        step="0.01"
                        value={newItem.quantity || ""}
                        onChange={(e) =>
                          setNewItem({
                            ...newItem,
                            quantity: parseFloat(e.target.value) || 0,
                          })
                        }
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-gray-900 focus:border-transparent outline-none"
                        autoFocus
                      />
                    </div>
                    <div className="col-span-2">
                      <label className="block text-xs text-gray-600 mb-1">
                        P. Unitario
                      </label>
                      <input
                        type="number"
                        step="1"
                        value={newItem.unitPrice || ""}
                        onChange={(e) =>
                          setNewItem({
                            ...newItem,
                            unitPrice: parseFloat(e.target.value) || 0,
                          })
                        }
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-gray-900 focus:border-transparent outline-none"
                      />
                    </div>
                    <div className="col-span-2 flex gap-2">
                      <button
                        onClick={() => handleAddItem(chapter.key)}
                        className="bg-gray-900 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-gray-800"
                      >
                        Agregar
                      </button>
                      <button
                        onClick={resetAddForm}
                        className="text-gray-500 px-3 py-2 rounded-lg text-sm hover:bg-gray-200"
                      >
                        Cancelar
                      </button>
                    </div>
                  </div>
                  {newItem.quantity > 0 && (
                    <div className="mt-2 text-xs text-gray-500">
                      Total estimado:{" "}
                      <span className="font-medium text-gray-700">
                        {formatCLP(newItem.quantity * newItem.unitPrice)}
                      </span>
                    </div>
                  )}
                </div>
              )}

              {/* Step 2b: Manual form */}
              {showManualForm && (
                <div>
                  <div className="flex items-center gap-2 mb-3">
                    <span className="text-xs bg-yellow-100 text-yellow-700 px-2 py-0.5 rounded font-medium">
                      Nueva partida
                    </span>
                    <span className="text-xs text-gray-400">
                      Se guardara automaticamente en el catalogo
                    </span>
                    <button
                      onClick={() => {
                        setShowManualForm(false);
                        setCatalogQuery("");
                      }}
                      className="text-xs text-gray-400 hover:text-gray-600 ml-1"
                    >
                      (buscar en catalogo)
                    </button>
                  </div>
                  <div className="grid grid-cols-12 gap-2 items-end">
                    <div className="col-span-4">
                      <label className="block text-xs text-gray-600 mb-1">
                        Nombre
                      </label>
                      <input
                        type="text"
                        value={newItem.name}
                        onChange={(e) =>
                          setNewItem({ ...newItem, name: e.target.value })
                        }
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-gray-900 focus:border-transparent outline-none"
                        placeholder="Nombre de la partida"
                        autoFocus
                      />
                    </div>
                    <div className="col-span-2">
                      <label className="block text-xs text-gray-600 mb-1">
                        Unidad
                      </label>
                      <select
                        value={newItem.unit}
                        onChange={(e) =>
                          setNewItem({ ...newItem, unit: e.target.value })
                        }
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-gray-900 focus:border-transparent outline-none"
                      >
                        {UNITS.map((u) => (
                          <option key={u} value={u}>
                            {u}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="col-span-2">
                      <label className="block text-xs text-gray-600 mb-1">
                        Cantidad
                      </label>
                      <input
                        type="number"
                        step="0.01"
                        value={newItem.quantity || ""}
                        onChange={(e) =>
                          setNewItem({
                            ...newItem,
                            quantity: parseFloat(e.target.value) || 0,
                          })
                        }
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-gray-900 focus:border-transparent outline-none"
                      />
                    </div>
                    <div className="col-span-2">
                      <label className="block text-xs text-gray-600 mb-1">
                        P. Unitario
                      </label>
                      <input
                        type="number"
                        step="1"
                        value={newItem.unitPrice || ""}
                        onChange={(e) =>
                          setNewItem({
                            ...newItem,
                            unitPrice: parseFloat(e.target.value) || 0,
                          })
                        }
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-gray-900 focus:border-transparent outline-none"
                      />
                    </div>
                    <div className="col-span-2 flex gap-2">
                      <button
                        onClick={() => handleAddItem(chapter.key)}
                        className="bg-gray-900 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-gray-800"
                      >
                        Agregar
                      </button>
                      <button
                        onClick={resetAddForm}
                        className="text-gray-500 px-3 py-2 rounded-lg text-sm hover:bg-gray-200"
                      >
                        Cancelar
                      </button>
                    </div>
                  </div>
                  {newItem.quantity > 0 && newItem.unitPrice > 0 && (
                    <div className="mt-2 text-xs text-gray-500">
                      Total estimado:{" "}
                      <span className="font-medium text-gray-700">
                        {formatCLP(newItem.quantity * newItem.unitPrice)}
                      </span>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      ))}

      {/* Resumen financiero */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">
          Resumen Presupuesto
        </h2>
        <div className="max-w-md space-y-2">
          <div className="flex justify-between text-sm">
            <span className="text-gray-600">Costo Directo</span>
            <span className="font-medium">{formatCLP(costoDirecto)}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-gray-600">
              Gastos Generales ({ggPercent}%)
            </span>
            <span className="font-medium">{formatCLP(gastosGenerales)}</span>
          </div>
          <div className="flex justify-between text-sm border-t border-gray-100 pt-2">
            <span className="text-gray-600">Subtotal</span>
            <span className="font-medium">{formatCLP(subtotal)}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-gray-600">Utilidad ({utilPercent}%)</span>
            <span className="font-medium">{formatCLP(utilidad)}</span>
          </div>
          <div className="flex justify-between text-sm border-t border-gray-100 pt-2">
            <span className="text-gray-600">Neto</span>
            <span className="font-medium">{formatCLP(neto)}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-gray-600">IVA (19%)</span>
            <span className="font-medium">{formatCLP(iva)}</span>
          </div>
          <div className="flex justify-between text-base font-bold border-t-2 border-gray-900 pt-2">
            <span>Total con IVA</span>
            <span>{formatCLP(totalConIva)}</span>
          </div>
        </div>
      </div>

      {/* Forma de pago */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">
          Forma de Pago
        </h2>
        <div className="space-y-3 max-w-lg">
          {paymentTerms.map((term, index) => (
            <div key={index} className="grid grid-cols-12 gap-3 items-center">
              <div className="col-span-5">
                <input
                  type="text"
                  value={term.stage}
                  onChange={(e) => {
                    const updated = [...paymentTerms];
                    updated[index] = {
                      ...updated[index],
                      stage: e.target.value,
                    };
                    setPaymentTerms(updated);
                  }}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-gray-900 focus:border-transparent outline-none"
                />
              </div>
              <div className="col-span-3">
                <div className="flex items-center gap-1">
                  <input
                    type="number"
                    step="1"
                    value={term.percentage}
                    onChange={(e) => {
                      const updated = [...paymentTerms];
                      updated[index] = {
                        ...updated[index],
                        percentage: parseFloat(e.target.value) || 0,
                      };
                      setPaymentTerms(updated);
                    }}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-gray-900 focus:border-transparent outline-none"
                  />
                  <span className="text-sm text-gray-500">%</span>
                </div>
              </div>
              <div className="col-span-3 text-sm text-right text-gray-600">
                {formatCLP((totalConIva * term.percentage) / 100)}
              </div>
              <div className="col-span-1">
                <button
                  onClick={() => {
                    setPaymentTerms(
                      paymentTerms.filter((_, i) => i !== index)
                    );
                  }}
                  className="text-gray-400 hover:text-red-500 text-sm"
                >
                  x
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
              className="text-sm text-gray-600 hover:text-gray-900 font-medium"
            >
              + Agregar etapa
            </button>
            <span className="text-sm text-gray-500">
              Total:{" "}
              {paymentTerms.reduce((sum, t) => sum + t.percentage, 0)}%
            </span>
          </div>
        </div>
      </div>

      {/* Observaciones */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">
          Observaciones y Condiciones
        </h2>
        <textarea
          value={observations}
          onChange={(e) => setObservations(e.target.value)}
          rows={6}
          className="w-full px-4 py-3 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-gray-900 focus:border-transparent outline-none resize-none"
          placeholder="Condiciones del presupuesto, plazos, exclusiones, etc."
        />
      </div>

      {/* Boton guardar todo */}
      <div className="flex justify-end">
        <button
          onClick={handleSaveConfig}
          disabled={saving}
          className="bg-gray-900 text-white px-8 py-3 rounded-lg font-medium hover:bg-gray-800 transition-colors disabled:opacity-50"
        >
          {saving ? "Guardando..." : "Guardar Todo"}
        </button>
      </div>
    </div>
  );
}
