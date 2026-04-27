"use client";

import { useState, useEffect } from "react";
import { formatCLP } from "@/lib/utils";
import MaterialOffersDrawer from "./MaterialOffersDrawer";

interface Material {
  id: string;
  category: string;
  name: string;
  unit: string;
  netPrice: number;
  isProvision: boolean;
  referenceLink: string | null;
}

const UNITS = ["UN", "M2", "ML", "M3", "KG", "GL", "LT", "ROLLO", "SACO"];

export default function MaterialSearch({
  categories,
}: {
  categories: string[];
}) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("");
  const [materials, setMaterials] = useState<Material[]>([]);
  const [loading, setLoading] = useState(false);

  // Add material state
  const [addingCategory, setAddingCategory] = useState<string | null>(null);
  const [newMat, setNewMat] = useState({
    name: "",
    unit: "UN",
    netPrice: 0,
    referenceLink: "",
  });
  const [saving, setSaving] = useState(false);

  // Edit material state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editMat, setEditMat] = useState({
    name: "",
    unit: "UN",
    netPrice: 0,
    referenceLink: "",
  });

  // New category state
  const [showNewCategory, setShowNewCategory] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState("");

  // Offers drawer
  const [offersMaterial, setOffersMaterial] = useState<Material | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => fetchMaterials(), 300);
    return () => clearTimeout(timer);
  }, [query, category]);

  async function fetchMaterials() {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (query) params.set("q", query);
      if (category) params.set("category", category);
      params.set("limit", "500");
      const res = await fetch(`/api/catalogo/materiales?${params}`);
      setMaterials(await res.json());
    } catch {
      console.error("Error");
    } finally {
      setLoading(false);
    }
  }

  async function handleAddMaterial(cat: string) {
    if (!newMat.name.trim()) return;
    setSaving(true);
    try {
      const res = await fetch("/api/catalogo/materiales", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...newMat, category: cat }),
      });
      if (!res.ok) {
        const err = await res.json();
        alert(err.error || "Error al crear material");
        return;
      }
      const created = await res.json();
      setMaterials([...materials, created]);
      setNewMat({ name: "", unit: "UN", netPrice: 0, referenceLink: "" });
      setAddingCategory(null);
    } catch {
      alert("Error al crear material");
    } finally {
      setSaving(false);
    }
  }

  async function handleUpdateMaterial(id: string) {
    setSaving(true);
    try {
      const res = await fetch(`/api/catalogo/materiales/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(editMat),
      });
      if (!res.ok) throw new Error();
      const updated = await res.json();
      setMaterials(materials.map((m) => (m.id === id ? updated : m)));
      setEditingId(null);
    } catch {
      alert("Error al actualizar material");
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteMaterial(id: string) {
    if (!confirm("Eliminar este material del catalogo?")) return;
    try {
      await fetch(`/api/catalogo/materiales/${id}`, { method: "DELETE" });
      setMaterials(materials.filter((m) => m.id !== id));
    } catch {
      alert("Error al eliminar material");
    }
  }

  function startEdit(mat: Material) {
    setEditingId(mat.id);
    setEditMat({
      name: mat.name,
      unit: mat.unit,
      netPrice: mat.netPrice,
      referenceLink: mat.referenceLink || "",
    });
  }

  // Get all categories (existing + from materials that might not be in the server list)
  const allCategories = [
    ...new Set([
      ...categories,
      ...materials.map((m) => m.category),
    ]),
  ].sort();

  const grouped = allCategories
    .filter((cat) => !category || cat === category)
    .map((cat) => ({
      category: cat,
      items: materials.filter((m) => m.category === cat),
    }))
    .filter((g) => g.items.length > 0 || addingCategory === g.category);

  return (
    <div className="space-y-6">
      <div className="flex gap-4">
        <div className="flex-1">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar material... (ej: yeso, pintura, tornillo)"
            className="w-full px-4 py-3 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-gray-900 focus:border-transparent outline-none"
          />
        </div>
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          className="px-4 py-3 border border-gray-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-gray-900 focus:border-transparent outline-none"
        >
          <option value="">Todas las categorias</option>
          {allCategories.map((cat) => (
            <option key={cat} value={cat}>
              {cat}
            </option>
          ))}
        </select>
        <button
          onClick={() => setShowNewCategory(true)}
          className="px-4 py-3 bg-gray-900 text-white rounded-lg text-sm font-medium hover:bg-gray-800 transition-colors whitespace-nowrap"
        >
          + Categoria
        </button>
      </div>

      {/* New category form */}
      {showNewCategory && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-4">
          <h4 className="text-sm font-medium text-gray-900 mb-3">
            Nueva categoria
          </h4>
          <div className="flex gap-3 items-end">
            <div className="flex-1">
              <input
                type="text"
                value={newCategoryName}
                onChange={(e) =>
                  setNewCategoryName(e.target.value.toUpperCase())
                }
                placeholder="Nombre de la categoria (ej: PINTURAS)"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-gray-900 focus:border-transparent outline-none"
                autoFocus
              />
            </div>
            <button
              onClick={() => {
                if (!newCategoryName.trim()) return;
                setAddingCategory(newCategoryName.trim());
                setShowNewCategory(false);
                setNewCategoryName("");
              }}
              className="bg-gray-900 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-gray-800"
            >
              Crear
            </button>
            <button
              onClick={() => {
                setShowNewCategory(false);
                setNewCategoryName("");
              }}
              className="text-gray-500 px-3 py-2 rounded-lg text-sm hover:bg-gray-200"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}

      {grouped.map((group) => (
        <div
          key={group.category}
          className="bg-white rounded-xl border border-gray-200 overflow-hidden"
        >
          <div className="flex items-center justify-between p-4 bg-gray-50 border-b border-gray-200">
            <h3 className="font-semibold text-gray-900">
              {group.category}{" "}
              <span className="text-gray-400 font-normal">
                ({group.items.length})
              </span>
            </h3>
            <button
              onClick={() => {
                setAddingCategory(
                  addingCategory === group.category ? null : group.category
                );
                setNewMat({
                  name: "",
                  unit: "UN",
                  netPrice: 0,
                  referenceLink: "",
                });
              }}
              className="text-sm text-gray-600 hover:text-gray-900 font-medium"
            >
              + Agregar
            </button>
          </div>

          {group.items.length > 0 && (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100">
                  <th className="text-left px-4 py-2 text-xs text-gray-500">
                    Material
                  </th>
                  <th className="text-left px-4 py-2 text-xs text-gray-500 w-20">
                    Unidad
                  </th>
                  <th className="text-right px-4 py-2 text-xs text-gray-500 w-32">
                    Precio Neto
                  </th>
                  <th className="text-right px-4 py-2 text-xs text-gray-500 w-32">
                    c/IVA
                  </th>
                  <th className="text-left px-4 py-2 text-xs text-gray-500 w-24">
                    Link
                  </th>
                  <th className="w-20"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {group.items.map((mat) =>
                  editingId === mat.id ? (
                    <tr key={mat.id} className="bg-blue-50">
                      <td className="px-4 py-2">
                        <input
                          type="text"
                          value={editMat.name}
                          onChange={(e) =>
                            setEditMat({ ...editMat, name: e.target.value })
                          }
                          className="w-full px-2 py-1 border border-gray-300 rounded text-sm focus:ring-2 focus:ring-gray-900 focus:border-transparent outline-none"
                        />
                      </td>
                      <td className="px-4 py-2">
                        <select
                          value={editMat.unit}
                          onChange={(e) =>
                            setEditMat({ ...editMat, unit: e.target.value })
                          }
                          className="px-2 py-1 border border-gray-300 rounded text-sm bg-white focus:ring-2 focus:ring-gray-900 focus:border-transparent outline-none"
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
                          step="1"
                          value={editMat.netPrice || ""}
                          onChange={(e) =>
                            setEditMat({
                              ...editMat,
                              netPrice: parseFloat(e.target.value) || 0,
                            })
                          }
                          className="w-full px-2 py-1 border border-gray-300 rounded text-sm text-right focus:ring-2 focus:ring-gray-900 focus:border-transparent outline-none"
                        />
                      </td>
                      <td className="px-4 py-2 text-right text-gray-400 text-sm">
                        {editMat.netPrice ? formatCLP(Math.round(editMat.netPrice * 1.19)) : "—"}
                      </td>
                      <td className="px-4 py-2">
                        <input
                          type="url"
                          value={editMat.referenceLink}
                          onChange={(e) =>
                            setEditMat({
                              ...editMat,
                              referenceLink: e.target.value,
                            })
                          }
                          placeholder="https://..."
                          className="w-full px-2 py-1 border border-gray-300 rounded text-sm focus:ring-2 focus:ring-gray-900 focus:border-transparent outline-none"
                        />
                      </td>
                      <td className="px-4 py-2">
                        <div className="flex gap-1">
                          <button
                            onClick={() => handleUpdateMaterial(mat.id)}
                            disabled={saving}
                            className="text-green-600 hover:text-green-800 text-xs font-medium"
                          >
                            Guardar
                          </button>
                          <button
                            onClick={() => setEditingId(null)}
                            className="text-gray-400 hover:text-gray-600 text-xs"
                          >
                            Cancelar
                          </button>
                        </div>
                      </td>
                    </tr>
                  ) : (
                    <tr key={mat.id} className="hover:bg-gray-50 group">
                      <td className="px-4 py-2 text-gray-900">
                        <span>{mat.name}</span>
                        {mat.isProvision && (
                          <span className="ml-2 text-[10px] bg-purple-100 text-purple-700 px-1.5 py-0.5 rounded font-medium">
                            provisión
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-2 text-gray-500">{mat.unit}</td>
                      <td className="px-4 py-2 text-right font-medium">
                        {mat.netPrice > 0 ? formatCLP(mat.netPrice) : <span className="text-gray-300">—</span>}
                      </td>
                      <td className="px-4 py-2 text-right text-gray-400">
                        {mat.netPrice > 0 ? formatCLP(Math.round(mat.netPrice * 1.19)) : <span className="text-gray-200">—</span>}
                      </td>
                      <td className="px-4 py-2">
                        {mat.referenceLink && (
                          <a
                            href={mat.referenceLink}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-blue-500 hover:text-blue-700 text-xs"
                          >
                            Ver ↗
                          </a>
                        )}
                      </td>
                      <td className="px-4 py-2">
                        <div className="flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                          {!mat.isProvision && (
                            <button
                              onClick={() => setOffersMaterial(mat)}
                              className="text-blue-600 hover:text-blue-800 text-xs"
                              title="Actualizar precio"
                            >
                              🔍 Precios
                            </button>
                          )}
                          <button
                            onClick={() => startEdit(mat)}
                            className="text-gray-400 hover:text-gray-600 text-xs"
                          >
                            Editar
                          </button>
                          <button
                            onClick={() => handleDeleteMaterial(mat.id)}
                            className="text-gray-400 hover:text-red-500 text-xs"
                          >
                            x
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                )}
              </tbody>
            </table>
          )}

          {/* Add material form */}
          {addingCategory === group.category && (
            <div className="p-4 border-t border-gray-100 bg-blue-50">
              <div className="grid grid-cols-12 gap-2 items-end">
                <div className="col-span-4">
                  <label className="block text-xs text-gray-600 mb-1">
                    Nombre
                  </label>
                  <input
                    type="text"
                    value={newMat.name}
                    onChange={(e) =>
                      setNewMat({ ...newMat, name: e.target.value })
                    }
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-gray-900 focus:border-transparent outline-none"
                    placeholder="Nombre del material"
                    autoFocus
                  />
                </div>
                <div className="col-span-1">
                  <label className="block text-xs text-gray-600 mb-1">
                    Unidad
                  </label>
                  <select
                    value={newMat.unit}
                    onChange={(e) =>
                      setNewMat({ ...newMat, unit: e.target.value })
                    }
                    className="w-full px-2 py-2 border border-gray-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-gray-900 focus:border-transparent outline-none"
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
                    Precio Neto
                  </label>
                  <input
                    type="number"
                    step="1"
                    value={newMat.netPrice || ""}
                    onChange={(e) =>
                      setNewMat({
                        ...newMat,
                        netPrice: parseFloat(e.target.value) || 0,
                      })
                    }
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-gray-900 focus:border-transparent outline-none"
                    placeholder="$0"
                  />
                </div>
                <div className="col-span-3">
                  <label className="block text-xs text-gray-600 mb-1">
                    Link referencia
                  </label>
                  <input
                    type="url"
                    value={newMat.referenceLink}
                    onChange={(e) =>
                      setNewMat({ ...newMat, referenceLink: e.target.value })
                    }
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-gray-900 focus:border-transparent outline-none"
                    placeholder="https://sodimac.cl/..."
                  />
                </div>
                <div className="col-span-2 flex gap-2">
                  <button
                    onClick={() => handleAddMaterial(group.category)}
                    disabled={saving || !newMat.name.trim()}
                    className="bg-gray-900 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-gray-800 disabled:opacity-50"
                  >
                    {saving ? "..." : "Agregar"}
                  </button>
                  <button
                    onClick={() => setAddingCategory(null)}
                    className="text-gray-500 px-3 py-2 rounded-lg text-sm hover:bg-gray-200"
                  >
                    Cancelar
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      ))}

      {!loading && materials.length === 0 && !addingCategory && (
        <div className="bg-white rounded-xl border border-gray-200 p-8 text-center text-gray-500">
          No se encontraron materiales
        </div>
      )}

      {offersMaterial && (
        <MaterialOffersDrawer
          material={offersMaterial}
          onClose={() => setOffersMaterial(null)}
          onChanged={() => fetchMaterials()}
        />
      )}
    </div>
  );
}
