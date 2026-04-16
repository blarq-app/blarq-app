"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { formatCLP } from "@/lib/utils";

interface Category {
  id: string;
  name: string;
}

export default function NuevaFacturaButton({
  projectId,
  type,
  categories,
}: {
  projectId: string;
  type: "emitida" | "recibida";
  categories: Category[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({
    businessName: "",
    folioNumber: "",
    rutIssuer: "",
    categoryId: "",
    netAmount: 0,
    issueDate: new Date().toISOString().split("T")[0],
    status: "pendiente",
    notes: "",
  });

  const iva = form.netAmount * 0.19;
  const total = form.netAmount + iva;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await fetch("/api/facturas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          projectId,
          type,
          netAmount: form.netAmount,
        }),
      });
      if (!res.ok) throw new Error("Error");
      setOpen(false);
      setForm({
        businessName: "",
        folioNumber: "",
        rutIssuer: "",
        categoryId: "",
        netAmount: 0,
        issueDate: new Date().toISOString().split("T")[0],
        status: "pendiente",
        notes: "",
      });
      router.refresh();
    } catch {
      alert("Error al crear factura");
    } finally {
      setLoading(false);
    }
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="bg-gray-900 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-gray-800 transition-colors"
      >
        + Nueva Factura
      </button>
    );
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">
          Nueva Factura {type === "emitida" ? "Emitida" : "de Costo"}
        </h2>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                {type === "emitida" ? "Cliente" : "Proveedor"}
              </label>
              <input
                type="text"
                value={form.businessName}
                onChange={(e) =>
                  setForm({ ...form, businessName: e.target.value })
                }
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm outline-none focus:ring-2 focus:ring-gray-900 focus:border-transparent"
                placeholder="Razon social"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                N° Folio
              </label>
              <input
                type="text"
                value={form.folioNumber}
                onChange={(e) =>
                  setForm({ ...form, folioNumber: e.target.value })
                }
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm outline-none focus:ring-2 focus:ring-gray-900 focus:border-transparent"
              />
            </div>
          </div>

          {type === "recibida" && (
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  RUT Emisor
                </label>
                <input
                  type="text"
                  value={form.rutIssuer}
                  onChange={(e) =>
                    setForm({ ...form, rutIssuer: e.target.value })
                  }
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm outline-none focus:ring-2 focus:ring-gray-900 focus:border-transparent"
                  placeholder="12.345.678-9"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Categoria
                </label>
                <select
                  value={form.categoryId}
                  onChange={(e) =>
                    setForm({ ...form, categoryId: e.target.value })
                  }
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white outline-none focus:ring-2 focus:ring-gray-900 focus:border-transparent"
                >
                  <option value="">Sin categoria</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Monto Neto
              </label>
              <input
                type="number"
                step="1"
                value={form.netAmount || ""}
                onChange={(e) =>
                  setForm({
                    ...form,
                    netAmount: parseFloat(e.target.value) || 0,
                  })
                }
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm outline-none focus:ring-2 focus:ring-gray-900 focus:border-transparent"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Fecha Emision
              </label>
              <input
                type="date"
                value={form.issueDate}
                onChange={(e) =>
                  setForm({ ...form, issueDate: e.target.value })
                }
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm outline-none focus:ring-2 focus:ring-gray-900 focus:border-transparent"
                required
              />
            </div>
          </div>

          {/* Preview IVA y Total */}
          <div className="bg-gray-50 rounded-lg p-3 space-y-1">
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">IVA (19%)</span>
              <span>{formatCLP(iva)}</span>
            </div>
            <div className="flex justify-between text-sm font-bold">
              <span>Total</span>
              <span>{formatCLP(total)}</span>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Estado
            </label>
            <select
              value={form.status}
              onChange={(e) => setForm({ ...form, status: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white outline-none focus:ring-2 focus:ring-gray-900 focus:border-transparent"
            >
              <option value="pendiente">Pendiente</option>
              <option value="pagada">Pagada</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Notas
            </label>
            <input
              type="text"
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm outline-none focus:ring-2 focus:ring-gray-900 focus:border-transparent"
              placeholder="Descripcion o detalle"
            />
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="text-gray-600 px-4 py-2 rounded-lg text-sm hover:bg-gray-100"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={loading}
              className="bg-gray-900 text-white px-6 py-2 rounded-lg text-sm font-medium hover:bg-gray-800 disabled:opacity-50"
            >
              {loading ? "Guardando..." : "Crear Factura"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
