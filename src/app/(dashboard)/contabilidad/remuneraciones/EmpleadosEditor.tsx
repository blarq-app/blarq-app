"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { formatCLP } from "@/lib/utils";

// Formatea un decimal con hasta `dec` cifras (es-CL: coma decimal). Para la
// comisión de AFP (1,16%) y el plan de Isapre en UF (3,864), que se perderían
// si se redondearan a entero.
function fmtDec(n: number, dec = 2): string {
  return new Intl.NumberFormat("es-CL", {
    minimumFractionDigits: 0,
    maximumFractionDigits: dec,
  }).format(n);
}

type Empleado = {
  id: string;
  nombre: string;
  rut: string;
  sueldoBase: number;
  colacion: number;
  movilizacion: number;
  afpNombre: string | null;
  afpComisionRate: number;
  isapreNombre: string | null;
  isaprePlanUF: number;
  activo: boolean;
};

// Form vacío para crear.
const EMPTY: Omit<Empleado, "id" | "activo"> = {
  nombre: "",
  rut: "",
  sueldoBase: 0,
  colacion: 0,
  movilizacion: 0,
  afpNombre: "",
  afpComisionRate: 0,
  isapreNombre: "",
  isaprePlanUF: 0,
};

export default function EmpleadosEditor({
  empleados,
}: {
  empleados: Empleado[];
}) {
  const router = useRouter();
  const [editId, setEditId] = useState<string | null>(null);
  const [creando, setCreando] = useState(false);

  return (
    <div>
      <div className="flex items-baseline justify-between mb-3">
        <h2 className="text-sm font-semibold text-gray-900">Empleados</h2>
        {!creando && (
          <button
            onClick={() => {
              setCreando(true);
              setEditId(null);
            }}
            className="text-sm text-gray-500 hover:text-gray-900"
          >
            + Agregar empleado
          </button>
        )}
      </div>

      <div className="space-y-3">
        {creando && (
          <EmpleadoForm
            inicial={EMPTY}
            onCancel={() => setCreando(false)}
            onSaved={() => {
              setCreando(false);
              router.refresh();
            }}
          />
        )}

        {empleados.map((emp) =>
          editId === emp.id ? (
            <EmpleadoForm
              key={emp.id}
              id={emp.id}
              inicial={emp}
              onCancel={() => setEditId(null)}
              onSaved={() => {
                setEditId(null);
                router.refresh();
              }}
            />
          ) : (
            <EmpleadoCard
              key={emp.id}
              emp={emp}
              onEdit={() => {
                setEditId(emp.id);
                setCreando(false);
              }}
              onDeleted={() => router.refresh()}
            />
          )
        )}

        {empleados.length === 0 && !creando && (
          <p className="text-sm text-gray-400">No hay empleados cargados.</p>
        )}
      </div>
    </div>
  );
}

