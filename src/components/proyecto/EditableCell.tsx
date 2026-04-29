"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useRef, useEffect } from "react";

// Celda con edición inline. Muestra texto + ícono de lápiz al hover.
// Click en lápiz → input editable. Enter o blur guarda. Escape cancela.
// Doble-click sobre el texto también edita.
// Si se pasa `href`, el texto en modo display es un Link clickeable
// (navegación normal); el lápiz queda al lado para entrar a edit.

export default function EditableCell({
  value,
  displayValue,
  projectId,
  field,
  placeholder,
  href,
  className = "",
  textClassName = "",
  emptyClassName = "text-gray-300",
}: {
  // Valor real (lo que se guarda y lo que aparece en el input)
  value: string | null | undefined;
  // Valor que se MUESTRA en modo display, si difiere del real (ej:
  // mostrar "—" cuando clientName === name pero editar el valor real).
  // Si no se pasa, usa `value`.
  displayValue?: string | null | undefined;
  projectId: string;
  field: "name" | "clientName" | "clientPhone" | "clientEmail" | "address" | "notes";
  placeholder?: string;
  href?: string;
  className?: string;
  textClassName?: string;
  emptyClassName?: string;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) inputRef.current?.select();
  }, [editing]);

  // Sync draft cuando cambia el valor externo (ej: refresh del router)
  useEffect(() => {
    if (!editing) setDraft(value ?? "");
  }, [value, editing]);

  async function save() {
    if (saving) return;
    const trimmed = draft.trim();
    if (trimmed === (value ?? "").trim()) {
      // Nada cambió
      setEditing(false);
      return;
    }
    if (!trimmed) {
      // Para name/clientName que son required en el modelo, no permitimos vaciar
      if (field === "name" || field === "clientName") {
        setError("No puede quedar vacío");
        return;
      }
    }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/proyectos/${projectId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [field]: trimmed }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || "Error al guardar");
        setSaving(false);
        return;
      }
      setEditing(false);
      setSaving(false);
      router.refresh();
    } catch {
      setError("Error de red");
      setSaving(false);
    }
  }

  function cancel() {
    setDraft(value ?? "");
    setEditing(false);
    setError(null);
  }

  if (editing) {
    return (
      <span className={`inline-flex items-center gap-1.5 ${className}`}>
        <input
          ref={inputRef}
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              save();
            } else if (e.key === "Escape") {
              e.preventDefault();
              cancel();
            }
          }}
          onBlur={save}
          disabled={saving}
          className="px-1.5 py-0.5 border border-gray-400 rounded text-sm bg-white focus:outline-none focus:border-gray-900 min-w-[8rem]"
          placeholder={placeholder}
          // Evita que el click en el input dispare nav del Link contenedor
          onClick={(e) => e.stopPropagation()}
        />
        {error && <span className="text-[10px] text-red-700">{error}</span>}
      </span>
    );
  }

  const shown = displayValue !== undefined ? displayValue : value;
  const display = shown && shown.trim() ? shown : placeholder ?? "—";
  const isEmpty = !shown || !shown.trim();
  const textCls = isEmpty ? emptyClassName : textClassName;

  return (
    <span
      className={`group inline-flex items-center gap-1 ${className}`}
      onDoubleClick={(e) => {
        // Permitir doble-click en cualquier lado para editar
        e.preventDefault();
        e.stopPropagation();
        setEditing(true);
      }}
    >
      {href && !isEmpty ? (
        <Link href={href} className={`${textCls} hover:underline`}>
          {display}
        </Link>
      ) : (
        <span className={textCls}>{display}</span>
      )}
      <button
        type="button"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setEditing(true);
        }}
        title="Editar"
        className="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-gray-700 text-xs transition-opacity"
      >
        ✎
      </button>
    </span>
  );
}
