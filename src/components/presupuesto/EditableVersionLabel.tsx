"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import Link from "next/link";

// Etiqueta de versión editable inline. Click → input → blur/Enter guarda.
// Sirve para renombrar "V3" a "Alternativa A" cuando un proyecto cotiza
// múltiples opciones.
//
// Tres estados:
//  - normal: link al editor de la versión, con un mini lápiz al lado al hover.
//  - editing: input con autofocus, blur o Enter guarda, Esc cancela.
//  - saving: input deshabilitado.

export default function EditableVersionLabel({
  budgetId,
  initialValue,
  href,
}: {
  budgetId: string;
  initialValue: string;
  href: string;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(initialValue);
  const [saving, setSaving] = useState(false);

  async function commit() {
    const v = value.trim();
    if (v === initialValue || !v) {
      setValue(initialValue);
      setEditing(false);
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/presupuestos/${budgetId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ version: v }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Error");
      }
      router.refresh();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Error al renombrar");
      setValue(initialValue);
    } finally {
      setSaving(false);
      setEditing(false);
    }
  }

  if (editing) {
    return (
      <input
        autoFocus
        type="text"
        value={value}
        disabled={saving}
        onChange={(e) => setValue(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
          if (e.key === "Escape") {
            setValue(initialValue);
            setEditing(false);
          }
        }}
        className="w-32 px-2 py-1 border border-gray-300 rounded bg-white focus:ring-1 focus:ring-gray-900 focus:border-gray-900 outline-none text-sm font-medium"
      />
    );
  }

  return (
    <span className="group inline-flex items-center gap-1.5">
      <Link href={href} className="font-medium text-gray-900 hover:underline">
        {value}
      </Link>
      <button
        onClick={() => setEditing(true)}
        title="Renombrar"
        className="opacity-0 group-hover:opacity-100 transition-opacity text-xs text-gray-400 hover:text-gray-700"
      >
        ✎
      </button>
    </span>
  );
}
