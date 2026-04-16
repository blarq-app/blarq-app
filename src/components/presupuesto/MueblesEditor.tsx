"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { formatCLP } from "@/lib/utils";

interface MuebleItem {
  id: string;
  subcategory: string;
  description: string;
  supplier: string | null;
  costDistributor: number;
  utilityPercentage: number;
  clientPrice: number;
  clientPriceIva: number;
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
  muebleItems: MuebleItem[];
  paymentTerms: PaymentTerm[];
}

const SUBCATEGORIES = [
  { value: "mueble", label: "Mueble" },
  { value: "cubierta", label: "Cubierta" },
  { value: "herraje", label: "Herraje" },
];

const DEFAULT_PAYMENT = [
  { stage: "Anticipo", percentage: 60 },
  { stage: "Avance", percentage: 30 },
  { stage: "Saldo final", percentage: 10 },
];

export default function MueblesEditor({
  budget: initialBudget,
  projectId,
}: {
  budget: Budget;
  projectId: string;
}) {
  const router = useRouter();
  const [items, setItems] = useState<MuebleItem[]>(initialBudget.muebleItems);
  const [observations, setObservations] = useState(initialBudget.observations || "");
  const [paymentTerms, setPaymentTerms] = useState(
    initialBudget.paymentTerms.length > 0
      ? initialBudget.paymentTerms.map((t) => ({ stage: t.stage, percentage: t.percentage }))
      : DEFAULT_PAYMENT
  );
  const [saving, setSaving] = useState(false);
  const [adding, setAdding] = useState(false);
  const [newItem, setNewItem] = useState({
    subcategory: "mueble",
    description: "",
    supplier: "",
    costDistributor: 0,
    utilityPercentage: 30,
  });

  // Totales
  const totalCostBlarq = items.reduce((sum, i) => sum + i.costDistributor, 0);
  const totalClientNeto = items.reduce((sum, i) => sum + i.clientPrice, 0);
  const totalClientIva = items.reduce((sum, i) => sum + i.clientPriceIva, 0);
  const totalUtilidad = totalClientNeto - totalCostBlarq;

  // Agrupar por subcategoría
  const grouped = SUBCATEGORIES.map((sub) => ({
    ...sub,
    items: items.filter((i) => i.subcategory === sub.value),
    subtotal: items
      .filter((i) => i.subcategory === sub.value)
      .reduce((sum, i) => sum + i.clientPriceIva, 0),
  }));

  async function handleAddItem() {
    if (!newItem.description) return;
    try {
      const res = await fetch(`/api/presupuestos/${initialBudget.id}/muebles`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newItem),
      });
      if (!res.ok) throw new Error("Error");
      const created = await res.json();
      setItems([...items, created]);
      setNewItem({ subcategory: "mueble", description: "", supplier: "", costDistributor: 0, utilityPercentage: 30 });
      setAdding(false);
    } catch {
      alert("Error al agregar item");
    }
  }

  async function handleDeleteItem(itemId: string) {
    try {
      await fetch(`/api/presupuestos/${initialBudget.id}/muebles/${itemId}`, { method: "DELETE" });
      setItems(items.filter((i) => i.id !== itemId));
    } catch {
      alert("Error al eliminar");
    }
  }

  async function handleUpdateItem(itemId: string, field: string, value: string | number) {
    const updatedItems = items.map((item) => {
      if (item.id !== itemId) return item;
      const updated = { ...item, [field]: value };
      if (field === "costDistributor" || field === "utilityPercentage") {
        updated.clientPrice = updated.costDistributor * (1 + updated.utilityPercentage / 100);
        updated.clientPriceIva = updated.clientPrice * 1.19;
      }
      return updated;
    });
    setItems(updatedItems);

    const item = updatedItems.find((i) => i.id === itemId);
    if (!item) return;
    try {
      await fetch(`/api/presupuestos/${initialBudget.id}/muebles/${itemId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(item),
      });
    } catch { /* silent */ }
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
            amount: (totalClientIva * t.percentage) / 100,
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
      {/* Tabla por subcategoría */}
      {grouped.map((group) => (
        <div key={group.value} className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="flex items-center justify-between p-4 bg-gray-50 border-b border-gray-200">
            <h3 className="font-semibold text-gray-900">{group.label}s</h3>
            <span className="text-sm font-medium text-gray-600">
              Subtotal IVA inc: {formatCLP(group.subtotal)}
            </span>
          </div>
          {group.items.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100">
                    <th className="text-left px-4 py-2 text-xs text-gray-500">Descripcion</th>
                    <th className="text-left px-4 py-2 text-xs text-gray-500">Proveedor</th>
                    <th className="text-right px-4 py-2 text-xs text-gray-500">Costo Dist.</th>
                    <th className="text-right px-4 py-2 text-xs text-gray-500">% Util.</th>
                    <th className="text-right px-4 py-2 text-xs text-gray-500">Precio Neto</th>
                    <th className="text-right px-4 py-2 text-xs text-gray-500">Precio IVA</th>
                    <th className="w-10"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {group.items.map((item) => (
                    <tr key={item.id} className="hover:bg-gray-50">
                      <td className="px-4 py-2">
                        <input type="text" value={item.description}
                          onChange={(e) => handleUpdateItem(item.id, "description", e.target.value)}
                          className="w-full bg-transparent border-0 p-0 text-gray-900 focus:ring-0 outline-none" />
                      </td>
                      <td className="px-4 py-2">
                        <input type="text" value={item.supplier || ""}
                          onChange={(e) => handleUpdateItem(item.id, "supplier", e.target.value)}
                          className="w-full bg-transparent border-0 p-0 text-gray-600 focus:ring-0 outline-none" />
                      </td>
                      <td className="px-4 py-2">
                        <input type="number" value={item.costDistributor}
                          onChange={(e) => handleUpdateItem(item.id, "costDistributor", parseFloat(e.target.value) || 0)}
                          className="w-24 bg-transparent border-0 p-0 text-right text-gray-900 focus:ring-0 outline-none" />
                      </td>
                      <td className="px-4 py-2">
                        <input type="number" step="1" value={item.utilityPercentage}
                          onChange={(e) => handleUpdateItem(item.id, "utilityPercentage", parseFloat(e.target.value) || 0)}
                          className="w-16 bg-transparent border-0 p-0 text-right text-gray-900 focus:ring-0 outline-none" />
                      </td>
                      <td className="px-4 py-2 text-right text-gray-600">{formatCLP(item.clientPrice)}</td>
                      <td className="px-4 py-2 text-right font-medium text-gray-900">{formatCLP(item.clientPriceIva)}</td>
                      <td className="px-4 py-2">
                        <button onClick={() => handleDeleteItem(item.id)} className="text-gray-400 hover:text-red-500">x</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ))}

      {/* Agregar item */}
      {!adding ? (
        <button onClick={() => setAdding(true)}
          className="text-sm text-gray-600 hover:text-gray-900 font-medium">
          + Agregar Item de Mueble
        </button>
      ) : (
        <div className="bg-blue-50 rounded-xl border border-blue-200 p-4">
          <div className="grid grid-cols-12 gap-3 items-end">
            <div className="col-span-2">
              <label className="block text-xs text-gray-600 mb-1">Tipo</label>
              <select value={newItem.subcategory} onChange={(e) => setNewItem({ ...newItem, subcategory: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white outline-none">
                {SUBCATEGORIES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
              </select>
            </div>
            <div className="col-span-3">
              <label className="block text-xs text-gray-600 mb-1">Descripcion</label>
              <input type="text" value={newItem.description}
                onChange={(e) => setNewItem({ ...newItem, description: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm outline-none" autoFocus />
            </div>
            <div className="col-span-2">
              <label className="block text-xs text-gray-600 mb-1">Proveedor</label>
              <input type="text" value={newItem.supplier}
                onChange={(e) => setNewItem({ ...newItem, supplier: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm outline-none" />
            </div>
            <div className="col-span-2">
              <label className="block text-xs text-gray-600 mb-1">Costo Dist.</label>
              <input type="number" value={newItem.costDistributor || ""}
                onChange={(e) => setNewItem({ ...newItem, costDistributor: parseFloat(e.target.value) || 0 })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm outline-none" />
            </div>
            <div className="col-span-1">
              <label className="block text-xs text-gray-600 mb-1">% Util.</label>
              <input type="number" value={newItem.utilityPercentage}
                onChange={(e) => setNewItem({ ...newItem, utilityPercentage: parseFloat(e.target.value) || 0 })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm outline-none" />
            </div>
            <div className="col-span-2 flex gap-2">
              <button onClick={handleAddItem} className="bg-gray-900 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-gray-800">Agregar</button>
              <button onClick={() => setAdding(false)} className="text-gray-500 px-3 py-2 rounded-lg text-sm hover:bg-gray-200">Cancelar</button>
            </div>
          </div>
        </div>
      )}

      {/* Resumen interno */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Resumen (Vista Interna)</h2>
        <div className="max-w-md space-y-2">
          <div className="flex justify-between text-sm">
            <span className="text-gray-600">Costo BLARQ (distribuidor)</span>
            <span className="font-medium">{formatCLP(totalCostBlarq)}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-gray-600">Precio Neto al Cliente</span>
            <span className="font-medium">{formatCLP(totalClientNeto)}</span>
          </div>
          <div className="flex justify-between text-sm text-green-700">
            <span>Utilidad</span>
            <span className="font-medium">{formatCLP(totalUtilidad)}</span>
          </div>
          <div className="flex justify-between text-base font-bold border-t-2 border-gray-900 pt-2">
            <span>Total al Cliente (IVA inc.)</span>
            <span>{formatCLP(totalClientIva)}</span>
          </div>
        </div>
      </div>

      {/* Forma de pago */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Forma de Pago</h2>
        <div className="space-y-3 max-w-lg">
          {paymentTerms.map((term, index) => (
            <div key={index} className="grid grid-cols-12 gap-3 items-center">
              <div className="col-span-5">
                <input type="text" value={term.stage}
                  onChange={(e) => { const u = [...paymentTerms]; u[index] = { ...u[index], stage: e.target.value }; setPaymentTerms(u); }}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm outline-none" />
              </div>
              <div className="col-span-3">
                <div className="flex items-center gap-1">
                  <input type="number" value={term.percentage}
                    onChange={(e) => { const u = [...paymentTerms]; u[index] = { ...u[index], percentage: parseFloat(e.target.value) || 0 }; setPaymentTerms(u); }}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm outline-none" />
                  <span className="text-sm text-gray-500">%</span>
                </div>
              </div>
              <div className="col-span-3 text-sm text-right text-gray-600">
                {formatCLP((totalClientIva * term.percentage) / 100)}
              </div>
              <div className="col-span-1">
                <button onClick={() => setPaymentTerms(paymentTerms.filter((_, i) => i !== index))} className="text-gray-400 hover:text-red-500 text-sm">x</button>
              </div>
            </div>
          ))}
          <div className="flex items-center justify-between pt-2 border-t border-gray-100">
            <button onClick={() => setPaymentTerms([...paymentTerms, { stage: `Etapa ${paymentTerms.length + 1}`, percentage: 0 }])}
              className="text-sm text-gray-600 hover:text-gray-900 font-medium">+ Agregar etapa</button>
            <span className="text-sm text-gray-500">Total: {paymentTerms.reduce((s, t) => s + t.percentage, 0)}%</span>
          </div>
        </div>
      </div>

      {/* Observaciones */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Observaciones</h2>
        <textarea value={observations} onChange={(e) => setObservations(e.target.value)}
          rows={4} className="w-full px-4 py-3 border border-gray-300 rounded-lg text-sm outline-none resize-none"
          placeholder="Condiciones de la cotizacion de muebles..." />
      </div>

      <div className="flex justify-end">
        <button onClick={handleSave} disabled={saving}
          className="bg-gray-900 text-white px-8 py-3 rounded-lg font-medium hover:bg-gray-800 disabled:opacity-50">
          {saving ? "Guardando..." : "Guardar Todo"}
        </button>
      </div>
    </div>
  );
}
