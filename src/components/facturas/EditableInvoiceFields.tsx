"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

export type CategoryOption = {
  id: string;
  name: string;
  parentId: string | null;
  parentName: string | null;
};

export type ProjectOption = {
  id: string;
  name: string;
};

// Toast minimal — el sistema no tiene una librería de toast global y
// agregar una aquí es overkill. Usamos un span flotante que aparece 1.8s.
function useFlash() {
  const [msg, setMsg] = useState<string | null>(null);
  const [tone, setTone] = useState<"ok" | "err">("ok");
  const flash = (m: string, t: "ok" | "err" = "ok") => {
    setMsg(m);
    setTone(t);
    setTimeout(() => setMsg(null), 1800);
  };
  return { msg, tone, flash };
}

export function EditableCategoryCell({
  invoiceId,
  currentCategoryId,
  currentCategoryName,
  options,
}: {
  invoiceId: string;
  currentCategoryId: string | null;
  currentCategoryName: string | null;
  options: CategoryOption[];
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const { msg, tone, flash } = useFlash();
  const selectRef = useRef<HTMLSelectElement>(null);

  useEffect(() => {
    if (editing) selectRef.current?.focus();
  }, [editing]);

  async function save(newCategoryId: string) {
    if (newCategoryId === (currentCategoryId ?? "")) {
      setEditing(false);
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/facturas/${invoiceId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ categoryId: newCategoryId || null }),
      });
      if (!res.ok) throw new Error(await res.text());
      const body = await res.json();
      if (body.rule?.appliedRetroactively > 0) {
        flash(`✓ guardado · regla aplicada a ${body.rule.appliedRetroactively} más`);
      } else {
        flash("✓ guardado");
      }
      router.refresh();
    } catch (e) {
      console.error(e);
      flash("✗ error al guardar", "err");
    } finally {
      setSaving(false);
      setEditing(false);
    }
  }

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        className="text-left w-full text-gray-600 hover:text-gray-900 hover:bg-gray-100 -mx-1 px-1 rounded"
        title="Click para cambiar categoría"
      >
        {currentCategoryName ?? <span className="text-gray-400 italic">sin categoría</span>}
        {msg && (
          <span
            className={`ml-2 text-[10px] ${
              tone === "ok" ? "text-green-700" : "text-red-700"
            }`}
          >
            {msg}
          </span>
        )}
      </button>
    );
  }

  return (
    <select
      ref={selectRef}
      defaultValue={currentCategoryId ?? ""}
      onChange={(e) => save(e.target.value)}
      onBlur={() => setEditing(false)}
      disabled={saving}
      className="w-full text-sm border border-gray-300 rounded px-1 py-0.5 bg-white"
    >
      <option value="">— sin categoría —</option>
      {options.map((c) => (
        <option key={c.id} value={c.id}>
          {c.parentName ? `${c.parentName} > ${c.name}` : c.name}
        </option>
      ))}
    </select>
  );
}

// Variante "celda editable" del proyecto: igual que EditableCategoryCell
// pero para proyecto. Click en la celda → dropdown con todos los proyectos
// + opción "sin asignar". Útil en vistas globales (/facturas) donde no
// estamos dentro del contexto de un proyecto y queremos cambiar la
// asignación in-place.
export function EditableProjectCell({
  invoiceId,
  currentProjectId,
  currentProjectName,
  options,
}: {
  invoiceId: string;
  currentProjectId: string | null;
  currentProjectName: string | null;
  options: ProjectOption[];
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const { msg, tone, flash } = useFlash();
  const selectRef = useRef<HTMLSelectElement>(null);

  useEffect(() => {
    if (editing) selectRef.current?.focus();
  }, [editing]);

  async function save(newProjectId: string) {
    if (newProjectId === (currentProjectId ?? "")) {
      setEditing(false);
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/facturas/${invoiceId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId: newProjectId || null }),
      });
      if (!res.ok) throw new Error(await res.text());
      flash("✓ guardado");
      router.refresh();
    } catch (e) {
      console.error(e);
      flash("✗ error al guardar", "err");
    } finally {
      setSaving(false);
      setEditing(false);
    }
  }

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        className="text-left w-full text-gray-700 hover:text-gray-900 hover:bg-gray-100 -mx-1 px-1 rounded truncate"
        title="Click para cambiar proyecto"
      >
        {currentProjectName ?? <span className="text-gray-400 italic">sin asignar</span>}
        {msg && (
          <span
            className={`ml-2 text-[10px] ${
              tone === "ok" ? "text-green-700" : "text-red-700"
            }`}
          >
            {msg}
          </span>
        )}
      </button>
    );
  }

  return (
    <select
      ref={selectRef}
      defaultValue={currentProjectId ?? ""}
      onChange={(e) => save(e.target.value)}
      onBlur={() => setEditing(false)}
      disabled={saving}
      className="w-full text-sm border border-gray-300 rounded px-1 py-0.5 bg-white"
    >
      <option value="">— sin asignar —</option>
      {options.map((p) => (
        <option key={p.id} value={p.id}>
          {p.name}
        </option>
      ))}
    </select>
  );
}

export function MoveProjectButton({
  invoiceId,
  currentProjectId,
  options,
}: {
  invoiceId: string;
  currentProjectId: string | null;
  options: ProjectOption[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const { msg, tone, flash } = useFlash();
  const selectRef = useRef<HTMLSelectElement>(null);

  useEffect(() => {
    if (open) selectRef.current?.focus();
  }, [open]);

  async function save(newProjectId: string) {
    if (newProjectId === (currentProjectId ?? "")) {
      setOpen(false);
      return;
    }
    if (!confirm("¿Mover la factura a otro proyecto? Va a desaparecer de esta lista.")) {
      setOpen(false);
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/facturas/${invoiceId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId: newProjectId || null }),
      });
      if (!res.ok) throw new Error(await res.text());
      flash("✓ movida");
      router.refresh();
    } catch (e) {
      console.error(e);
      flash("✗ error", "err");
    } finally {
      setSaving(false);
      setOpen(false);
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-[10px] text-gray-400 hover:text-gray-700 underline-offset-2 hover:underline"
        title="Mover factura a otro proyecto"
      >
        ↗ mover
        {msg && (
          <span
            className={`ml-1 ${tone === "ok" ? "text-green-700" : "text-red-700"}`}
          >
            {msg}
          </span>
        )}
      </button>
    );
  }

  return (
    <select
      ref={selectRef}
      defaultValue={currentProjectId ?? ""}
      onChange={(e) => save(e.target.value)}
      onBlur={() => setOpen(false)}
      disabled={saving}
      className="text-[11px] border border-gray-300 rounded px-1 py-0.5 bg-white"
    >
      <option value="">— sin proyecto —</option>
      {options.map((p) => (
        <option key={p.id} value={p.id}>
          {p.name}
        </option>
      ))}
    </select>
  );
}
