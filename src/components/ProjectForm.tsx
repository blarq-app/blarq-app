"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { formatRutForDisplay, parseRut } from "@/lib/clients/rut";

interface ProjectData {
  id?: string;
  name: string;
  clientName: string;
  clientRut: string | null;
  clientPhone: string | null;
  clientEmail: string | null;
  address: string | null;
  status: string;
  startDate: Date | null;
  estimatedEndDate: Date | null;
  ufReference: number | null;
  notes: string | null;
  maestroId?: string | null;
}

interface Maestro {
  id: string;
  name: string;
}

function dateToInput(date: Date | null): string {
  if (!date) return "";
  return new Date(date).toISOString().split("T")[0];
}

export default function ProjectForm({ project }: { project?: ProjectData }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [maestros, setMaestros] = useState<Maestro[]>([]);
  const [showNewMaestro, setShowNewMaestro] = useState(false);
  const [newMaestroName, setNewMaestroName] = useState("");
  const [selectedMaestro, setSelectedMaestro] = useState<string>(
    project?.maestroId || ""
  );

  // RUT del cliente: estado local + error de validación. La validación
  // corre en blur, no en cada tecla — molesta menos mientras MJ tipea.
  const [clientRut, setClientRut] = useState<string>(
    formatRutForDisplay(project?.clientRut)
  );
  const [rutError, setRutError] = useState<string>("");

  function validateRutOnBlur() {
    if (!clientRut.trim()) {
      setRutError("");
      return;
    }
    const r = parseRut(clientRut);
    if (!r.ok) {
      setRutError(r.reason);
    } else {
      setRutError("");
      // Re-formato en pantalla a la forma canónica con puntos
      setClientRut(formatRutForDisplay(r.canonical));
    }
  }

  const isEditing = !!project?.id;

  useEffect(() => {
    fetch("/api/maestros")
      .then((r) => r.json())
      .then(setMaestros)
      .catch(() => setMaestros([]));
  }, []);

  async function createMaestro() {
    if (!newMaestroName.trim()) return;
    const res = await fetch("/api/maestros", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newMaestroName.trim() }),
    });
    if (res.ok) {
      const m = await res.json();
      setMaestros((prev) => [...prev, m].sort((a, b) => a.name.localeCompare(b.name)));
      setSelectedMaestro(m.id);
      setNewMaestroName("");
      setShowNewMaestro(false);
    }
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError("");

    // Si tipearon RUT pero está mal formado, no permitimos guardar.
    // Si el campo está vacío, se guarda null (permitido por schema).
    let clientRutToSave: string | null = null;
    if (clientRut.trim()) {
      const r = parseRut(clientRut);
      if (!r.ok) {
        setRutError(r.reason);
        setError("Hay un error en el RUT del cliente. Corregilo antes de guardar.");
        setLoading(false);
        return;
      }
      clientRutToSave = r.canonical;
    }

    const formData = new FormData(e.currentTarget);
    const data = {
      name: formData.get("name") as string,
      clientName: formData.get("clientName") as string,
      clientRut: clientRutToSave,
      clientPhone: (formData.get("clientPhone") as string) || null,
      clientEmail: (formData.get("clientEmail") as string) || null,
      address: (formData.get("address") as string) || null,
      status: formData.get("status") as string,
      startDate: (formData.get("startDate") as string) || null,
      estimatedEndDate: (formData.get("estimatedEndDate") as string) || null,
      ufReference: formData.get("ufReference")
        ? parseFloat(formData.get("ufReference") as string)
        : null,
      notes: (formData.get("notes") as string) || null,
      maestroId: selectedMaestro || null,
    };

    try {
      const url = isEditing
        ? `/api/proyectos/${project.id}`
        : "/api/proyectos";
      const method = isEditing ? "PUT" : "POST";

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });

      if (!res.ok) {
        const body = await res.json();
        throw new Error(body.error || "Error al guardar");
      }

      const saved = await res.json();
      router.push(`/proyectos/${saved.id}`);
      router.refresh();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Error al guardar");
      setLoading(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="bg-white rounded-xl border border-gray-200 p-6 max-w-2xl space-y-6"
    >
      {error && (
        <div className="bg-red-50 text-red-600 text-sm px-4 py-3 rounded-lg">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="md:col-span-2">
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Nombre del Proyecto *
          </label>
          <input
            name="name"
            required
            defaultValue={project?.name || ""}
            className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-gray-900 focus:border-transparent outline-none transition-all"
            placeholder="Ej: Remodelacion Depto Las Condes"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Nombre del Cliente *
          </label>
          <input
            name="clientName"
            required
            defaultValue={project?.clientName || ""}
            className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-gray-900 focus:border-transparent outline-none transition-all"
            placeholder="Ej: Cristian Lefevre"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            RUT del Cliente
          </label>
          <input
            name="clientRut"
            value={clientRut}
            onChange={(e) => {
              setClientRut(e.target.value);
              if (rutError) setRutError("");
            }}
            onBlur={validateRutOnBlur}
            className={`w-full px-4 py-2.5 border rounded-lg focus:ring-2 focus:border-transparent outline-none transition-all tabular-nums ${
              rutError
                ? "border-red-400 focus:ring-red-400"
                : "border-gray-300 focus:ring-gray-900"
            }`}
            placeholder="Ej: 12.345.678-9"
            autoComplete="off"
          />
          {rutError ? (
            <p className="mt-1 text-xs text-red-600">{rutError}</p>
          ) : (
            <p className="mt-1 text-xs text-gray-500">
              Necesario para emitir factura. Puede completarse después.
            </p>
          )}
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Telefono
          </label>
          <input
            name="clientPhone"
            defaultValue={project?.clientPhone || ""}
            className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-gray-900 focus:border-transparent outline-none transition-all"
            placeholder="+56 9 1234 5678"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Email del Cliente
          </label>
          <input
            name="clientEmail"
            type="email"
            defaultValue={project?.clientEmail || ""}
            className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-gray-900 focus:border-transparent outline-none transition-all"
            placeholder="cliente@email.com"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Direccion
          </label>
          <input
            name="address"
            defaultValue={project?.address || ""}
            className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-gray-900 focus:border-transparent outline-none transition-all"
            placeholder="Ej: Av. Las Condes 1234, Depto 501"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Estado
          </label>
          <select
            name="status"
            defaultValue={project?.status || "cotizacion"}
            className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-gray-900 focus:border-transparent outline-none transition-all bg-white"
          >
            <option value="cotizacion">Cotización</option>
            <option value="ejecucion">En Ejecución</option>
            <option value="terminado">Terminado</option>
            <option value="archivado">Archivada</option>
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Fecha Inicio
          </label>
          <input
            name="startDate"
            type="date"
            defaultValue={dateToInput(project?.startDate ?? null)}
            className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-gray-900 focus:border-transparent outline-none transition-all"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Fecha Fin Estimada
          </label>
          <input
            name="estimatedEndDate"
            type="date"
            defaultValue={dateToInput(project?.estimatedEndDate ?? null)}
            className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-gray-900 focus:border-transparent outline-none transition-all"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Valor UF Referencia
          </label>
          <input
            name="ufReference"
            type="number"
            step="0.01"
            defaultValue={project?.ufReference || ""}
            className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-gray-900 focus:border-transparent outline-none transition-all"
            placeholder="Ej: 38500"
          />
        </div>

        <div className="md:col-span-2">
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Maestro a cargo
          </label>
          {!showNewMaestro ? (
            <div className="flex gap-2">
              <select
                value={selectedMaestro}
                onChange={(e) => setSelectedMaestro(e.target.value)}
                className="flex-1 px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-gray-900 focus:border-transparent outline-none bg-white"
              >
                <option value="">— Sin asignar —</option>
                {maestros.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => setShowNewMaestro(true)}
                className="px-3 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50"
              >
                + Nuevo
              </button>
            </div>
          ) : (
            <div className="flex gap-2">
              <input
                value={newMaestroName}
                onChange={(e) => setNewMaestroName(e.target.value)}
                placeholder="Nombre del maestro"
                className="flex-1 px-4 py-2.5 border border-gray-300 rounded-lg"
              />
              <button
                type="button"
                onClick={createMaestro}
                className="px-3 py-2 text-sm bg-gray-900 text-white rounded-lg hover:bg-gray-800"
              >
                Crear
              </button>
              <button
                type="button"
                onClick={() => setShowNewMaestro(false)}
                className="px-3 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50"
              >
                Cancelar
              </button>
            </div>
          )}
        </div>

        <div className="md:col-span-2">
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Notas
          </label>
          <textarea
            name="notes"
            rows={3}
            defaultValue={project?.notes || ""}
            className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-gray-900 focus:border-transparent outline-none transition-all resize-none"
            placeholder="Notas adicionales sobre el proyecto..."
          />
        </div>
      </div>

      <div className="flex items-center gap-3 pt-2">
        <button
          type="submit"
          disabled={loading}
          className="bg-gray-900 text-white px-6 py-2.5 rounded-lg text-sm font-medium hover:bg-gray-800 transition-colors disabled:opacity-50"
        >
          {loading
            ? "Guardando..."
            : isEditing
            ? "Guardar Cambios"
            : "Crear Proyecto"}
        </button>
        <button
          type="button"
          onClick={() => router.back()}
          className="text-gray-600 px-6 py-2.5 rounded-lg text-sm font-medium hover:bg-gray-100 transition-colors"
        >
          Cancelar
        </button>
      </div>
    </form>
  );
}
