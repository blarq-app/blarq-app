"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type MaestroLite = { id: string; name: string };

// Agrega un maestro a la obra: elegir uno que ya existe o crear uno nuevo.
export default function AddMaestroButton({
  projectId,
  available,
}: {
  projectId: string;
  available: MaestroLite[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [newName, setNewName] = useState("");

  async function add(body: Record<string, unknown>) {
    if (saving) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/proyectos/${projectId}/maestros`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        alert(e.error || "Error al agregar el maestro");
        return;
      }
      setOpen(false);
      setNewName("");
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="bg-gray-900 text-white px-3 py-2 rounded-lg text-sm font-medium hover:bg-gray-800"
      >
        + Agregar maestro
      </button>
    );
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4 w-full max-w-md">
      <div className="flex items-center justify-between mb-3">
        <span className="text-sm font-medium text-gray-900">
          Agregar un maestro a la obra
        </span>
        <button
          onClick={() => setOpen(false)}
          className="text-gray-400 hover:text-gray-700 text-sm"
        >
          Cancelar
        </button>
      </div>

      {available.length > 0 && (
        <div className="mb-4">
          <p className="text-xs text-gray-500 mb-1.5">Elegir uno existente</p>
          <div className="flex flex-wrap gap-1.5">
            {available.map((m) => (
              <button
                key={m.id}
                onClick={() => add({ maestroId: m.id })}
                disabled={saving}
                className="text-sm border border-gray-300 text-gray-700 px-2.5 py-1 rounded-full hover:bg-gray-50 disabled:opacity-40"
              >
                {m.name}
              </button>
            ))}
          </div>
        </div>
      )}

      <div>
        <p className="text-xs text-gray-500 mb-1.5">O crear uno nuevo</p>
        <div className="flex gap-2">
          <input
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Nombre del maestro"
            className="flex-1 border border-gray-300 rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-gray-400"
            onKeyDown={(e) => {
              if (e.key === "Enter" && newName.trim()) add({ name: newName.trim() });
            }}
          />
          <button
            onClick={() => newName.trim() && add({ name: newName.trim() })}
            disabled={saving || !newName.trim()}
            className="bg-gray-900 text-white text-sm font-medium px-3 py-1.5 rounded-lg hover:bg-gray-800 disabled:opacity-40"
          >
            Crear
          </button>
        </div>
      </div>
    </div>
  );
}