function EmpleadoCard({
  emp,
  onEdit,
  onDeleted,
}: {
  emp: Empleado;
  onEdit: () => void;
  onDeleted: () => void;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function borrar() {
    if (!confirm(`¿Borrar a ${emp.nombre}?`)) return;
    setBusy(true);
    await fetch(`/api/contabilidad/empleados/${emp.id}`, { method: "DELETE" });
    setBusy(false);
    onDeleted();
    router.refresh();
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 px-5 py-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-baseline gap-2">
            <span className="font-medium text-gray-900">{emp.nombre}</span>
            <span className="text-xs text-gray-400 tabular-nums">{emp.rut}</span>
            {!emp.activo && (
              <span className="text-[10px] uppercase tracking-wide text-gray-400 border border-gray-200 rounded-full px-1.5">
                inactivo
              </span>
            )}
          </div>
          <div className="text-xs text-gray-500 mt-1 flex flex-wrap gap-x-4 gap-y-0.5 tabular-nums">
            <span>Sueldo base {formatCLP(emp.sueldoBase)}</span>
            <span>Colación {formatCLP(emp.colacion)}</span>
            <span>Movilización {formatCLP(emp.movilizacion)}</span>
            <span>
              {emp.afpNombre ?? "AFP"} {fmtDec(emp.afpComisionRate * 100, 2)}%
            </span>
            <span>
              {emp.isapreNombre ?? "Isapre"} {fmtDec(emp.isaprePlanUF, 3)} UF
            </span>
          </div>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <button
            onClick={onEdit}
            className="text-sm text-gray-500 hover:text-gray-900"
          >
            Editar
          </button>
          <button
            onClick={borrar}
            disabled={busy}
            className="text-sm text-gray-400 hover:text-red-600 disabled:opacity-50"
          >
            Borrar
          </button>
        </div>
      </div>
    </div>
  );
}

function EmpleadoForm({
  id,
  inicial,
  onCancel,
  onSaved,
}: {
  id?: string;
  inicial: Omit<Empleado, "id" | "activo">;
  onCancel: () => void;
  onSaved: () => void;
}) {
  // La comisión AFP se edita como porcentaje (1,16) pero se guarda decimal.
  const [f, setF] = useState({
    nombre: inicial.nombre,
    rut: inicial.rut,
    sueldoBase: inicial.sueldoBase,
    colacion: inicial.colacion,
    movilizacion: inicial.movilizacion,
    afpNombre: inicial.afpNombre ?? "",
    afpComisionPct: inicial.afpComisionRate * 100,
    isapreNombre: inicial.isapreNombre ?? "",
    isaprePlanUF: inicial.isaprePlanUF,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function set<K extends keyof typeof f>(k: K, v: (typeof f)[K]) {
    setF((prev) => ({ ...prev, [k]: v }));
  }

  async function guardar() {
    if (!f.nombre.trim() || !f.rut.trim()) {
      setError("Nombre y RUT son obligatorios");
      return;
    }
    setBusy(true);
    setError(null);
    const payload = {
      nombre: f.nombre,
      rut: f.rut,
      sueldoBase: f.sueldoBase,
      colacion: f.colacion,
      movilizacion: f.movilizacion,
      afpNombre: f.afpNombre,
      afpComisionRate: f.afpComisionPct / 100,
      isapreNombre: f.isapreNombre,
      isaprePlanUF: f.isaprePlanUF,
    };
    try {
      const res = await fetch(
        id ? `/api/contabilidad/empleados/${id}` : "/api/contabilidad/empleados",
        {
          method: id ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        }
      );
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error ?? "No se pudo guardar");
      }
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="bg-white rounded-xl border border-gray-300 px-5 py-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Campo etiqueta="Nombre">
          <input
            value={f.nombre}
            onChange={(e) => set("nombre", e.target.value)}
            className="campo"
          />
        </Campo>
        <Campo etiqueta="RUT">
          <input
            value={f.rut}
            onChange={(e) => set("rut", e.target.value)}
            placeholder="18.022.887-K"
            className="campo"
          />
        </Campo>
        <Campo etiqueta="Sueldo base">
          <input
            type="number"
            value={f.sueldoBase}
            onChange={(e) => set("sueldoBase", Number(e.target.value))}
            className="campo tabular-nums"
          />
        </Campo>
        <div className="grid grid-cols-2 gap-3">
          <Campo etiqueta="Colación">
            <input
              type="number"
              value={f.colacion}
              onChange={(e) => set("colacion", Number(e.target.value))}
              className="campo tabular-nums"
            />
          </Campo>
          <Campo etiqueta="Movilización">
            <input
              type="number"
              value={f.movilizacion}
              onChange={(e) => set("movilizacion", Number(e.target.value))}
              className="campo tabular-nums"
            />
          </Campo>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Campo etiqueta="AFP">
            <input
              value={f.afpNombre}
              onChange={(e) => set("afpNombre", e.target.value)}
              placeholder="Planvital"
              className="campo"
            />
          </Campo>
          <Campo etiqueta="Comisión AFP (%)">
            <input
              type="number"
              step="0.01"
              value={f.afpComisionPct}
              onChange={(e) => set("afpComisionPct", Number(e.target.value))}
              className="campo tabular-nums"
            />
          </Campo>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Campo etiqueta="Isapre">
            <input
              value={f.isapreNombre}
              onChange={(e) => set("isapreNombre", e.target.value)}
              placeholder="Colmena"
              className="campo"
            />
          </Campo>
          <Campo etiqueta="Plan salud (UF)">
            <input
              type="number"
              step="0.001"
              value={f.isaprePlanUF}
              onChange={(e) => set("isaprePlanUF", Number(e.target.value))}
              className="campo tabular-nums"
            />
          </Campo>
        </div>
      </div>

      <div className="flex items-center justify-end gap-3 mt-4">
        {error && <span className="text-xs text-red-600 mr-auto">{error}</span>}
        <button
          onClick={onCancel}
          className="text-sm text-gray-500 hover:text-gray-900"
        >
          Cancelar
        </button>
        <button
          onClick={guardar}
          disabled={busy}
          className="px-3 py-1.5 rounded bg-gray-900 text-white text-sm font-medium hover:bg-gray-800 disabled:opacity-50"
        >
          {busy ? "Guardando…" : "Guardar"}
        </button>
      </div>

      {/* Estilos de los inputs del form (consistencia editorial BLARQ). */}
      <style jsx>{`
        :global(.campo) {
          width: 100%;
          border: 1px solid #d1d5db;
          border-radius: 0.375rem;
          padding: 0.375rem 0.5rem;
          font-size: 0.875rem;
        }
        :global(.campo:focus) {
          outline: none;
          border-color: #111827;
        }
      `}</style>
    </div>
  );
}

function Campo({
  etiqueta,
  children,
}: {
  etiqueta: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="text-[11px] uppercase tracking-wider text-gray-400">
        {etiqueta}
      </span>
      <div className="mt-1">{children}</div>
    </label>
  );
}
